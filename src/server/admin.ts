import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, auditEvent, booking, child, duprLink, duprSyncLog, levelMember, trainingLevel, trainingSession, user } from "@/db/schema";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import type { Actor } from "./actor";
import { requireAdmin } from "./actor";
import { audit } from "./audit";
import { isProviderActive } from "./dupr/provider";
import { computeRatingState } from "./eligibility";
import { Effects } from "./effects";
import { clubToday, membershipState } from "./membership";
import { notify, notifyAdmins } from "./notify";
import { deleteAvatarFile, processCover } from "./uploads";
import { getSettings } from "./settings";

// ─── Levels ──────────────────────────────────────────────────────────────────

const optionalRating = z
  .union([z.literal(""), z.coerce.number().min(1, "Rating skal være mindst 1").max(8.5, "Rating kan højst være 8,5")])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === undefined || v === null ? null : Math.round(v * 1000) / 1000));

const LevelInput = z
  .object({
    name: z.string().trim().min(2, "Navn skal være mindst 2 tegn").max(60),
    description: z.string().trim().max(300).optional().transform((v) => v || null),
    kind: z.enum(["LEVEL", "JUNIOR", "SOCIAL", "EVENT"]).default("LEVEL"),
    minRating: optionalRating,
    maxRating: optionalRating,
    allowUnrated: z
      .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")])
      .optional()
      .transform((v) => v === true || v === "on" || v === "true"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Farve skal være en hex-kode som #2f6b4f"),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .transform((v) =>
    // Only rating levels have a band; other programmes ignore rating fields.
    v.kind === "LEVEL" ? v : { ...v, minRating: null, maxRating: null, allowUnrated: false },
  )
  .refine((v) => v.kind !== "LEVEL" || v.minRating !== null || v.maxRating !== null, {
    message: "Et ratingniveau skal have en nedre eller øvre grænse",
    path: ["minRating"],
  })
  .refine((v) => v.maxRating === null || v.minRating === null || v.maxRating > v.minRating, {
    message: "Øvre grænse skal være højere end nedre grænse",
    path: ["maxRating"],
  });

function parseLevel(raw: unknown) {
  const p = LevelInput.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", p.error.issues[0]?.message ?? "Ugyldigt hold");
  return p.data;
}

/** Rating levels must not overlap: every rating maps to at most one level. */
async function assertNoOverlap(v: { kind: string; minRating: number | null; maxRating: number | null }, id: string | null) {
  if (v.kind !== "LEVEL") return;
  const others = (await db.select().from(trainingLevel).where(eq(trainingLevel.kind, "LEVEL"))).filter((l) => l.id !== id);
  const lo = (x: number | null) => (x === null ? -Infinity : x);
  const hi = (x: number | null) => (x === null ? Infinity : x);
  const clash = others.find((o) => lo(v.minRating) < hi(o.maxRating) && lo(o.minRating) < hi(v.maxRating));
  if (clash) throw new DomainError("VALIDATION", `Ratinggrænserne overlapper med ${clash.name}.`);
}

export const listLevels = () =>
  db.select().from(trainingLevel).orderBy(asc(trainingLevel.sortOrder), asc(trainingLevel.minRating), asc(trainingLevel.name));

export async function saveLevel(actor: Actor, id: string | null, raw: unknown) {
  requireAdmin(actor);
  const v = parseLevel(raw);
  await assertNoOverlap(v, id);
  const [row] = id
    ? await db.update(trainingLevel).set(v).where(eq(trainingLevel.id, id)).returning()
    : await db.insert(trainingLevel).values(v).returning();
  if (!row) throw new DomainError("NOT_FOUND", "Niveauet findes ikke.");
  await audit(db, { actorId: actor.id, action: id ? "level.update" : "level.create", targetType: "level", targetId: row.id, metadata: v });
  return row;
}

/** Sets (or replaces) a programme's cover photo; the previous file is removed. */
export async function setLevelImage(actor: Actor, levelId: string, bytes: Buffer) {
  requireAdmin(actor);
  const [l] = await db.select({ imageKey: trainingLevel.imageKey }).from(trainingLevel).where(eq(trainingLevel.id, levelId));
  if (!l) throw new DomainError("NOT_FOUND", "Holdet findes ikke.");
  const key = await processCover(bytes);
  await db.update(trainingLevel).set({ imageKey: key }).where(eq(trainingLevel.id, levelId));
  if (l.imageKey) await deleteAvatarFile(l.imageKey);
  await audit(db, { actorId: actor.id, action: "level.image", targetType: "level", targetId: levelId });
  return key;
}

export async function removeLevelImage(actor: Actor, levelId: string) {
  requireAdmin(actor);
  const [l] = await db.select({ imageKey: trainingLevel.imageKey }).from(trainingLevel).where(eq(trainingLevel.id, levelId));
  if (!l) throw new DomainError("NOT_FOUND", "Holdet findes ikke.");
  await db.update(trainingLevel).set({ imageKey: null }).where(eq(trainingLevel.id, levelId));
  if (l.imageKey) await deleteAvatarFile(l.imageKey);
}

export async function deleteLevel(actor: Actor, id: string) {
  requireAdmin(actor);
  const [old] = await db.select({ imageKey: trainingLevel.imageKey }).from(trainingLevel).where(eq(trainingLevel.id, id));
  if (old?.imageKey) await deleteAvatarFile(old.imageKey);
  await db.delete(trainingLevel).where(eq(trainingLevel.id, id));
  await audit(db, { actorId: actor.id, action: "level.delete", targetType: "level", targetId: id });
}

/** The club's standard structure (Pickleball København, Oct 2026). */
export const STANDARD_STRUCTURE = [
  { name: "Novice", kind: "LEVEL", minRating: null, maxRating: 3.0, allowUnrated: true, color: "#3a7d5c", description: "Grundteknik og udvikling. For DUPR under 3.0 — også nye spillere med koblet DUPR-profil, der endnu ikke har en rating." },
  { name: "Intermediate", kind: "LEVEL", minRating: 3.0, maxRating: 3.5, allowUnrated: false, color: "#2f6b8f", description: "Teknik, taktik og stabilitet. For DUPR 3.0–3.49." },
  { name: "Advanced", kind: "LEVEL", minRating: 3.5, maxRating: 4.0, allowUnrated: false, color: "#7a4fa3", description: "Avanceret taktik og konkurrenceforberedelse. For DUPR 3.5–3.99." },
  { name: "Competition", kind: "LEVEL", minRating: 4.0, maxRating: null, allowUnrated: false, color: "#b5462f", description: "Målrettet træning for spillere på højt niveau. For DUPR 4.0+." },
  { name: "Børnehold – Junior Pickleball", kind: "JUNIOR", minRating: null, maxRating: null, allowUnrated: false, color: "#d08a1e", description: "Børnetræning og spilleglæde. Adgang efter alder og færdigheder via holdets deltagerliste." },
  { name: "Social Play", kind: "SOCIAL", minRating: null, maxRating: null, allowUnrated: false, color: "#4f7f3a", description: "Motion, kampe og fællesskab. Åbent for alle." },
  { name: "DUPR-events – Rated Play", kind: "EVENT", minRating: null, maxRating: null, allowUnrated: false, color: "#1f4e5f", description: "Kampe, der registreres i DUPR. Hvert event har sine egne ratingkrav." },
] as const;

/** Creates the standard structure. Only allowed while the club has no programmes. */
export async function applyStandardStructure(actor: Actor) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE training_level IN EXCLUSIVE MODE`);
    const [{ n }] = await tx.select({ n: count() }).from(trainingLevel);
    if (Number(n) > 0) throw new DomainError("CONFLICT", "Der findes allerede hold. Ret dem enkeltvis i stedet.");
    const rows = await tx
      .insert(trainingLevel)
      .values(STANDARD_STRUCTURE.map((l, i) => ({ ...l, sortOrder: (i + 1) * 10 })))
      .returning({ id: trainingLevel.id });
    await audit(tx, { actorId: actor.id, action: "level.standard_structure", targetType: "level", targetId: "*", metadata: { created: rows.length } });
    return rows.length;
  });
}

// ─── Test sessions ───────────────────────────────────────────────────────────
// Clearly marked (isDemo) sessions across every programme, so the club can try
// the platform before launch, and remove them all again with one click.

const TEST_PREFIX = "TEST – ";
const TEST_HOURS: Record<string, [number, number]> = { LEVEL: [18, 0], SOCIAL: [19, 30], JUNIOR: [16, 30], EVENT: [13, 0] };

/** A Copenhagen wall-clock time `days` from today, as a Date. */
function copenhagenAt(days: number, hour: number, minute: number, now: Date) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const base = new Date(`${ymd}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  const local = `${base.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return fromZonedTime(local, "Europe/Copenhagen");
}

export async function countTestSessions() {
  const [r] = await db.select({ n: count() }).from(trainingSession).where(eq(trainingSession.isDemo, true));
  return Number(r?.n ?? 0);
}

export async function createTestSessions(actor: Actor, now = new Date()) {
  requireAdmin(actor);
  const programmes = await db.select().from(trainingLevel).orderBy(asc(trainingLevel.sortOrder), asc(trainingLevel.name));
  if (!programmes.length) throw new DomainError("CONFLICT", "Opret klubbens hold først (Admin → Hold).");
  if ((await countTestSessions()) > 0) throw new DomainError("CONFLICT", "Der findes allerede testtræninger. Slet dem først, hvis du vil starte forfra.");

  const rows: (typeof trainingSession.$inferInsert)[] = [];
  for (let week = 0; week < 3; week++) {
    programmes.forEach((p, i) => {
      const [h, m] = TEST_HOURS[p.kind] ?? [18, 0];
      const startsAt = copenhagenAt(1 + week * 7 + (i % 7), h, m, now);
      const isEvent = p.kind === "EVENT";
      // Week 1's event has its own rating requirement; week 0's social play is tiny, to try the waitlist.
      const eventLimits = isEvent && week === 1 ? { minRating: 3.0, maxRating: 3.999 } : { minRating: null, maxRating: null };
      const capacity = p.kind === "SOCIAL" && week === 0 ? 2 : p.kind === "SOCIAL" ? 20 : p.kind === "JUNIOR" ? 10 : isEvent ? 16 : 12;
      rows.push({
        title: `${TEST_PREFIX}${p.name}${isEvent && week === 1 ? " (3.0–3.99)" : ""}`,
        focus: p.kind === "LEVEL" ? ["Serv og retur", "Dinks og resets", "Tredjeslag", "Overgangszonen"][week % 4] : null,
        description: "Testtræning til afprøvning af platformen. Den er ikke rigtig og slettes inden lancering.",
        levelId: p.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 90 * 60_000),
        locationName: "Testhallen (fiktiv)",
        capacity,
        ...eventLimits,
        status: "PUBLISHED",
        isDemo: true,
        createdById: actor.id,
      });
    });
  }
  const created = await db.insert(trainingSession).values(rows).returning({ id: trainingSession.id });
  await audit(db, { actorId: actor.id, action: "session.test_create", targetType: "session", targetId: "*", metadata: { created: created.length } });
  return created.length;
}

/** Deletes every test session together with its bookings. Real sessions are never touched. */
export async function deleteTestSessions(actor: Actor) {
  requireAdmin(actor);
  const deleted = await db.delete(trainingSession).where(eq(trainingSession.isDemo, true)).returning({ id: trainingSession.id });
  await audit(db, { actorId: actor.id, action: "session.test_delete", targetType: "session", targetId: "*", metadata: { deleted: deleted.length } });
  return deleted.length;
}

// ─── Junior rosters ──────────────────────────────────────────────────────────

async function requireRosterLevel(levelId: string) {
  const [l] = await db.select().from(trainingLevel).where(eq(trainingLevel.id, levelId));
  if (!l) throw new DomainError("NOT_FOUND", "Holdet findes ikke.");
  if (l.kind !== "JUNIOR") throw new DomainError("CONFLICT", "Kun hold med deltagerliste har deltagere.");
  return l;
}

export async function listRoster(actor: Actor, levelId: string) {
  requireAdmin(actor);
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, childId: child.id, childName: child.name, addedAt: levelMember.createdAt })
    .from(levelMember)
    .innerJoin(user, eq(user.id, levelMember.userId))
    .leftJoin(child, eq(child.id, levelMember.childId))
    .where(and(eq(levelMember.levelId, levelId), isNull(user.deletedAt)));
  // A child's entry shows the child's name; the parent is shown as contact.
  return rows
    .map((r) => ({
      userId: r.userId,
      childId: r.childId,
      name: r.childName ?? r.name,
      isChild: !!r.childId,
      parentName: r.childId ? r.name : null,
      email: r.email,
      addedAt: r.addedAt,
    }))
    .sort((x, y) => x.name.localeCompare(y.name, "da"));
}

/** The member with this email and their children — who can be put on a roster. */
export async function rosterCandidates(actor: Actor, email: string) {
  requireAdmin(actor);
  const [u] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(and(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`, isNull(user.deletedAt)));
  if (!u) throw new DomainError("NOT_FOUND", "Der findes intet medlem med den e-mail.");
  const kids = await db.select({ id: child.id, name: child.name, birthYear: child.birthYear }).from(child).where(eq(child.parentId, u.id)).orderBy(asc(child.createdAt));
  return { member: u, children: kids };
}

