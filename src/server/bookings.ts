/**
 * Booking engine. Every mutation for a session runs inside a transaction that
 * first takes a row lock on the session (SELECT … FOR UPDATE). That serialises
 * concurrent bookings for the same session, so capacity can't be exceeded,
 * and the unique (session_id, user_id) index makes duplicates impossible.
 *
 * Waitlist rule (README → "Waitlist"):
 *  When a place frees up, it is offered to the earliest-joined waitlisted
 *  member who is *currently* eligible under the session's access rule. The
 *  place is held for `offerWindowHours` or until booking closes, whichever is
 *  sooner. Ineligible members keep their queue position and are skipped.
 *  Unaccepted offers expire and the place moves on to the next in line.
 */
import { and, asc, count, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { booking, child, duprLink, levelMember, trainingLevel, trainingSession, type AppSettings, type Child, type TrainingSession } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { formatDate, formatDateTime, formatRating, formatTime } from "@/lib/format";
import type { Actor } from "./actor";
import { requireAdmin } from "./actor";
import { audit } from "./audit";
import { evaluateAttendanceAchievements } from "./achievements";
import { isProviderActive } from "./dupr/provider";
import { Effects } from "./effects";
import {
  accessRule,
  bookingClosesAt,
  computeRatingState,
  ruleEligibility,
  type AccessRule,
  type RatingState,
} from "./eligibility";
import { notify } from "./notify";
import { getSettings } from "./settings";

type Session = TrainingSession;

// ─── Shared helpers ──────────────────────────────────────────────────────────

export async function lockSession(tx: Tx, sessionId: string): Promise<Session> {
  const [s] = await tx.select().from(trainingSession).where(eq(trainingSession.id, sessionId)).for("update");
  if (!s) throw new DomainError("NOT_FOUND", "Træningen findes ikke.");
  return s;
}

/** Places held = confirmed bookings + unexpired offers. */
export async function heldCount(tx: Tx, sessionId: string, now: Date): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(booking)
    .where(
      and(
        eq(booking.sessionId, sessionId),
        or(eq(booking.status, "CONFIRMED"), and(eq(booking.status, "OFFERED"), gt(booking.offerExpiresAt, now))),
      ),
    );
  return Number(r?.n ?? 0);
}

export async function loadRatingState(tx: Tx, userId: string, settings: AppSettings, now: Date): Promise<RatingState> {
  const [link] = await tx.select().from(duprLink).where(eq(duprLink.userId, userId));
  return computeRatingState(link ?? null, settings, now, isProviderActive);
}

function assertBookable(s: Session, now: Date) {
  if (s.status === "CANCELLED") throw new DomainError("BOOKING_WINDOW", "Træningen er aflyst.");
  if (s.status !== "PUBLISHED") throw new DomainError("NOT_FOUND", "Træningen findes ikke.");
  if (s.startsAt <= now) throw new DomainError("BOOKING_WINDOW", "Træningen er allerede startet.");
  if (s.bookingOpensAt && now < s.bookingOpensAt) {
    throw new DomainError("BOOKING_WINDOW", `Booking åbner ${formatDateTime(s.bookingOpensAt)}.`);
  }
  if (now >= bookingClosesAt(s)) throw new DomainError("BOOKING_WINDOW", "Bookingen er lukket.");
}

/** The session's access rule, derived from its programme. */
export async function sessionRule(tx: Tx, s: Pick<Session, "levelId" | "minRating" | "maxRating">): Promise<AccessRule> {
  if (!s.levelId) return accessRule(s, null);
  const [level] = await tx.select().from(trainingLevel).where(eq(trainingLevel.id, s.levelId));
  return accessRule(s, level ?? null);
}

const sameChild = (childId: string | null) => (childId ? eq(booking.childId, childId) : isNull(booking.childId));

export async function isOnRoster(tx: Tx, levelId: string | null, userId: string, childId: string | null = null) {
  if (!levelId) return false;
  const [r] = await tx
    .select({ u: levelMember.userId })
    .from(levelMember)
    .where(
      and(
        eq(levelMember.levelId, levelId),
        eq(levelMember.userId, userId),
        childId ? eq(levelMember.childId, childId) : isNull(levelMember.childId),
      ),
    );
  return !!r;
}

/** Children have no DUPR profile in the app: they can book roster and open programmes only. */
export const CHILD_STATE: RatingState = { kind: "NOT_LINKED" };

