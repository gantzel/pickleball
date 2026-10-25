import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  account,
  booking,
  duprLink,
  notification,
  ratingSnapshot,
  session,
  trainingSession,
  user,
  userAchievement,
} from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Actor } from "./actor";
import { audit } from "./audit";
import { offerFreedPlacesLocked, withSessionLock } from "./bookings";
import { deleteAvatarFile, processAvatar } from "./uploads";

const ProfileInput = z.object({
  name: z.string().trim().min(2, "Navn skal være mindst 2 tegn").max(60, "Navn må højst være 60 tegn"),
  emailNotifications: z.boolean(),
});

export async function updateProfile(actor: Actor, raw: unknown) {
  const p = ProfileInput.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", p.error.issues[0]?.message ?? "Ugyldige oplysninger");
  await db.update(user).set(p.data).where(and(eq(user.id, actor.id), isNull(user.deletedAt)));
}

export async function updateAvatar(actor: Actor, file: { bytes: Buffer; declaredType: string }) {
  const [u] = await db.select({ avatarKey: user.avatarKey }).from(user).where(eq(user.id, actor.id));
  const key = await processAvatar(file.bytes);
  await db.update(user).set({ avatarKey: key }).where(eq(user.id, actor.id));
  if (u?.avatarKey) await deleteAvatarFile(u.avatarKey);
  return key;
}

export async function removeAvatar(actor: Actor) {
  const [u] = await db.select({ avatarKey: user.avatarKey }).from(user).where(eq(user.id, actor.id));
  await db.update(user).set({ avatarKey: null }).where(eq(user.id, actor.id));
  if (u?.avatarKey) await deleteAvatarFile(u.avatarKey);
}

export async function listNotifications(actor: Actor, limit = 30) {
  return db.select().from(notification).where(eq(notification.userId, actor.id)).orderBy(desc(notification.createdAt)).limit(limit);
}

export async function markNotificationsRead(actor: Actor) {
  await db.update(notification).set({ readAt: new Date() }).where(and(eq(notification.userId, actor.id), isNull(notification.readAt)));
}

/**
 * GDPR account deletion. Removes personal data immediately:
 *  - profile (name, email, photo), login credentials and sessions
 *  - DUPR link, rating snapshots, notifications, achievements
 *  - upcoming bookings are cancelled (places passed to the waitlist)
 * Past bookings are kept but anonymised so attendance statistics stay
 * correct; they can no longer be connected to the person.
 */
export async function deleteAccount(actor: Actor) {
  const now = new Date();
  const upcoming = await db
    .select({ sessionId: booking.sessionId })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(and(eq(booking.userId, actor.id), inArray(booking.status, ["CONFIRMED", "WAITLISTED", "OFFERED"]), gt(trainingSession.startsAt, now)))
    .orderBy(asc(trainingSession.startsAt));

  for (const { sessionId } of upcoming) {
    await withSessionLock(sessionId, async (tx, s, effects, n) => {
      await tx
        .update(booking)
        .set({ status: "CANCELLED", cancelledAt: n, cancelledBy: "SYSTEM", offerExpiresAt: null })
        .where(and(eq(booking.sessionId, sessionId), eq(booking.userId, actor.id)));
      await offerFreedPlacesLocked(tx, s, effects, n);
    });
  }

  const [u] = await db.select({ avatarKey: user.avatarKey }).from(user).where(eq(user.id, actor.id));
  await db.transaction(async (tx) => {
    await tx.delete(session).where(eq(session.userId, actor.id));
    await tx.delete(account).where(eq(account.userId, actor.id));
    await tx.delete(duprLink).where(eq(duprLink.userId, actor.id));
    await tx.delete(ratingSnapshot).where(eq(ratingSnapshot.userId, actor.id));
    await tx.delete(notification).where(eq(notification.userId, actor.id));
    await tx.delete(userAchievement).where(eq(userAchievement.userId, actor.id));
    await tx
      .update(user)
      .set({
        name: "Slettet medlem",
        email: `deleted+${randomUUID()}@invalid.local`,
        emailVerified: false,
        image: null,
        avatarKey: null,
        role: "MEMBER",
        emailNotifications: false,
        calendarToken: null,
        deletedAt: now,
      })
      .where(eq(user.id, actor.id));
    await audit(tx, { actorId: null, action: "account.delete", targetType: "user", targetId: actor.id });
  });
  if (u?.avatarKey) await deleteAvatarFile(u.avatarKey);
}