export async function addToRoster(actor: Actor, levelId: string, email: string, childId: string | null = null) {
  requireAdmin(actor);
  const level = await requireRosterLevel(levelId);
  const { member: u, children: kids } = await rosterCandidates(actor, email);
  const kid = childId ? kids.find((k) => k.id === childId) : null;
  if (childId && !kid) throw new DomainError("NOT_FOUND", "Barnet hører ikke til det medlem.");
  const effects = new Effects();
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(levelMember)
      .values({ levelId, userId: u.id, childId: kid?.id ?? null, addedById: actor.id })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    await notify(tx, effects, u.id, {
      type: "ROSTER_ADDED",
      title: kid ? `${kid.name} er på holdet: ${level.name}` : `Du er på holdet: ${level.name}`,
      body: kid ? `Du kan nu tilmelde ${kid.name} træninger på ${level.name}.` : `Du kan nu tilmelde dig træninger på ${level.name}.`,
      link: "/traeninger",
    });
    await audit(tx, { actorId: actor.id, action: "roster.add", targetType: "level", targetId: levelId, metadata: { userId: u.id, childId: kid?.id ?? null } });
  });
  await effects.flush();
  return kid ? { name: kid.name } : { name: u.name };
}

/** Removing someone from a roster never cancels existing bookings; admins handle those. */
export async function removeFromRoster(actor: Actor, levelId: string, userId: string, childId: string | null = null) {
  requireAdmin(actor);
  await requireRosterLevel(levelId);
  await db
    .delete(levelMember)
    .where(and(eq(levelMember.levelId, levelId), eq(levelMember.userId, userId), childId ? eq(levelMember.childId, childId) : isNull(levelMember.childId)));
  await audit(db, { actorId: actor.id, action: "roster.remove", targetType: "level", targetId: levelId, metadata: { userId, childId } });
}