/** Full eligibility check for one participant (the member, or the member's child) against one session. */
export async function memberEligibility(
  tx: Tx,
  s: Session,
  rule: AccessRule,
  userId: string,
  settings: AppSettings,
  now: Date,
  childId: string | null = null,
) {
  const state = childId ? CHILD_STATE : await loadRatingState(tx, userId, settings, now);
  const onRoster = rule.kind === "ROSTER" ? await isOnRoster(tx, s.levelId, userId, childId) : false;
  return ruleEligibility(rule, state, onRoster);
}

/** The member's own child, or a NOT_FOUND error (never reveals other members' children). */
export async function requireOwnChild(tx: Tx, actor: Actor, childId: string): Promise<Child> {
  const [c] = await tx.select().from(child).where(and(eq(child.id, childId), eq(child.parentId, actor.id)));
  if (!c) throw new DomainError("NOT_FOUND", "Barnet findes ikke på din profil.");
  return c;
}

async function assertEligible(tx: Tx, s: Session, userId: string, settings: AppSettings, now: Date, kid: Child | null = null) {
  const r = await memberEligibility(tx, s, await sessionRule(tx, s), userId, settings, now, kid?.id ?? null);
  if (kid && r.code !== "ELIGIBLE") {
    throw new DomainError(
      "NOT_ELIGIBLE",
      r.code === "NOT_ON_ROSTER"
        ? `${kid.name} er ikke på holdets deltagerliste. Kontakt træneren.`
        : "Børn kan booke børnehold og træninger, der er åbne for alle.",
    );
  }
  switch (r.code) {
    case "ELIGIBLE":
      return;
    case "VERIFY_NEEDED":
      throw new DomainError("RATING_UNVERIFIED", "Din DUPR-rating skal være verificeret og opdateret, før du kan booke.");
    case "LOCKED_LOW":
      throw new DomainError("NOT_ELIGIBLE", `Træningen kræver en rating på mindst ${formatRating(r.min)}.`);
    case "LOCKED_HIGH":
      throw new DomainError(
        "NOT_ELIGIBLE",
        r.exclusive ? `Træningen er for ratings under ${formatRating(r.max)}.` : `Træningen er for ratings op til ${formatRating(r.max)}.`,
      );
    case "NOT_ON_ROSTER":
      throw new DomainError("NOT_ELIGIBLE", "Holdet har en deltagerliste. Kontakt træneren for at komme på holdet.");
    case "DUPR_NEEDED":
      throw new DomainError("RATING_UNVERIFIED", "Eventet kræver, at din DUPR-profil er koblet til.");
  }
}

const sessionLink = (s: Pick<Session, "id">) => `/traeninger/${s.id}`;
const sessionLabel = (s: Pick<Session, "title" | "startsAt">) =>
  `${s.title} (${formatDate(s.startsAt)} kl. ${formatTime(s.startsAt)})`;

async function getUserBooking(tx: Tx, sessionId: string, userId: string, childId: string | null = null) {
  const [b] = await tx
    .select()
    .from(booking)
    .where(and(eq(booking.sessionId, sessionId), eq(booking.userId, userId), sameChild(childId)));
  return b ?? null;
}

/** "Du er" for the member, "Emma er" for a child. */
const forWhom = (kid: Child | null, self: string, other: (name: string) => string) => (kid ? other(kid.name) : self);

/** Runs `fn` in a transaction holding the session lock, then flushes queued emails. */
export async function withSessionLock<T>(
  sessionId: string,
  fn: (tx: Tx, s: Session, effects: Effects, now: Date) => Promise<T>,
): Promise<T> {
  const effects = new Effects();
  const result = await db.transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    const now = new Date();
    await expireOffersLocked(tx, s, effects, now);
    return fn(tx, s, effects, now);
  });
  await effects.flush();
  return result;
}

// ─── Waitlist offers ────────────────────────────────────────────────────────

/** Expire stale offers for a locked session, then pass places on. */
async function expireOffersLocked(tx: Tx, s: Session, effects: Effects, now: Date) {
  const expired = await tx
    .update(booking)
    .set({ status: "EXPIRED", offerExpiresAt: null })
    .where(and(eq(booking.sessionId, s.id), eq(booking.status, "OFFERED"), lte(booking.offerExpiresAt, now)))
    .returning({ userId: booking.userId });
  for (const e of expired) {
    await notify(tx, effects, e.userId, {
      type: "WAITLIST_OFFER_EXPIRED",
      title: "Din venteliste-plads er udløbet",
      body: `Du nåede ikke at acceptere pladsen på ${sessionLabel(s)}, så den er givet videre.`,
      link: sessionLink(s),
    });
  }
  if (expired.length) await offerFreedPlacesLocked(tx, s, effects, now);
}

