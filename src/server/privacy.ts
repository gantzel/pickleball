/**
 * GDPR support: a member's own data export (right of access / portability)
 * and the retention job that deletes data we no longer need.
 */
import { and, asc, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvent,
  booking,
  child,
  duprLink,
  duprLinkRequest,
  duprSyncLog,
  notification,
  processedWebhook,
  rateLimit,
  rateLimitBucket,
  ratingSnapshot,
  session,
  trainingSession,
  user,
  userAchievement,
  verification,
} from "@/db/schema";
import type { Actor } from "./actor";
import { RETENTION } from "@/lib/retention";
import { rateLimit as limit } from "./rate-limit";

export { RETENTION };

export async function exportMyData(actor: Actor) {
  await limit(`export:${actor.id}`, 5, 3600, "Du kan hente dine data igen om lidt.");
  const [u] = await db
    .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: user.role, emailNotifications: user.emailNotifications, membershipStatus: user.membershipStatus, membershipPaidThrough: user.paidThrough, hasProfilePhoto: sql<boolean>`${user.avatarKey} IS NOT NULL`, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, actor.id));
  const [link] = await db
    .select({ provider: duprLink.provider, duprId: duprLink.externalId, displayName: duprLink.displayName, status: duprLink.status, linkedAt: duprLink.linkedAt, doublesRating: duprLink.doublesRating, singlesRating: duprLink.singlesRating, lastSuccessfulSyncAt: duprLink.lastSuccessfulSyncAt })
    .from(duprLink)
    .where(eq(duprLink.userId, actor.id));
  const ratingHistory = await db
    .select({ observedAt: ratingSnapshot.observedAt, doublesRating: ratingSnapshot.doublesRating, singlesRating: ratingSnapshot.singlesRating, source: ratingSnapshot.source, provider: ratingSnapshot.provider })
    .from(ratingSnapshot)
    .where(eq(ratingSnapshot.userId, actor.id))
    .orderBy(asc(ratingSnapshot.observedAt));
  const bookings = await db
    .select({ participant: sql<string>`coalesce(${child.name}, 'Dig')`, session: trainingSession.title, startsAt: trainingSession.startsAt, location: trainingSession.locationName, status: booking.status, attendance: booking.attendance, bookedAt: booking.createdAt, cancelledAt: booking.cancelledAt, cancelledBy: booking.cancelledBy })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .leftJoin(child, eq(child.id, booking.childId))
    .where(eq(booking.userId, actor.id))
    .orderBy(desc(trainingSession.startsAt));
  const children = await db.select({ name: child.name, birthYear: child.birthYear, addedAt: child.createdAt }).from(child).where(eq(child.parentId, actor.id));
  const achievements = await db.select({ code: userAchievement.code, awardedAt: userAchievement.awardedAt }).from(userAchievement).where(eq(userAchievement.userId, actor.id));
  const notifications = await db
    .select({ title: notification.title, body: notification.body, createdAt: notification.createdAt, readAt: notification.readAt })
    .from(notification)
    .where(eq(notification.userId, actor.id))
    .orderBy(desc(notification.createdAt));
  const syncLog = await db
    .select({ at: duprSyncLog.createdAt, trigger: duprSyncLog.trigger, result: duprSyncLog.result })
    .from(duprSyncLog)
    .where(eq(duprSyncLog.userId, actor.id))
    .orderBy(desc(duprSyncLog.createdAt));
  const sessions = await db.select({ createdAt: session.createdAt, expiresAt: session.expiresAt, userAgent: session.userAgent }).from(session).where(eq(session.userId, actor.id));

  return {
    exportedAt: new Date().toISOString(),
    about: "Dine personoplysninger hos Copenhagen Pickleball Collective. Se /privatliv for hvordan de bruges.",
    profile: u,
    dupr: link ?? null,
    children,
    ratingHistory,
    bookings,
    achievements,
    notifications,
    duprSyncLog: syncLog,
    loginSessions: sessions,
  };
}

/** Deletes data past its retention period. Safe to run repeatedly (called by the cron tick). */
export async function runRetention(now = new Date()) {
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
  const count = async (p: Promise<unknown[]>) => (await p).length;
  return {
    syncLogs: await count(db.delete(duprSyncLog).where(lt(duprSyncLog.createdAt, daysAgo(RETENTION.syncLogDays))).returning({ id: duprSyncLog.id })),
    notifications: await count(
      db
        .delete(notification)
        .where(or(and(isNotNull(notification.readAt), lt(notification.createdAt, daysAgo(RETENTION.readNotificationDays))), lt(notification.createdAt, daysAgo(RETENTION.anyNotificationDays))))
        .returning({ id: notification.id }),
    ),
    auditEvents: await count(db.delete(auditEvent).where(lt(auditEvent.createdAt, daysAgo(RETENTION.auditDays))).returning({ id: auditEvent.id })),
    linkRequests: await count(db.delete(duprLinkRequest).where(lt(duprLinkRequest.expiresAt, daysAgo(1))).returning({ id: duprLinkRequest.id })),
    webhookIds: await count(db.delete(processedWebhook).where(lt(processedWebhook.receivedAt, daysAgo(RETENTION.webhookIdDays))).returning({ id: processedWebhook.id })),
    expiredSessions: await count(db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id })),
    expiredVerifications: await count(db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id })),
    rateLimitBuckets: await count(db.delete(rateLimitBucket).where(lt(rateLimitBucket.windowStart, daysAgo(1))).returning({ key: rateLimitBucket.key })),
    authRateLimits: await count(db.delete(rateLimit).where(lt(rateLimit.lastRequest, now.getTime() - 86400_000)).returning({ id: rateLimit.id })),
  };
}
