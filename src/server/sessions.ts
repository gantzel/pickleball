import { fromZonedTime } from "date-fns-tz";
import { and, asc, count, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { booking, duprLink, levelMember, trainingLevel, trainingSession, user, type TrainingSession } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { CLUB_TZ, formatDate, formatTime, ruleRangeLabel } from "@/lib/format";
import type { Actor } from "./actor";
import { requireActor, requireAdmin } from "./actor";
import { audit } from "./audit";
import { lockSession, loadRatingState, offerFreedPlacesLocked, sessionRule, withSessionLock } from "./bookings";
import { isProviderActive } from "./dupr/provider";
import { Effects } from "./effects";
import { accessRule, computeAvailability, computeRatingState, isActiveOffer, ratingFitsRule, type AccessRule, type Availability } from "./eligibility";
import { notify } from "./notify";
import { getSettings } from "./settings";

// ─── Validation ──────────────────────────────────────────────────────────────

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Ugyldig dato/tid")
  .transform((v) => fromZonedTime(v, CLUB_TZ));
const optionalLocal = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(localDateTime.optional());
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const ratingField = z
  .union([z.literal(""), z.coerce.number().min(1, "Rating skal være mindst 1").max(8.5, "Rating kan højst være 8,5")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : Math.round(v * 1000) / 1000));

export const SessionInput = z
  .object({
    title: z.string().trim().min(3, "Titel skal være mindst 3 tegn").max(120),
    description: optionalText(2000),
    focus: optionalText(200),
    levelId: optionalText(64),
    startsAt: localDateTime,
    endsAt: localDateTime,
    locationName: z.string().trim().min(2, "Angiv et sted").max(120),
    address: optionalText(200),
    mapUrl: optionalText(500).refine((v) => v === null || /^https:\/\//.test(v), "Kortlink skal starte med https://"),
    minRating: ratingField,
    maxRating: ratingField,
    capacity: z.coerce.number().int().min(1, "Mindst 1 plads").max(500, "Højst 500 pladser"),
    bookingOpensAt: optionalLocal,
    bookingClosesAt: optionalLocal,
  })
  .superRefine((v, ctx) => {
    if (v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Sluttid skal være efter starttid" });
    if (v.minRating !== null && v.maxRating !== null && v.maxRating < v.minRating) {
      ctx.addIssue({ code: "custom", path: ["maxRating"], message: "Maksimum skal være mindst minimum" });
    }
    if (v.bookingClosesAt && v.bookingClosesAt > v.startsAt) {
      ctx.addIssue({ code: "custom", path: ["bookingClosesAt"], message: "Bookingen skal lukke senest ved start" });
    }
    if (v.bookingOpensAt && v.bookingOpensAt >= (v.bookingClosesAt ?? v.startsAt)) {
      ctx.addIssue({ code: "custom", path: ["bookingOpensAt"], message: "Bookingen skal åbne før den lukker" });
    }
  });
export type SessionInputT = z.input<typeof SessionInput>;

export function parseSessionInput(raw: unknown) {
  const parsed = SessionInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DomainError("VALIDATION", first?.message ?? "Ugyldige oplysninger", {
      fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])),
    });
  }
  return parsed.data;
}

/**
 * Rating levels and junior programmes define access themselves, so their
 * sessions carry no limits of their own (the level's band always applies,
 * also when an admin later adjusts it).
 */
async function normaliseLimits<T extends { levelId: string | null; minRating: number | null; maxRating: number | null }>(input: T): Promise<T> {
  if (!input.levelId) return input;
  const [level] = await db.select({ kind: trainingLevel.kind }).from(trainingLevel).where(eq(trainingLevel.id, input.levelId));
  if (!level) throw new DomainError("VALIDATION", "Holdet findes ikke.", { fields: { levelId: "Holdet findes ikke" } });
  if (level.kind === "LEVEL" || level.kind === "JUNIOR") return { ...input, minRating: null, maxRating: null };
  return input;
}

// ─── Admin mutations ─────────────────────────────────────────────────────────