/** Offer free places to eligible waitlisted members, in join order. Caller holds the session lock. */
export async function offerFreedPlacesLocked(tx: Tx, s: Session, effects: Effects, now: Date, settings?: AppSettings) {
  if (s.status !== "PUBLISHED" || s.startsAt <= now) return;
  const closes = bookingClosesAt(s);
  if (now >= closes) return;
  let free = s.capacity - (await heldCount(tx, s.id, now));
  if (free <= 0) return;

  const cfg = settings ?? (await getSettings(tx));
  const rule = await sessionRule(tx, s);
  const queue = await tx
    .select({ b: booking, link: duprLink, rostered: levelMember.userId, childName: child.name })
    .from(booking)
    .leftJoin(duprLink, eq(duprLink.userId, booking.userId))
    .leftJoin(child, eq(child.id, booking.childId))
    .leftJoin(
      levelMember,
      and(
        eq(levelMember.userId, booking.userId),
        eq(levelMember.levelId, s.levelId ?? ""),
        sql`${levelMember.childId} IS NOT DISTINCT FROM ${booking.childId}`,
      ),
    )
    .where(and(eq(booking.sessionId, s.id), eq(booking.status, "WAITLISTED")))
    .orderBy(asc(booking.waitlistedAt), asc(booking.createdAt));

  for (const { b, link, rostered, childName } of queue) {
    if (free <= 0) break;
    const state = b.childId ? CHILD_STATE : computeRatingState(link, cfg, now, isProviderActive);
    if (ruleEligibility(rule, state, !!rostered).code !== "ELIGIBLE") continue; // keeps queue position
    const expiresAt = new Date(Math.min(now.getTime() + cfg.offerWindowHours * 3600_000, closes.getTime()));
    await tx
      .update(booking)
      .set({ status: "OFFERED", offeredAt: now, offerExpiresAt: expiresAt })
      .where(eq(booking.id, b.id));
    await notify(tx, effects, b.userId, {
      type: "WAITLIST_OFFER",
      title: childName ? `Der er en plads til ${childName}!` : "Der er en plads til dig!",
      body: `En plads er blevet ledig${childName ? ` til ${childName}` : ""} på ${sessionLabel(s)}. Accepter senest ${formatDateTime(expiresAt)}, ellers går pladsen videre.`,
      link: sessionLink(s),
    });
    free--;
  }
}

/** Background job: expire offers across all sessions. */
export async function processExpiredOffers(now = new Date()) {
  const rows = await db
    .selectDistinct({ sessionId: booking.sessionId })
    .from(booking)
    .where(and(eq(booking.status, "OFFERED"), lte(booking.offerExpiresAt, now)));
  for (const r of rows) await withSessionLock(r.sessionId, async () => undefined);
  return rows.length;
}

// ─── Member actions ──────────────────────────────────────────────────────────

export async function bookSession(actor: Actor, sessionId: string, childId: string | null = null) {
  return withSessionLock(sessionId, async (tx, s, effects, now) => {
    const kid = childId ? await requireOwnChild(tx, actor, childId) : null;
    assertBookable(s, now);
    const existing = await getUserBooking(tx, s.id, actor.id, childId);
    if (existing?.status === "CONFIRMED") {
      throw new DomainError("CONFLICT", forWhom(kid, "Du er allerede booket på denne træning.", (n) => `${n} er allerede booket på denne træning.`));
    }
    if (existing?.status === "OFFERED") {
      throw new DomainError("CONFLICT", "Der er et tilbud om en plads — accepter det i stedet.");
    }

    const settings = await getSettings(tx);
    await assertEligible(tx, s, actor.id, settings, now, kid);

    if ((await heldCount(tx, s.id, now)) >= s.capacity) {
      throw new DomainError("SESSION_FULL", "Træningen er fuld. Du kan skrive dig på ventelisten.");
    }

    const values = {
      status: "CONFIRMED" as const,
      confirmedAt: now,
      waitlistedAt: null,
      offeredAt: null,
      offerExpiresAt: null,
      cancelledAt: null,
      cancelledBy: null,
      flag: "NONE" as const,
      flaggedAt: null,
      reminderSentAt: null,
    };
    if (existing) {
      await tx.update(booking).set(values).where(eq(booking.id, existing.id));
    } else {
      await tx.insert(booking).values({ sessionId: s.id, userId: actor.id, childId, ...values });
    }
    await notify(tx, effects, actor.id, {
      type: "BOOKING_CONFIRMED",
      title: kid ? `Booking bekræftet: ${kid.name}` : "Booking bekræftet",
      body: `${forWhom(kid, "Du er", (n) => `${n} er`)} booket på ${sessionLabel(s)} — ${s.locationName}.`,
      link: sessionLink(s),
    });
    return { status: "CONFIRMED" as const };
  });
}

