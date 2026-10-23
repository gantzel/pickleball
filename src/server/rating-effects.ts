/**
 * Consequences of a verified rating change. Eligibility itself is computed
 * from the current rating on every read and every booking attempt, so new
 * sessions unlock immediately. This module handles what *persisted* state
 * needs updating: existing bookings, level milestones and notifications.
 *
 * Rating-drop policy (admin-configurable, README → "Rating changes"):
 *  KEEP_AND_FLAG       booking stays; flagged for admins; member notified.
 *  RELEASE_AND_NOTIFY  booking is released to the waitlist; member notified.
 * Bookings are never silently cancelled.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { booking, trainingLevel, trainingSession } from "@/db/schema";
import { formatRating, formatRatingRange } from "@/lib/format";
import { award, levelAchievementCode, VERIFIED_ACHIEVEMENT } from "./achievements";
import { audit } from "./audit";
import { lockSession, loadRatingState, offerFreedPlacesLocked } from "./bookings";
import { Effects } from "./effects";
import { currentLevel, inSessionRange, sortLevels } from "./eligibility";
import { notify, notifyAdmins } from "./notify";
import { getSettings } from "./settings";

export async function applyRatingEffects(userId: string, previous: number | null, now = new Date()) {
  const settings = await getSettings();
  const state = await loadRatingState(db, userId, settings, now);
  if (state.kind !== "VERIFIED") return;
  const rating = state.rating;
  const effects = new Effects();

  // Milestones + level-up notification.
  await db.transaction(async (tx) => {
    await award(tx, effects, userId, VERIFIED_ACHIEVEMENT);
    const levels = sortLevels(await tx.select().from(trainingLevel));
    const now_ = currentLevel(rating, levels);
    const before = previous === null ? null : currentLevel(previous, levels);
    if (now_) {
      await award(tx, effects, userId, { code: levelAchievementCode(now_.id), title: `Nået: ${now_.name}`, description: `Din verificerede rating har nået niveauet ${now_.name}.` }, { rating });
    }
    if (now_ && previous !== null && (!before || Number(now_.minRating) > Number(before.minRating))) {
      await notify(tx, effects, userId, {
        type: "LEVEL_UNLOCKED",
        title: `Nyt niveau låst op: ${now_.name}`,
        body: `Din rating er nu ${formatRating(rating)}. Træninger på ${now_.name} er åbne for dig — en åben træning garanterer dog ikke en plads, hvis den er fuld.`,
        link: "/traeninger",
      });
    }
  });

  // Re-check upcoming bookings against the new rating.
  const upcoming = await db
    .select({ b: booking, s: trainingSession })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(
      and(
        eq(booking.userId, userId),
        inArray(booking.status, ["CONFIRMED", "OFFERED"]),
        eq(trainingSession.status, "PUBLISHED"),
        gt(trainingSession.startsAt, now),
      ),
    )
    .orderBy(asc(trainingSession.startsAt));

  for (const { b, s } of upcoming) {
    const inRange = inSessionRange(rating, s.minRating, s.maxRating);
    if (inRange && b.flag === "NONE") continue;

    await db.transaction(async (tx) => {
      const locked = await lockSession(tx, s.id);
      const [cur] = await tx.select().from(booking).where(eq(booking.id, b.id));
      if (!cur || !["CONFIRMED", "OFFERED"].includes(cur.status)) return;
      const label = `${locked.title}`;
      const range = formatRatingRange(locked.minRating, locked.maxRating);

      if (inRange) {
        if (cur.flag !== "NONE") {
          await tx.update(booking).set({ flag: "NONE", flaggedAt: null }).where(eq(booking.id, cur.id));
        }
        return;
      }

      if (cur.status === "OFFERED") {
        // Return to the queue (keeps position) and pass the place on.
        await tx.update(booking).set({ status: "WAITLISTED", offeredAt: null, offerExpiresAt: null }).where(eq(booking.id, cur.id));
        await notify(tx, effects, userId, {
          type: "OFFER_WITHDRAWN_RATING",
          title: "Tilbud om plads trukket tilbage",
          body: `Din rating (${formatRating(rating)}) ligger uden for ${label} (${range}), så pladsen er givet videre. Du står stadig på ventelisten.`,
          link: `/traeninger/${locked.id}`,
        });
        await offerFreedPlacesLocked(tx, locked, effects, now, settings);
        return;
      }

      if (settings.ratingDropPolicy === "RELEASE_AND_NOTIFY") {
        await tx
          .update(booking)
          .set({ status: "CANCELLED", cancelledAt: now, cancelledBy: "SYSTEM", flag: "RATING_OUT_OF_RANGE", flaggedAt: now })
          .where(eq(booking.id, cur.id));
        await notify(tx, effects, userId, {
          type: "BOOKING_RELEASED_RATING",
          title: "Din booking er frigivet",
          body: `Din opdaterede rating (${formatRating(rating)}) ligger uden for ${label} (${range}). Ifølge klubbens regler er pladsen givet videre. Kontakt træneren, hvis du har spørgsmål.`,
          link: `/traeninger/${locked.id}`,
        });
        await audit(tx, { actorId: null, action: "booking.release_rating", targetType: "booking", targetId: cur.id, metadata: { rating, sessionId: locked.id } });
        await offerFreedPlacesLocked(tx, locked, effects, now, settings);
      } else if (cur.flag === "NONE") {
        await tx.update(booking).set({ flag: "RATING_OUT_OF_RANGE", flaggedAt: now }).where(eq(booking.id, cur.id));
        await notify(tx, effects, userId, {
          type: "BOOKING_FLAGGED_RATING",
          title: "Din rating er ændret",
          body: `Din opdaterede rating (${formatRating(rating)}) ligger uden for ${label} (${range}). Din plads er bevaret, og træneren er orienteret.`,
          link: `/traeninger/${locked.id}`,
        });
        await notifyAdmins(tx, effects, {
          type: "ADMIN_BOOKING_FLAGGED",
          title: "Booking markeret: rating uden for niveau",
          body: `En deltager på ${label} har nu en rating på ${formatRating(rating)} (træningens niveau: ${range}).`,
          link: `/admin/traeninger/${locked.id}`,
        });
        await audit(tx, { actorId: null, action: "booking.flag_rating", targetType: "booking", targetId: cur.id, metadata: { rating, sessionId: locked.id } });
      }
    });
  }
  await effects.flush();
}