export async function createSession(actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const input = await normaliseLimits(parseSessionInput(raw));
  const [s] = await db.insert(trainingSession).values({ ...input, status: "DRAFT", createdById: actor.id }).returning();
  await audit(db, { actorId: actor.id, action: "session.create", targetType: "session", targetId: s.id, metadata: { title: s.title } });
  return s;
}

export async function updateSession(actor: Actor, id: string, raw: unknown) {
  requireAdmin(actor);
  const input = await normaliseLimits(parseSessionInput(raw));
  return withSessionLock(id, async (tx, s, effects, now) => {
    if (s.status === "CANCELLED" || s.status === "COMPLETED") {
      throw new DomainError("CONFLICT", "Aflyste eller afsluttede træninger kan ikke redigeres.");
    }
    const [{ n }] = await tx
      .select({ n: count() })
      .from(booking)
      .where(and(eq(booking.sessionId, id), inArray(booking.status, ["CONFIRMED", "OFFERED"])));
    if (input.capacity < Number(n)) {
      throw new DomainError("CONFLICT", `Kapaciteten kan ikke være lavere end antallet af tilmeldte (${n}).`);
    }
    const [updated] = await tx.update(trainingSession).set(input).where(eq(trainingSession.id, id)).returning();
    // Moved in time: members get a fresh reminder for the new time.
    if (updated.startsAt.getTime() !== s.startsAt.getTime()) {
      await tx.update(booking).set({ reminderSentAt: null }).where(eq(booking.sessionId, id));
    }

    // Access changed: flag (never cancel) confirmed bookings now outside the rating band.
    let flagged = 0;
    if (updated.minRating !== s.minRating || updated.maxRating !== s.maxRating || updated.levelId !== s.levelId) {
      const settings = await getSettings(tx);
      const rule = await sessionRule(tx, updated);
      const rows = await tx
        .select({ b: booking, link: duprLink })
        .from(booking)
        .leftJoin(duprLink, eq(duprLink.userId, booking.userId))
        .where(and(eq(booking.sessionId, id), eq(booking.status, "CONFIRMED")));
      for (const { b, link } of rows) {
        const st = computeRatingState(link, settings, now, isProviderActive);
        const out = st.kind === "VERIFIED" && !ratingFitsRule(rule, st.rating);
        if (out && b.flag === "NONE") {
          await tx.update(booking).set({ flag: "RATING_OUT_OF_RANGE", flaggedAt: now }).where(eq(booking.id, b.id));
          flagged++;
        } else if (!out && b.flag !== "NONE") {
          await tx.update(booking).set({ flag: "NONE", flaggedAt: null }).where(eq(booking.id, b.id));
        }
      }
    }
    await offerFreedPlacesLocked(tx, updated, effects, now);
    await audit(tx, { actorId: actor.id, action: "session.update", targetType: "session", targetId: id, metadata: { flagged } });
    return { session: updated, flagged };
  });
}

export async function publishSession(actor: Actor, id: string) {
  requireAdmin(actor);
  return withSessionLock(id, async (tx, s, effects, now) => {
    if (s.status !== "DRAFT") throw new DomainError("CONFLICT", "Kun kladder kan offentliggøres.");
    if (s.startsAt <= now) throw new DomainError("CONFLICT", "Træningen ligger i fortiden.");
    const [u] = await tx.update(trainingSession).set({ status: "PUBLISHED" }).where(eq(trainingSession.id, id)).returning();
    await audit(tx, { actorId: actor.id, action: "session.publish", targetType: "session", targetId: id });
    void effects;
    return u;
  });
}