// ─── Settings ────────────────────────────────────────────────────────────────

const SettingsInput = z.object({
  ratingType: z.enum(["DOUBLES", "SINGLES"]),
  staleAfterDays: z.coerce.number().int().min(1).max(90),
  syncIntervalHours: z.coerce.number().int().min(1).max(168),
  offerWindowHours: z.coerce.number().int().min(1).max(72),
  cancellationCutoffHours: z.coerce.number().int().min(0).max(72),
  ratingDropPolicy: z.enum(["KEEP_AND_FLAG", "RELEASE_AND_NOTIFY"]),
});

export async function updateSettings(actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const p = SettingsInput.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", p.error.issues[0]?.message ?? "Ugyldige indstillinger");
  const before = await getSettings();
  await db.update(appSettings).set(p.data).where(eq(appSettings.id, 1));
  await audit(db, { actorId: actor.id, action: "settings.update", targetType: "settings", targetId: "1", metadata: { before, after: p.data } });
}

// ─── Members ─────────────────────────────────────────────────────────────────

export type MemberFilter = "alle" | "afventer" | "aktive" | "udloebet" | "afsluttet";

export async function searchMembers(actor: Actor, q: string, limit = 50, filter: MemberFilter = "alle") {
  requireAdmin(actor);
  const term = q.trim().slice(0, 100);
  const today = clubToday();
  const statusWhere =
    filter === "afventer"
      ? eq(user.membershipStatus, "PENDING")
      : filter === "afsluttet"
        ? eq(user.membershipStatus, "ENDED")
        : filter === "aktive"
          ? and(eq(user.membershipStatus, "ACTIVE"), or(isNull(user.paidThrough), sql`${user.paidThrough} >= ${today}`))
          : filter === "udloebet"
            ? and(eq(user.membershipStatus, "ACTIVE"), sql`${user.paidThrough} < ${today}`)
            : undefined;
  const settings = await getSettings();
  const now = new Date();
  const rows = await db
    .select({ u: user, link: duprLink })
    .from(user)
    .leftJoin(duprLink, eq(duprLink.userId, user.id))
    .where(
      and(
        isNull(user.deletedAt),
        term ? or(ilike(user.name, `%${term}%`), ilike(user.email, `%${term}%`), ilike(duprLink.externalId, `%${term}%`)) : undefined,
        statusWhere,
      ),
    )
    .orderBy(asc(user.name))
    .limit(limit);
  return rows.map((r) => ({
    id: r.u.id,
    name: r.u.name,
    email: r.u.email,
    role: r.u.role,
    avatarKey: r.u.avatarKey,
    createdAt: r.u.createdAt,
    emailVerified: r.u.emailVerified,
    membership: membershipState(r.u),
    paidThrough: r.u.paidThrough,
    link: r.link,
    ratingState: computeRatingState(r.link, settings, now, isProviderActive),
  }));
}

