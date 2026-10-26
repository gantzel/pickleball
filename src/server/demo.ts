/**
 * DEMO data — only ever runs when dev tools are allowed (development, or a
 * deployment with DEMO_MODE=true, which shows a permanent demo banner and uses
 * the clearly labelled test provider instead of DUPR).
 *
 * seedDemo() is idempotent: the club structure, test players (with a test
 * rating history), demo members, a parent with a child, past attended
 * sessions and upcoming sessions. ensureDemoSessions() tops up upcoming
 * sessions so a long-running demo never runs out of things to book.
 */
import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { booking, child, duprLink, levelMember, mockDuprPlayer, trainingLevel, trainingSession, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { devToolsAllowed, isDemo } from "@/lib/env";
import { evaluateAttendanceAchievements } from "./achievements";
import { STANDARD_STRUCTURE } from "./admin";
import { bookSession } from "./bookings";
import { importProviderHistory } from "./dupr/link";
import { providerFor } from "./dupr/provider";
import { syncLink } from "./dupr/sync";
import { Effects } from "./effects";

export const DEMO_PASSWORD = "demo-pickleball-2026";
export const DEMO_ACCOUNTS = {
  admin: "admin@demo.pbk.local",
  anna: "anna@demo.pbk.local",
  mads: "mads@demo.pbk.local",
  sofie: "sofie@demo.pbk.local",
};

const DAY = 86400_000;
const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * DAY).toISOString();

function assertDemo() {
  if (!devToolsAllowed()) throw new Error("Refusing to create demo data in production (set DEMO_MODE=true for a demo deployment).");
}

async function ensureUser(email: string, name: string, role: "MEMBER" | "ADMIN") {
  let [u] = await db.select().from(user).where(eq(user.email, email));
  if (!u) {
    await auth.api.signUpEmail({ body: { email, name, password: DEMO_PASSWORD } });
    [u] = await db.select().from(user).where(eq(user.email, email));
  }
  // Demo accounts skip email verification.
  if (u.role !== role || !u.emailVerified || u.membershipStatus !== "ACTIVE") {
    await db.update(user).set({ role, emailVerified: true, membershipStatus: "ACTIVE" }).where(eq(user.id, u.id));
  }
  return { ...u, role };
}

async function programmes() {
  const existing = await db.select().from(trainingLevel);
  if (existing.length) return existing;
  return db.insert(trainingLevel).values(STANDARD_STRUCTURE.map((l, i) => ({ ...l, sortOrder: (i + 1) * 10 }))).returning();
}

/** Copenhagen wall-clock-ish time: whole days from today at a given UTC hour. */
function at(days: number, hourUtc: number, min: number, now: Date) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hourUtc, min, 0, 0);
  return d;
}

const VENUES = [
  { locationName: "Valby Idrætspark, hal 2", address: "Julius Andersens Vej 7, 2450 København SV" },
  { locationName: "Østerbro Idrætshus", address: "Gunnar Nu Hansens Plads 7, 2100 København Ø" },
  { locationName: "Amager Idrætshal", address: "Sundholmsvej 6, 2300 København S" },
];