export async function cancelSession(actor: Actor, id: string, reason: string) {
  requireAdmin(actor);
  const why = reason.trim().slice(0, 300);
  return withSessionLock(id, async (tx, s, effects, now) => {
    if (s.status === "CANCELLED" || s.status === "COMPLETED") throw new DomainError("CONFLICT", "Træningen kan ikke aflyses.");
    await tx.update(trainingSession).set({ status: "CANCELLED", cancelReason: why || null }).where(eq(trainingSession.id, id));
    const affected = await tx
      .update(booking)
      .set({ status: "CANCELLED", cancelledAt: now, cancelledBy: "ADMIN", offerExpiresAt: null })
      .where(and(eq(booking.sessionId, id), inArray(booking.status, ["CONFIRMED", "WAITLISTED", "OFFERED"])))
      .returning({ userId: booking.userId });
    for (const a of affected) {
      await notify(tx, effects, a.userId, {
        type: "SESSION_CANCELLED",
        title: "Træning aflyst",
        body: `${s.title} ${formatDate(s.startsAt)} kl. ${formatTime(s.startsAt)} er aflyst.${why ? ` Årsag: ${why}` : ""}`,
        link: `/traeninger/${s.id}`,
      });
    }
    await audit(tx, { actorId: actor.id, action: "session.cancel", targetType: "session", targetId: id, metadata: { reason: why, affected: affected.length } });
    return { affected: affected.length };
  });
}

export async function duplicateSession(actor: Actor, id: string, daysOffset = 7) {
  requireAdmin(actor);
  const [s] = await db.select().from(trainingSession).where(eq(trainingSession.id, id));
  if (!s) throw new DomainError("NOT_FOUND", "Træningen findes ikke.");
  const shift = (d: Date | null) => (d ? new Date(d.getTime() + daysOffset * 86400_000) : null);
  const [copy] = await db
    .insert(trainingSession)
    .values({
      title: s.title,
      description: s.description,
      focus: s.focus,
      levelId: s.levelId,
      startsAt: shift(s.startsAt)!,
      endsAt: shift(s.endsAt)!,
      timezone: s.timezone,
      locationName: s.locationName,
      address: s.address,
      mapUrl: s.mapUrl,
      minRating: s.minRating,
      maxRating: s.maxRating,
      capacity: s.capacity,
      bookingOpensAt: shift(s.bookingOpensAt),
      bookingClosesAt: shift(s.bookingClosesAt),
      status: "DRAFT",
      createdById: actor.id,
    })
    .returning();
  await audit(db, { actorId: actor.id, action: "session.duplicate", targetType: "session", targetId: copy.id, metadata: { from: id } });
  return copy;
}

export async function completeSession(actor: Actor, id: string) {
  requireAdmin(actor);
  const effects = new Effects();
  const r = await db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status !== "PUBLISHED") throw new DomainError("CONFLICT", "Kun offentliggjorte træninger kan afsluttes.");
    if (s.startsAt > new Date()) throw new DomainError("CONFLICT", "Træningen er ikke startet endnu.");
    await tx.update(trainingSession).set({ status: "COMPLETED" }).where(eq(trainingSession.id, id));
    // Waitlist entries for a finished session are closed out.
    await tx
      .update(booking)
      .set({ status: "EXPIRED", offerExpiresAt: null })
      .where(and(eq(booking.sessionId, id), inArray(booking.status, ["WAITLISTED", "OFFERED"])));
    await audit(tx, { actorId: actor.id, action: "session.complete", targetType: "session", targetId: id });
    return s;
  });
  await effects.flush();
  return r;
}

// ─── Member queries ──────────────────────────────────────────────────────────

export interface MemberSessionView {
  session: TrainingSession;
  levelName: string | null;
  levelColor: string | null;
  levelKind: string | null;
  rule: AccessRule;
  held: number;
  remaining: number;
  waitlistCount: number;
  availability: Availability;
}