export async function getMemberAdmin(actor: Actor, id: string) {
  requireAdmin(actor);
  const [row] = await db.select({ u: user, link: duprLink }).from(user).leftJoin(duprLink, eq(duprLink.userId, user.id)).where(eq(user.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Medlemmet findes ikke.");
  const settings = await getSettings();
  const logs = await db.select().from(duprSyncLog).where(eq(duprSyncLog.userId, id)).orderBy(desc(duprSyncLog.createdAt)).limit(20);
  const [stats] = await db
    .select({
      attended: sql<number>`count(*) filter (where ${booking.attendance} = 'ATTENDED')`,
      active: sql<number>`count(*) filter (where ${booking.status} in ('CONFIRMED','WAITLISTED','OFFERED'))`,
    })
    .from(booking)
    .where(eq(booking.userId, id));
  return {
    user: row.u,
    membership: membershipState(row.u),
    link: row.link,
    ratingState: computeRatingState(row.link, settings, new Date(), isProviderActive),
    logs,
    attended: Number(stats?.attended ?? 0),
    activeBookings: Number(stats?.active ?? 0),
  };
}

/** Counts for the members page tabs. */
export async function membershipCounts(actor: Actor) {
  requireAdmin(actor);
  const today = clubToday();
  const [r] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${user.membershipStatus} = 'PENDING')`,
      lapsed: sql<number>`count(*) filter (where ${user.membershipStatus} = 'ACTIVE' and ${user.paidThrough} < ${today} and ${user.role} <> 'ADMIN')`,
    })
    .from(user)
    .where(isNull(user.deletedAt));
  return { pending: Number(r?.pending ?? 0), lapsed: Number(r?.lapsed ?? 0) };
}

const MembershipInput = z.object({
  status: z.enum(["PENDING", "ACTIVE", "ENDED"]),
  paidThrough: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ugyldig dato")])
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Sets a member's club membership. Activating notifies the member. Ending a
 * membership never cancels existing bookings silently — the admin is told how
 * many upcoming bookings the member has, and can cancel them on each session.
 */
export async function setMembership(actor: Actor, userId: string, raw: unknown) {
  requireAdmin(actor);
  const p = MembershipInput.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", p.error.issues[0]?.message ?? "Ugyldige oplysninger");
  const effects = new Effects();
  const res = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(user).where(and(eq(user.id, userId), isNull(user.deletedAt))).for("update");
    if (!before) throw new DomainError("NOT_FOUND", "Medlemmet findes ikke.");
    const now = new Date();
    const [after] = await tx
      .update(user)
      .set({ membershipStatus: p.data.status, paidThrough: p.data.paidThrough, membershipUpdatedAt: now })
      .where(eq(user.id, userId))
      .returning();
    const wasActive = membershipState(before, now) === "ACTIVE";
    const isActive = membershipState(after, now) === "ACTIVE";
    if (isActive && !wasActive) {
      await notify(tx, effects, userId, {
        type: "MEMBERSHIP_ACTIVE",
        title: "Velkommen som medlem!",
        body: "Dit medlemskab af Pickleball København er godkendt. Du kan nu booke træninger.",
        link: "/traeninger",
      });
    }
    await audit(tx, {
      actorId: actor.id,
      action: "member.membership",
      targetType: "user",
      targetId: userId,
      metadata: { from: { status: before.membershipStatus, paidThrough: before.paidThrough }, to: p.data },
    });
    const [{ upcoming }] = await tx
      .select({ upcoming: sql<number>`count(*)` })
      .from(booking)
      .where(and(eq(booking.userId, userId), inArray(booking.status, ["CONFIRMED", "WAITLISTED", "OFFERED"])));
    return { active: isActive, upcomingBookings: Number(upcoming) };
  });
  await effects.flush();
  return res;
}

/** New accounts: tell the admins there is someone to approve (DEMO_MODE deployments approve automatically). */
export async function onNewAccount(userId: string) {
  if (env().DEMO_MODE) {
    await db.update(user).set({ membershipStatus: "ACTIVE", membershipUpdatedAt: new Date() }).where(eq(user.id, userId));
    return;
  }
  const [u] = await db.select({ name: user.name, email: user.email, status: user.membershipStatus }).from(user).where(eq(user.id, userId));
  if (!u || u.status !== "PENDING") return;
  const effects = new Effects();
  await db.transaction((tx) =>
    notifyAdmins(tx, effects, {
      type: "ADMIN_MEMBER_PENDING",
      title: "Nyt medlem afventer godkendelse",
      body: `${u.name} (${u.email}) har oprettet en konto. Godkend medlemskabet, når kontingentet er betalt.`,
      link: "/admin/medlemmer?vis=afventer",
    }),
  );
  await effects.flush();
}

// ─── Sync log & audit ────────────────────────────────────────────────────────

export async function listSyncProblems(actor: Actor) {
  requireAdmin(actor);
  const links = await db
    .select({ link: duprLink, name: user.name, email: user.email })
    .from(duprLink)
    .innerJoin(user, eq(user.id, duprLink.userId))
    .where(inArray(duprLink.status, ["ERROR", "REVOKED"]))
    .orderBy(desc(duprLink.lastSyncAttemptAt));
  const logs = await db
    .select({ log: duprSyncLog, name: user.name })
    .from(duprSyncLog)
    .leftJoin(user, eq(user.id, duprSyncLog.userId))
    .orderBy(desc(duprSyncLog.createdAt))
    .limit(100);
  const [failed24h] = await db
    .select({ n: count() })
    .from(duprSyncLog)
    .where(and(inArray(duprSyncLog.result, ["FAILED", "RATE_LIMITED", "REVOKED"]), sql`${duprSyncLog.createdAt} > now() - interval '24 hours'`));
  return { links, logs, failed24h: Number(failed24h?.n ?? 0) };
}

export async function listAudit(actor: Actor, limit = 200) {
  requireAdmin(actor);
  return db
    .select({ e: auditEvent, actorName: user.name })
    .from(auditEvent)
    .leftJoin(user, eq(user.id, auditEvent.actorId))
    .orderBy(desc(auditEvent.createdAt))
    .limit(limit);
}

// ─── Roles ───────────────────────────────────────────────────────────────────

/**
 * Grants or removes the admin role. Admins can't change their own role (so
 * nobody locks themselves out by accident) and the club always keeps at
 * least one admin. Admin rows are locked so two simultaneous demotions can't
 * both succeed.
 */
export async function setMemberRole(actor: Actor, userId: string, role: "MEMBER" | "ADMIN") {
  requireAdmin(actor);
  if (role !== "MEMBER" && role !== "ADMIN") throw new DomainError("VALIDATION", "Ugyldig rolle.");
  if (userId === actor.id) throw new DomainError("CONFLICT", "Du kan ikke ændre din egen rolle. Bed en anden administrator om det.");
  const effects = new Effects();
  await db.transaction(async (tx) => {
    const admins = await tx.select({ id: user.id }).from(user).where(and(eq(user.role, "ADMIN"), isNull(user.deletedAt))).for("update");
    const [target] = await tx.select().from(user).where(and(eq(user.id, userId), isNull(user.deletedAt))).for("update");
    if (!target) throw new DomainError("NOT_FOUND", "Medlemmet findes ikke.");
    if (target.role === role) return;
    if (role === "MEMBER" && admins.filter((a) => a.id !== userId).length === 0) {
      throw new DomainError("CONFLICT", "Klubben skal have mindst én administrator.");
    }
    await tx.update(user).set({ role }).where(eq(user.id, userId));
    await audit(tx, { actorId: actor.id, action: role === "ADMIN" ? "role.grant_admin" : "role.revoke_admin", targetType: "user", targetId: userId, metadata: { via: "admin_ui" } });
    await notify(tx, effects, userId, role === "ADMIN"
      ? { type: "ROLE_ADMIN_GRANTED", title: "Du er nu administrator", body: "Du har fået adgang til admin-området for Pickleball København.", link: "/admin" }
      : { type: "ROLE_ADMIN_REVOKED", title: "Din admin-adgang er fjernet", body: "Du har ikke længere adgang til admin-området." });
  });
  await effects.flush();
}
