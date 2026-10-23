import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, auditEvent, booking, duprLink, duprSyncLog, trainingLevel, user } from "@/db/schema";
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

const LevelInput = z
  .object({
    name: z.string().trim().min(2, "Navn skal være mindst 2 tegn").max(60),
    description: z.string().trim().max(300).optional().transform((v) => v || null),
    minRating: z.coerce.number().min(1).max(8.5),
    maxRating: z
      .union([z.literal(""), z.coerce.number().min(1).max(8.5)])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Farve skal være en hex-kode som #2f6b4f"),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => v.maxRating === null || v.maxRating > v.minRating, { message: "Maksimum skal være højere end minimum", path: ["maxRating"] });

function parseLevel(raw: unknown) {
  const p = LevelInput.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", p.error.issues[0]?.message ?? "Ugyldigt niveau");
  return p.data;
}

export const listLevels = () => db.select().from(trainingLevel).orderBy(asc(trainingLevel.minRating), asc(trainingLevel.sortOrder));

export async function saveLevel(actor: Actor, id: string | null, raw: unknown) {
  requireAdmin(actor);
  const v = parseLevel(raw);
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