async function buildViews(sessions: TrainingSession[], actor: Actor, now: Date): Promise<MemberSessionView[]> {
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  const settings = await getSettings();
  const ratingState = await loadRatingState(db, actor.id, settings, now);
  const levels = await db.select().from(trainingLevel);
  const levelById = new Map(levels.map((l) => [l.id, l]));
  const roster = new Set(
    (await db.select({ levelId: levelMember.levelId }).from(levelMember).where(eq(levelMember.userId, actor.id))).map((r) => r.levelId),
  );
  const rows = await db
    .select({ sessionId: booking.sessionId, userId: booking.userId, status: booking.status, offerExpiresAt: booking.offerExpiresAt, flag: booking.flag, waitlistedAt: booking.waitlistedAt, createdAt: booking.createdAt })
    .from(booking)
    .where(and(inArray(booking.sessionId, ids), inArray(booking.status, ["CONFIRMED", "WAITLISTED", "OFFERED"])))
    .orderBy(asc(booking.waitlistedAt), asc(booking.createdAt));

  return sessions.map((s) => {
    const mine = rows.filter((r) => r.sessionId === s.id);
    const held = mine.filter((r) => r.status === "CONFIRMED" || isActiveOffer(r, now)).length;
    const waitlist = mine.filter((r) => r.status === "WAITLISTED");
    const own = mine.find((r) => r.userId === actor.id) ?? null;
    const position = own?.status === "WAITLISTED" ? waitlist.findIndex((w) => w.userId === actor.id) + 1 : undefined;
    const level = s.levelId ? levelById.get(s.levelId) : undefined;
    const rule = accessRule(s, level ?? null);
    return {
      session: s,
      levelName: level?.name ?? null,
      levelColor: level?.color ?? null,
      levelKind: level?.kind ?? null,
      rule,
      held,
      remaining: Math.max(0, s.capacity - held),
      waitlistCount: waitlist.length,
      availability: computeAvailability({
        session: s,
        heldCount: held,
        booking: own,
        waitlistPosition: position,
        ratingState,
        rule,
        onRoster: !!s.levelId && roster.has(s.levelId),
        now,
      }),
    };
  });
}

export async function listUpcomingForMember(actor: Actor, now = new Date(), limit = 100) {
  requireActor(actor);
  const sessions = await db
    .select()
    .from(trainingSession)
    .where(and(eq(trainingSession.status, "PUBLISHED"), gte(trainingSession.endsAt, now)))
    .orderBy(asc(trainingSession.startsAt))
    .limit(limit);
  return buildViews(sessions, actor, now);
}

export async function getSessionForMember(actor: Actor, id: string, now = new Date()) {
  requireActor(actor);
  const [s] = await db.select().from(trainingSession).where(eq(trainingSession.id, id));
  // Drafts are invisible to members. Cancelled/completed remain viewable.
  if (!s || s.status === "DRAFT") throw new DomainError("NOT_FOUND", "Træningen findes ikke.");
  const [view] = await buildViews([s], actor, now);
  return view;
}

export async function memberBookingHistory(actor: Actor, limit = 20) {
  requireActor(actor);
  return db
    .select({ b: booking, s: trainingSession })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(eq(booking.userId, actor.id))
    .orderBy(desc(trainingSession.startsAt))
    .limit(limit);
}

// ─── Admin queries ───────────────────────────────────────────────────────────

export async function listSessionsAdmin(actor: Actor, opts: { scope: "upcoming" | "past" | "drafts" }) {
  requireAdmin(actor);
  const now = new Date();
  const where =
    opts.scope === "drafts"
      ? eq(trainingSession.status, "DRAFT")
      : opts.scope === "upcoming"
        ? and(gte(trainingSession.endsAt, now), ne(trainingSession.status, "DRAFT"))
        : and(lt(trainingSession.endsAt, now), ne(trainingSession.status, "DRAFT"));
  const sessions = await db
    .select()
    .from(trainingSession)
    .where(where)
    .orderBy(opts.scope === "past" ? desc(trainingSession.startsAt) : asc(trainingSession.startsAt))
    .limit(200);
  const ids = sessions.map((s) => s.id);
  const levelById = new Map((await db.select().from(trainingLevel)).map((l) => [l.id, l]));
  const counts = ids.length
    ? await db
        .select({ sessionId: booking.sessionId, status: booking.status, n: count() })
        .from(booking)
        .where(inArray(booking.sessionId, ids))
        .groupBy(booking.sessionId, booking.status)
    : [];
  const flags = ids.length
    ? await db
        .select({ sessionId: booking.sessionId, n: count() })
        .from(booking)
        .where(and(inArray(booking.sessionId, ids), eq(booking.status, "CONFIRMED"), ne(booking.flag, "NONE")))
        .groupBy(booking.sessionId)
    : [];
  return sessions.map((s) => {
    const c = (st: string) => Number(counts.find((x) => x.sessionId === s.id && x.status === st)?.n ?? 0);
    const level = s.levelId ? levelById.get(s.levelId) : undefined;
    return {
      session: s,
      levelName: level?.name ?? null,
      access: ruleRangeLabel(accessRule(s, level ?? null)),
      confirmed: c("CONFIRMED"),
      offered: c("OFFERED"),
      waitlisted: c("WAITLISTED"),
      flagged: Number(flags.find((f) => f.sessionId === s.id)?.n ?? 0),
    };
  });
}