export async function joinWaitlist(actor: Actor, sessionId: string, childId: string | null = null) {
  return withSessionLock(sessionId, async (tx, s, effects, now) => {
    const kid = childId ? await requireOwnChild(tx, actor, childId) : null;
    assertBookable(s, now);
    const existing = await getUserBooking(tx, s.id, actor.id, childId);
    if (existing && ["CONFIRMED", "WAITLISTED", "OFFERED"].includes(existing.status)) {
      throw new DomainError("CONFLICT", forWhom(kid, "Du er allerede tilmeldt denne træning eller dens venteliste.", (n) => `${n} er allerede tilmeldt denne træning eller dens venteliste.`));
    }
    const settings = await getSettings(tx);
    await assertEligible(tx, s, actor.id, settings, now, kid);
    if ((await heldCount(tx, s.id, now)) < s.capacity) {
      throw new DomainError("CONFLICT", "Der er stadig ledige pladser — book direkte i stedet.");
    }
    const values = {
      status: "WAITLISTED" as const,
      waitlistedAt: now,
      confirmedAt: null,
      offeredAt: null,
      offerExpiresAt: null,
      cancelledAt: null,
      cancelledBy: null,
      flag: "NONE" as const,
      flaggedAt: null,
      reminderSentAt: null,
    };
    if (existing) await tx.update(booking).set(values).where(eq(booking.id, existing.id));
    else await tx.insert(booking).values({ sessionId: s.id, userId: actor.id, childId, ...values });

    const position = await waitlistPosition(tx, s.id, actor.id, childId);
    await notify(tx, effects, actor.id, {
      type: "WAITLIST_JOINED",
      title: kid ? `${kid.name} er på ventelisten` : "Du er på ventelisten",
      body: `${forWhom(kid, "Du er", (n) => `${n} er`)} nr. ${position} på ventelisten til ${sessionLabel(s)}. Vi giver besked, hvis der bliver en plads.`,
      link: sessionLink(s),
    });
    return { status: "WAITLISTED" as const, position };
  });
}

export async function waitlistPosition(tx: Tx, sessionId: string, userId: string, childId: string | null = null): Promise<number> {
  const rows = await tx
    .select({ userId: booking.userId, childId: booking.childId })
    .from(booking)
    .where(and(eq(booking.sessionId, sessionId), eq(booking.status, "WAITLISTED")))
    .orderBy(asc(booking.waitlistedAt), asc(booking.createdAt));
  return rows.findIndex((r) => r.userId === userId && (r.childId ?? null) === childId) + 1;
}

export async function acceptOffer(actor: Actor, sessionId: string, childId: string | null = null) {
  return withSessionLock(sessionId, async (tx, s, effects, now) => {
    const kid = childId ? await requireOwnChild(tx, actor, childId) : null;
    const b = await getUserBooking(tx, s.id, actor.id, childId);
    if (!b || b.status !== "OFFERED" || !b.offerExpiresAt || b.offerExpiresAt <= now) {
      throw new DomainError("CONFLICT", "Tilbuddet er ikke længere gyldigt.");
    }
    if (s.status !== "PUBLISHED" || s.startsAt <= now) throw new DomainError("BOOKING_WINDOW", "Træningen kan ikke længere bookes.");
    const settings = await getSettings(tx);
    await assertEligible(tx, s, actor.id, settings, now, kid);
    await tx
      .update(booking)
      .set({ status: "CONFIRMED", confirmedAt: now, offerExpiresAt: null, reminderSentAt: null })
      .where(eq(booking.id, b.id));
    await notify(tx, effects, actor.id, {
      type: "BOOKING_CONFIRMED",
      title: kid ? `Booking bekræftet: ${kid.name}` : "Booking bekræftet",
      body: `${forWhom(kid, "Du har", (n) => `${n} har`)} fået pladsen på ${sessionLabel(s)}.`,
      link: sessionLink(s),
    });
    return { status: "CONFIRMED" as const };
  });
}

