import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { booking, duprLink, ratingSnapshot, trainingLevel, trainingSession, userAchievement } from "@/db/schema";
import type { Actor } from "./actor";
import { describeAchievement, longestWeeklyStreak } from "./achievements";
import { isProviderActive } from "./dupr/provider";
import { computeRatingState, levelProgress, sortLevels } from "./eligibility";
import { getSettings } from "./settings";

/** Everything the dashboard/progress pages need about the member's rating and development. */
export async function memberProgress(actor: Actor, now = new Date()) {
  const settings = await getSettings();
  const [link] = await db.select().from(duprLink).where(eq(duprLink.userId, actor.id));
  const ratingState = computeRatingState(link ?? null, settings, now, isProviderActive);
  const levels = sortLevels(await db.select().from(trainingLevel));

  // Only snapshots from the currently active provider are shown as verified history.
  const snaps = await db
    .select()
    .from(ratingSnapshot)
    .where(eq(ratingSnapshot.userId, actor.id))
    .orderBy(asc(ratingSnapshot.observedAt));
  const field = settings.ratingType === "SINGLES" ? "singlesRating" : "doublesRating";
  const history = snaps
    .filter((s) => isProviderActive(s.provider) && s[field] !== null)
    .map((s) => ({ at: s.observedAt, rating: Number(s[field]), source: s.source }));
  const historyIncludesProvider = history.some((h) => h.source === "PROVIDER_HISTORY");

  const attended = await db
    .select({ s: trainingSession })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(and(eq(booking.userId, actor.id), eq(booking.status, "CONFIRMED"), eq(booking.attendance, "ATTENDED")))
    .orderBy(desc(trainingSession.startsAt));

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);
  const recentAttended = attended.filter((a) => a.s.startsAt >= thirtyDaysAgo).length;

  const achievements = await db.select().from(userAchievement).where(eq(userAchievement.userId, actor.id)).orderBy(desc(userAchievement.awardedAt));
  const levelNames = new Map(levels.map((l) => [l.id, l.name]));

  const progress = ratingState.kind === "VERIFIED" ? levelProgress(ratingState.rating, levels) : null;

  return {
    settings,
    link: link ?? null,
    ratingState,
    levels,
    progress,
    history,
    historyIncludesProvider,
    trackingSince: history[0]?.at ?? link?.linkedAt ?? null,
    attendedCount: attended.length,
    recentAttended,
    longestStreak: longestWeeklyStreak(attended.map((a) => a.s.startsAt)),
    attendedSessions: attended.slice(0, 20).map((a) => a.s),
    achievements: achievements.map((a) => ({ ...describeAchievement(a.code, levelNames), awardedAt: a.awardedAt })),
  };
}

export async function upcomingAttendedCount(userId: string, from: Date, to: Date) {
  const rows = await db
    .select({ id: booking.id })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(and(eq(booking.userId, userId), eq(booking.status, "CONFIRMED"), gte(trainingSession.startsAt, from), lt(trainingSession.startsAt, to)));
  return rows.length;
}