export async function getSessionAdmin(actor: Actor, id: string) {
  requireAdmin(actor);
  const [s] = await db.select().from(trainingSession).where(eq(trainingSession.id, id));
  if (!s) throw new DomainError("NOT_FOUND", "Træningen findes ikke.");
  const settings = await getSettings();
  const now = new Date();
  const rows = await db
    .select({ b: booking, u: { id: user.id, name: user.name, email: user.email, avatarKey: user.avatarKey, deletedAt: user.deletedAt }, link: duprLink })
    .from(booking)
    .innerJoin(user, eq(user.id, booking.userId))
    .leftJoin(duprLink, eq(duprLink.userId, booking.userId))
    .where(eq(booking.sessionId, id))
    .orderBy(asc(booking.waitlistedAt), asc(booking.confirmedAt), asc(booking.createdAt));
  const [level] = s.levelId ? await db.select().from(trainingLevel).where(eq(trainingLevel.id, s.levelId)) : [];
  const access = ruleRangeLabel(accessRule(s, level ?? null));
  const participants = rows.map((r) => ({
    booking: r.b,
    user: r.u,
    ratingState: computeRatingState(r.link, settings, now, isProviderActive),
  }));
  return { session: s, participants, levelName: level?.name ?? null, access };
}

export async function adminMetrics(actor: Actor) {
  requireAdmin(actor);
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86400_000);
  const [sess] = await db
    .select({ n: count(), cap: sql<number>`coalesce(sum(${trainingSession.capacity}),0)` })
    .from(trainingSession)
    .where(and(eq(trainingSession.status, "PUBLISHED"), gte(trainingSession.startsAt, now), lt(trainingSession.startsAt, in14)));
  const byStatus = await db
    .select({ status: booking.status, n: count() })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(and(eq(trainingSession.status, "PUBLISHED"), gte(trainingSession.startsAt, now), lt(trainingSession.startsAt, in14)))
    .groupBy(booking.status);
  const pick = (st: string) => Number(byStatus.find((b) => b.status === st)?.n ?? 0);
  const [flagged] = await db
    .select({ n: count() })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(and(eq(booking.status, "CONFIRMED"), ne(booking.flag, "NONE"), gte(trainingSession.startsAt, now)));
  const linkStatus = await db.select({ status: duprLink.status, n: count() }).from(duprLink).groupBy(duprLink.status);
  const [members] = await db.select({ n: count() }).from(user).where(sql`${user.deletedAt} IS NULL`);
  return {
    upcomingSessions: Number(sess?.n ?? 0),
    capacity: Number(sess?.cap ?? 0),
    confirmed: pick("CONFIRMED"),
    offered: pick("OFFERED"),
    waitlisted: pick("WAITLISTED"),
    flagged: Number(flagged?.n ?? 0),
    members: Number(members?.n ?? 0),
    linksActive: Number(linkStatus.find((l) => l.status === "ACTIVE")?.n ?? 0),
    linksError: Number(linkStatus.find((l) => l.status === "ERROR")?.n ?? 0),
    linksRevoked: Number(linkStatus.find((l) => l.status === "REVOKED")?.n ?? 0),
  };
}
