import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, auditEvent, booking, duprLink, duprSyncLog, levelMember, trainingLevel, user } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Actor } from "./actor";
import { requireAdmin } from "./actor";
import { audit } from "./audit";
import { isProviderActive } from "./dupr/provider";
import { computeRatingState } from "./eligibility";
import { Effects } from "./effects";
import { notify } from "./notify";
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

export async function deleteLevel(actor: Actor, id: string) {
  requireAdmin(actor);
  await db.delete(trainingLevel).where(eq(trainingLevel.id, id));
  await audit(db, { actorId: actor.id, action: "level.delete", targetType: "level", targetId: id });
}

/** The club's standard structure (Pickleball København, Oct 2026). */
export const STANDARD_STRUCTURE = [
  { name: "Level 1 – Foundation", kind: "LEVEL", minRating: null, maxRating: 3.0, allowUnrated: true, color: "#3a7d5c", description: "Grundteknik og udvikling. For DUPR under 3.0 — også nye spillere med koblet DUPR-profil, der endnu ikke har en rating." },
  { name: "Level 2 – Development", kind: "LEVEL", minRating: 3.0, maxRating: 3.5, allowUnrated: false, color: "#2f6b8f", description: "Teknik, taktik og stabilitet. For DUPR 3.0–3.49." },
  { name: "Level 3 – Performance", kind: "LEVEL", minRating: 3.5, maxRating: 4.0, allowUnrated: false, color: "#7a4fa3", description: "Avanceret taktik og konkurrenceforberedelse. For DUPR 3.5–3.99." },
  { name: "Kamphold – Competition", kind: "LEVEL", minRating: 4.0, maxRating: null, allowUnrated: false, color: "#b5462f", description: "Målrettet træning for spillere på højt niveau. For DUPR 4.0+." },
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

// ─── Junior rosters ──────────────────────────────────────────────────────────

async function requireRosterLevel(levelId: string) {
  const [l] = await db.select().from(trainingLevel).where(eq(trainingLevel.id, levelId));
  if (!l) throw new DomainError("NOT_FOUND", "Holdet findes ikke.");
  if (l.kind !== "JUNIOR") throw new DomainError("CONFLICT", "Kun hold med deltagerliste har deltagere.");
  return l;
}

export async function listRoster(actor: Actor, levelId: string) {
  requireAdmin(actor);
  return db
    .select({ userId: user.id, name: user.name, email: user.email, addedAt: levelMember.createdAt })
    .from(levelMember)
    .innerJoin(user, eq(user.id, levelMember.userId))
    .where(and(eq(levelMember.levelId, levelId), isNull(user.deletedAt)))
    .orderBy(asc(user.name));
}

export async function addToRoster(actor: Actor, levelId: string, email: string) {
  requireAdmin(actor);
  const level = await requireRosterLevel(levelId);
  const [u] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`, isNull(user.deletedAt)));
  if (!u) throw new DomainError("NOT_FOUND", "Der findes intet medlem med den e-mail.");
  const effects = new Effects();
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(levelMember).values({ levelId, userId: u.id, addedById: actor.id }).onConflictDoNothing().returning();
    if (!inserted.length) return;
    await notify(tx, effects, u.id, {
      type: "ROSTER_ADDED",
      title: `Du er på holdet: ${level.name}`,
      body: `Du kan nu tilmelde dig træninger på ${level.name}.`,
      link: "/traeninger",
    });
    await audit(tx, { actorId: actor.id, action: "roster.add", targetType: "level", targetId: levelId, metadata: { userId: u.id } });
  });
  await effects.flush();
  return u;
}

/** Removing someone from a roster never cancels existing bookings; admins handle those. */
export async function removeFromRoster(actor: Actor, levelId: string, userId: string) {
  requireAdmin(actor);
  await requireRosterLevel(levelId);
  await db.delete(levelMember).where(and(eq(levelMember.levelId, levelId), eq(levelMember.userId, userId)));
  await audit(db, { actorId: actor.id, action: "roster.remove", targetType: "level", targetId: levelId, metadata: { userId } });
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

export async function searchMembers(actor: Actor, q: string, limit = 50) {
  requireAdmin(actor);
  const term = q.trim().slice(0, 100);
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
    link: row.link,
    ratingState: computeRatingState(row.link, settings, new Date(), isProviderActive),
    logs,
    attended: Number(stats?.attended ?? 0),
    activeBookings: Number(stats?.active ?? 0),
  };
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