export async function seedDemo(now = new Date()) {
  assertDemo();
  const levels = await programmes();
  const byName = (n: string) => levels.find((l) => l.name === n);

  // Test players. Anna has a test rating history so the progress chart has a curve.
  const players = [
    {
      id: "MOCK-ANNA",
      name: "Anna Holm",
      doublesRating: 3.412,
      singlesRating: 3.205,
      history: [
        [150, 3.051],
        [122, 3.118],
        [96, 3.187],
        [71, 3.243],
        [47, 3.309],
        [26, 3.366],
        [11, 3.391],
      ].map(([d, r]) => ({ ratedAt: daysAgo(d, now), doubles: r, singles: Math.round((r - 0.2) * 1000) / 1000 })),
    },
    { id: "MOCK-MADS", name: "Mads Krogh", doublesRating: 2.874, singlesRating: 2.701, history: null },
    { id: "MOCK-SOFIE", name: "Sofie Lund", doublesRating: 3.968, singlesRating: 3.88, history: null },
    { id: "MOCK-JONAS", name: "Jonas Bech", doublesRating: 4.315, singlesRating: 4.102, history: null },
    { id: "MOCK-NY", name: "Ny spiller uden rating", doublesRating: null, singlesRating: null, history: null },
  ];
  await db.insert(mockDuprPlayer).values(players).onConflictDoNothing();

  const admin = await ensureUser(DEMO_ACCOUNTS.admin, "Træner Trine (demo)", "ADMIN");
  const anna = await ensureUser(DEMO_ACCOUNTS.anna, "Anna Holm", "MEMBER");
  const mads = await ensureUser(DEMO_ACCOUNTS.mads, "Mads Krogh", "MEMBER");
  const sofie = await ensureUser(DEMO_ACCOUNTS.sofie, "Sofie Lund", "MEMBER");
  const mock = providerFor("MOCK")!;
  for (const [m, p] of [
    [anna, players[0]],
    [mads, players[1]],
    [sofie, players[2]],
  ] as const) {
    const [l] = await db
      .insert(duprLink)
      .values({ userId: m.id, provider: "MOCK", externalId: p.id, displayName: p.name })
      .onConflictDoNothing()
      .returning();
    if (l) {
      await importProviderHistory(m.id, mock, p.id);
      await syncLink(l.id, "LINK");
    }
  }

  // Mads is a parent: his daughter is on the junior roster.
  const junior = levels.find((l) => l.kind === "JUNIOR");
  let [emma] = await db.select().from(child).where(eq(child.parentId, mads.id));
  if (!emma) {
    [emma] = await db.insert(child).values({ parentId: mads.id, name: "Emma Krogh", birthYear: now.getUTCFullYear() - 12 }).returning();
  }
  if (junior) await db.insert(levelMember).values({ levelId: junior.id, userId: mads.id, childId: emma.id, addedById: admin.id }).onConflictDoNothing();

  // Anna's past training (attended), so milestones and the attendance markers show.
  const [{ n: past }] = await db
    .select({ n: count() })
    .from(trainingSession)
    .where(and(eq(trainingSession.isDemo, true), lt(trainingSession.startsAt, now)));
  const intermediate = byName("Intermediate");
  if (Number(past) === 0 && intermediate) {
    const weeks = [42, 35, 28, 21, 14, 7];
    const pastSessions = await db
      .insert(trainingSession)
      .values(
        weeks.map((d, i) => ({
          title: ["Køkkenlinjen", "Serv og retur", "Tredjeslag", "Resets", "Overgangszonen", "Matchspil"][i],
          focus: "Demo-træning",
          description: "Afholdt demo-træning.",
          levelId: intermediate.id,
          startsAt: at(-d, 17, 0, now),
          endsAt: at(-d, 18, 30, now),
          capacity: 12,
          status: "COMPLETED" as const,
          isDemo: true,
          createdById: admin.id,
          ...VENUES[i % VENUES.length],
        })),
      )
      .returning();
    await db.insert(booking).values(
      pastSessions.map((s) => ({ sessionId: s.id, userId: anna.id, status: "CONFIRMED" as const, confirmedAt: s.startsAt, attendance: "ATTENDED" as const })),
    );
    const effects = new Effects();
    await db.transaction((tx) => evaluateAttendanceAchievements(tx, effects, anna.id));
  }

  await ensureDemoSessions(now, { admin, anna, mads, emmaId: emma.id });
  return { admin, anna, mads, sofie };
}

