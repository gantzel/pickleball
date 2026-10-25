/**
 * DEMO / DEVELOPMENT seed. Creates levels, mock DUPR players, demo users and
 * demo sessions (flagged is_demo). Refuses to run against production unless
 * DEMO_MODE=true. Never fabricates rating history: the mock provider has none,
 * so demo members start with a single verified snapshot from the first sync.
 *
 *   npm run db:seed
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { booking, duprLink, mockDuprPlayer, trainingLevel, trainingSession, user } from "../src/db/schema";
import { STANDARD_STRUCTURE } from "../src/server/admin";
import { auth } from "../src/lib/auth";
import { devToolsAllowed } from "../src/lib/env";
import { syncLink } from "../src/server/dupr/sync";

const DEMO_PASSWORD = "demo-pickleball-2026";

async function ensureUser(email: string, name: string, role: "MEMBER" | "ADMIN") {
  let [u] = await db.select().from(user).where(eq(user.email, email));
  if (!u) {
    await auth.api.signUpEmail({ body: { email, name, password: DEMO_PASSWORD } });
    [u] = await db.select().from(user).where(eq(user.email, email));
  }
  // Demo accounts skip email verification.
  if (u.role !== role || !u.emailVerified) await db.update(user).set({ role, emailVerified: true }).where(eq(user.id, u.id));
  return u;
}

async function main() {
  if (!devToolsAllowed()) throw new Error("Refusing to seed demo data in production (set DEMO_MODE=true for a demo deployment).");
  if (process.env.DUPR_PROVIDER !== "mock") console.warn("Note: DUPR_PROVIDER is not 'mock' — demo ratings won't count until it is.");

  // The club's real structure (Level 1–3, Kamphold, Børnehold, Social Play, DUPR-events).
  const levelDefs = STANDARD_STRUCTURE.map((l, i) => ({ ...l, sortOrder: (i + 1) * 10 }));
  const existing = await db.select().from(trainingLevel);
  const levels = existing.length ? existing : await db.insert(trainingLevel).values(levelDefs).returning();
  const byShort: Record<string, string> = {
    "Level 1": "Level 1 – Foundation",
    "Level 2": "Level 2 – Development",
    "Level 3": "Level 3 – Performance",
    Kamphold: "Kamphold – Competition",
    Social: "Social Play",
  };
  const L = (short: string) => levels.find((l) => l.name === byShort[short])!;

  const players = [
    { id: "MOCK-ANNA", name: "Anna Holm", doublesRating: 3.412, singlesRating: 3.205 },
    { id: "MOCK-MADS", name: "Mads Krogh", doublesRating: 2.874, singlesRating: 2.701 },
    { id: "MOCK-SOFIE", name: "Sofie Lund", doublesRating: 3.968, singlesRating: 3.88 },
    { id: "MOCK-JONAS", name: "Jonas Bech", doublesRating: 4.315, singlesRating: 4.102 },
    { id: "MOCK-NY", name: "Ny spiller uden rating", doublesRating: null, singlesRating: null },
  ];
  await db.insert(mockDuprPlayer).values(players).onConflictDoNothing();

  const admin = await ensureUser("admin@demo.pbk.local", "Træner Trine (demo)", "ADMIN");
  const members = [
    await ensureUser("anna@demo.pbk.local", "Anna Holm", "MEMBER"),
    await ensureUser("mads@demo.pbk.local", "Mads Krogh", "MEMBER"),
    await ensureUser("sofie@demo.pbk.local", "Sofie Lund", "MEMBER"),
  ];
  const mockFor = ["MOCK-ANNA", "MOCK-MADS", "MOCK-SOFIE"];
  for (let i = 0; i < members.length; i++) {
    const [l] = await db
      .insert(duprLink)
      .values({ userId: members[i].id, provider: "MOCK", externalId: mockFor[i], displayName: players[i].name })
      .onConflictDoNothing()
      .returning();
    if (l) await syncLink(l.id, "LINK");
  }

  const hasSessions = (await db.select({ id: trainingSession.id }).from(trainingSession).where(eq(trainingSession.isDemo, true)).limit(1)).length > 0;
  if (!hasSessions) {
    const at = (days: number, hourUtc: number, min = 0) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      d.setUTCHours(hourUtc, min, 0, 0);
      return d;
    };
    const venues = [
      { locationName: "Valby Idrætspark, hal 2", address: "Julius Andersens Vej 7, 2450 København SV" },
      { locationName: "Østerbro Idrætshus", address: "Gunnar Nu Hansens Plads 7, 2100 København Ø" },
      { locationName: "Amager Idrætshal", address: "Sundholmsvej 6, 2300 København S" },
    ];
    const plan: Array<[number, number, string, string, string, number]> = [
      [1, 16, "Level 1", "Introduktion: serv og retur", "Serv, retur og de første dinks", 16],
      [2, 17, "Level 2", "Køkkenlinjen", "Dinks og tålmodighed ved køkkenet", 12],
      [3, 16, "Level 3", "Tredjeslag og resets", "Drop vs. drive på tredjeslaget", 12],
      [4, 17, "Kamphold", "Matchspil med coaching", "Mønstre og kommunikation", 8],
      [5, 18, "Social", "Social Play fredag", "Kampe på tværs af niveauer", 24],
      [6, 9, "Level 2", "Formiddagstræning", "Footwork og overgangszonen", 4],
      [8, 16, "Level 1", "Foundation uge 2", "Volleys og placering", 16],
      [9, 17, "Level 3", "Tempo-spil", "Hurtige hænder og counters", 12],
    ];
    const created = await db
      .insert(trainingSession)
      .values(
        plan.map(([d, h, lvl, title, focus, cap], i) => ({
          title,
          focus,
          description: `${focus}. Demo-træning oprettet af seed-scriptet.`,
          levelId: L(lvl).id,
          // Access comes from the programme (level band / open), not per-session limits.
          minRating: null,
          maxRating: null,
          startsAt: at(d, h),
          endsAt: at(d, h + 1, 30),
          capacity: cap,
          status: "PUBLISHED" as const,
          isDemo: true,
          createdById: admin.id,
          ...venues[i % venues.length],
        })),
      )
      .returning();
    // Fill the small morning session so the waitlist is visible.
    const small = created.find((s) => s.capacity === 4)!;
    const fillers = await Promise.all([1, 2, 3, 4].map((n) => ensureUser(`spiller${n}@demo.pbk.local`, `Demospiller ${n}`, "MEMBER")));
    await db.insert(booking).values(fillers.map((f) => ({ sessionId: small.id, userId: f.id, status: "CONFIRMED" as const, confirmedAt: new Date() }))).onConflictDoNothing();
  }

  console.log(`Demo data ready.\n  Admin:   admin@demo.pbk.local / ${DEMO_PASSWORD}\n  Members: anna@ / mads@ / sofie@demo.pbk.local / ${DEMO_PASSWORD}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