/** Cancels a confirmed booking, leaves the waitlist, or declines an offer. */
export async function cancelBooking(actor: Actor, sessionId: string, childId: string | null = null) {
  return withSessionLock(sessionId, async (tx, s, effects, now) => {
    if (childId) await requireOwnChild(tx, actor, childId);
    const b = await getUserBooking(tx, s.id, actor.id, childId);
    if (!b || !["CONFIRMED", "WAITLISTED", "OFFERED"].includes(b.status)) {
      throw new DomainError("NOT_FOUND", "Der er ingen aktiv booking på denne træning.");
    }
    if (b.status === "CONFIRMED") {
      if (s.startsAt <= now) throw new DomainError("BOOKING_WINDOW", "Træningen er startet og kan ikke afmeldes.");
      const settings = await getSettings(tx);
      const cutoff = new Date(s.startsAt.getTime() - settings.cancellationCutoffHours * 3600_000);
      if (now > cutoff) {
        throw new DomainError(
          "BOOKING_WINDOW",
          `Afmelding skal ske senest ${settings.cancellationCutoffHours} timer før start. Kontakt træneren.`,
        );
      }
    }
    const wasHolding = b.status === "CONFIRMED" || b.status === "OFFERED";
    await tx
      .update(booking)
      .set({ status: "CANCELLED", cancelledAt: now, cancelledBy: "MEMBER", offerExpiresAt: null, flag: "NONE" })
      .where(eq(booking.id, b.id));
    if (wasHolding) await offerFreedPlacesLocked(tx, s, effects, now);
    return { previous: b.status };
  });
}

// ─── Admin actions ──────────────────────────────────────────────────────────

export async function adminCancelBooking(actor: Actor, bookingId: string) {
  requireAdmin(actor);
  const [b] = await db.select().from(booking).where(eq(booking.id, bookingId));
  if (!b) throw new DomainError("NOT_FOUND", "Bookingen findes ikke.");
  return withSessionLock(b.sessionId, async (tx, s, effects, now) => {
    const [cur] = await tx.select().from(booking).where(eq(booking.id, bookingId));
    if (!["CONFIRMED", "WAITLISTED", "OFFERED"].includes(cur.status)) {
      throw new DomainError("CONFLICT", "Bookingen er ikke aktiv.");
    }
    await tx
      .update(booking)
      .set({ status: "CANCELLED", cancelledAt: now, cancelledBy: "ADMIN", offerExpiresAt: null })
      .where(eq(booking.id, bookingId));
    const [kid] = cur.childId ? await tx.select().from(child).where(eq(child.id, cur.childId)) : [];
    await notify(tx, effects, cur.userId, {
      type: "BOOKING_CANCELLED_BY_ADMIN",
      title: kid ? `Booking annulleret: ${kid.name}` : "Din booking er annulleret",
      body: `En administrator har annulleret ${kid ? `${kid.name}s` : "din"} tilmelding til ${sessionLabel(s)}.`,
      link: sessionLink(s),
    });
    await audit(tx, {
      actorId: actor.id,
      action: "booking.cancel",
      targetType: "booking",
      targetId: bookingId,
      metadata: { sessionId: s.id, userId: cur.userId, previous: cur.status },
    });
    await offerFreedPlacesLocked(tx, s, effects, now);
  });
}

export async function adminSetAttendance(actor: Actor, bookingId: string, attendance: "ATTENDED" | "NO_SHOW" | "UNKNOWN") {
  requireAdmin(actor);
  const effects = new Effects();
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(booking).where(eq(booking.id, bookingId));
    if (!b) throw new DomainError("NOT_FOUND", "Bookingen findes ikke.");
    if (b.status !== "CONFIRMED") throw new DomainError("CONFLICT", "Fremmøde kan kun registreres for bekræftede bookinger.");
    const [s] = await tx.select().from(trainingSession).where(eq(trainingSession.id, b.sessionId));
    if (s.startsAt > new Date()) throw new DomainError("CONFLICT", "Fremmøde kan først registreres, når træningen er startet.");
    await tx.update(booking).set({ attendance }).where(eq(booking.id, bookingId));
    await audit(tx, { actorId: actor.id, action: "booking.attendance", targetType: "booking", targetId: bookingId, metadata: { attendance } });
    // Milestones belong to the member's own training, not their children's.
    if (attendance === "ATTENDED" && !b.childId) await evaluateAttendanceAchievements(tx, effects, b.userId);
  });
  await effects.flush();
}

/** Bookings that are still holding or waiting for places, for a list of sessions. */
export async function activeBookingsForSessions(tx: Tx, sessionIds: string[]) {
  if (!sessionIds.length) return [];
  return tx
    .select()
    .from(booking)
    .where(and(inArray(booking.sessionId, sessionIds), inArray(booking.status, ["CONFIRMED", "WAITLISTED", "OFFERED"])));
}