/** Keeps at least a week and a half of upcoming demo sessions. Cheap when nothing is needed. */
export async function ensureDemoSessions(
  now = new Date(),
  people?: { admin: { id: string }; anna: { id: string; role: "MEMBER" | "ADMIN" }; mads: { id: string; role: "MEMBER" | "ADMIN" }; emmaId: string },
) {
  if (!devToolsAllowed()) return 0;
  const [{ n }] = await db
    .select({ n: count() })
    .from(trainingSession)
    .where(and(eq(trainingSession.isDemo, true), eq(trainingSession.status, "PUBLISHED"), gt(trainingSession.startsAt, new Date(now.getTime() + 2 * DAY))));
  if (Number(n) >= 4) return 0;

  const levels = await db.select().from(trainingLevel);
  const L = (name: string) => levels.find((l) => l.name === name) ?? levels.find((l) => l.kind === "SOCIAL") ?? null;
  const findUser = async (email: string) => (await db.select().from(user).where(and(eq(user.email, email), isNull(user.deletedAt))))[0];
  const admin = people?.admin ?? (await findUser(DEMO_ACCOUNTS.admin));
  if (!admin) return 0;

  const plan: Array<[number, number, string, string, string, number]> = [
    [1, 16, "Novice", "Introduktion: serv og retur", "Serv, retur og de første dinks", 16],
    [2, 17, "Intermediate", "Køkkenlinjen", "Dinks og tålmodighed ved køkkenet", 12],
    [3, 16, "Advanced", "Tredjeslag og resets", "Drop vs. drive på tredjeslaget", 12],
    [4, 17, "Competition", "Matchspil med coaching", "Mønstre og kommunikation", 8],
    [5, 18, "Social Play", "Social Play fredag", "Kampe på tværs af niveauer", 24],
    [6, 9, "Intermediate", "Formiddagstræning", "Footwork og overgangszonen", 4],
    [6, 13, "Børnehold – Junior Pickleball", "Juniortræning", "Leg, teknik og spilleglæde", 10],
    [7, 12, "DUPR-events – Rated Play", "Rated Play søndag", "Kampe, der registreres i DUPR", 16],
    [8, 16, "Novice", "Novice uge 2", "Volleys og placering", 16],
    [9, 17, "Advanced", "Tempo-spil", "Hurtige hænder og counters", 12],
    [10, 17, "Intermediate", "Dink-spil", "Placering og tålmodighed", 12],
  ];
  const created = await db
    .insert(trainingSession)
    .values(
      plan.map(([d, h, lvl, title, focus, cap], i) => ({
        title,
        focus,
        description: `${focus}. Demo-træning.`,
        levelId: L(lvl)?.id ?? null,
        minRating: null,
        maxRating: null,
        startsAt: at(d, h, 0, now),
        endsAt: at(d, h + 1, 30, now),
        capacity: cap,
        status: "PUBLISHED" as const,
        isDemo: true,
        createdById: admin.id,
        ...VENUES[i % VENUES.length],
      })),
    )
    .returning();

  // A full session (to show the waitlist), Anna's own bookings and a child's booking.
  const small = created.find((s) => s.capacity === 4)!;
  const fillers = await Promise.all([1, 2, 3, 4].map((k) => ensureUser(`spiller${k}@demo.pbk.local`, `Demospiller ${k}`, "MEMBER")));
  await db.insert(booking).values(fillers.map((f) => ({ sessionId: small.id, userId: f.id, status: "CONFIRMED" as const, confirmedAt: now }))).onConflictDoNothing();
  const anna = people?.anna ?? (await findUser(DEMO_ACCOUNTS.anna));
  const mads = people?.mads ?? (await findUser(DEMO_ACCOUNTS.mads));
  const emmaId = people?.emmaId ?? (mads ? (await db.select().from(child).where(eq(child.parentId, mads.id)))[0]?.id : undefined);
  const tryBook = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      /* not eligible in this configuration — fine for demo data */
    }
  };
  const first = (title: string) => created.find((s) => s.title === title);
  if (anna) {
    const a = { id: anna.id, role: anna.role };
    if (first("Køkkenlinjen")) await tryBook(() => bookSession(a, first("Køkkenlinjen")!.id));
    if (first("Social Play fredag")) await tryBook(() => bookSession(a, first("Social Play fredag")!.id));
  }
  if (mads && emmaId && first("Juniortræning")) {
    await tryBook(() => bookSession({ id: mads.id, role: mads.role }, first("Juniortræning")!.id, emmaId));
  }
  return created.length;
}

/** Called on page loads in a demo deployment; does nothing elsewhere. */
export async function refreshDemoIfNeeded() {
  if (!isDemo()) return;
  try {
    await ensureDemoSessions();
  } catch (e) {
    console.warn("[demo] refresh failed", e instanceof Error ? e.message : e);
  }
}
