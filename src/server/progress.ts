import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { booking, duprLink, levelMember, user, ratingSnapshot, trainingLevel, trainingSession, userAchievement } from "@/db/schema";
import { ruleRangeLabel } from "@/lib/format";
import type { Actor } from "./actor";
import { describeAchievement, longestWeeklyStreak } from "./achievements";
import { isProviderActive } from "./dupr/provider";
import { activeProvider } from "./dupr/provider";
import { accessRule, computeRatingState, levelProgress, ruleEligibility, sortLevels, type RatingState } from "./eligibility";
import type { AppSettings } from "@/db/schema";
import { getSettings } from "./settings";

/** Everything the dashboard/progress pages need about the member's rating and development. */
export async function memberProgress(actor: Actor, now = new Date()) {
  const settings = await getSettings();
  const [link] = await db.select().from(duprLink).where(eq(duprLink.userId, actor.id));
  const ratingState = computeRatingState(link ?? null, settings, now, isProviderActive);
  const allProgrammes = await db.select().from(trainingLevel).orderBy(asc(trainingLevel.sortOrder), asc(trainingLevel.name));
  const levels = sortLevels(allProgrammes);
  const rostered = new Set(
    (await db.select({ levelId: levelMember.levelId }).from(levelMember).where(and(eq(levelMember.userId, actor.id), isNull(levelMember.childId)))).map((r) => r.levelId),
  );
  // "Dine hold": the programmes the member can book right now (no ladder, no comparison).
  const myProgrammes = allProgrammes.flatMap((l) => {
    const rule = accessRule({ minRating: null, maxRating: null }, l);
    if (ruleEligibility(rule, ratingState, rostered.has(l.id)).code !== "ELIGIBLE") return [];
    return [{ id: l.id, name: l.name, color: l.color, description: l.description, access: ruleRangeLabel(rule) }];
  });

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
    .where(and(eq(booking.userId, actor.id), isNull(booking.childId), eq(booking.status, "CONFIRMED"), eq(booking.attendance, "ATTENDED")))
    .orderBy(desc(trainingSession.startsAt));

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);
  const recentAttended = attended.filter((a) => a.s.startsAt >= thirtyDaysAgo).length;

  const achievements = await db.select().from(userAchievement).where(eq(userAchievement.userId, actor.id)).orderBy(desc(userAchievement.awardedAt));
  const levelNames = new Map(levels.map((l) => [l.id, l.name]));

  const progress = ratingState.kind === "VERIFIED" ? levelProgress(ratingState.rating, levels) : null;

  // DUPR events (the club's "DUPR-events" programme) the member took part in.
  const levelKind = new Map(allProgrammes.map((l) => [l.id, l.kind]));
  const eventDates = attended.filter((a) => a.s.levelId && levelKind.get(a.s.levelId) === "EVENT").map((a) => a.s.startsAt);
  const clubRank = await clubRankFor(actor.id, ratingState, settings, now);

  return {
    settings,
    link: link ?? null,
    ratingState,
    levels,
    myProgrammes,
    progress,
    history,
    historyIncludesProvider,
    trackingSince: history[0]?.at ?? link?.linkedAt ?? null,
    attendedCount: attended.length,
    attendedDates: attended.map((a) => a.s.startsAt),
    eventDates,
    clubRank,
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

/**
 * The member's position among club members with a current verified rating
 * (same provider, synced within the staleness window). Only the member's own
 * position and the total are returned — never who is above or below.
 */
export async function clubRankFor(userId: string, state: RatingState, settings: AppSettings, now = new Date()) {
  if (state.kind !== "VERIFIED") return null;
  const provider = activeProvider();
  if (!provider) return null;
  const col = settings.ratingType === "SINGLES" ? duprLink.singlesRating : duprLink.doublesRating;
  const fresh = new Date(now.getTime() - settings.staleAfterDays * 86400_000);
  const [r] = await db
    .select({
      total: sql<number>`count(*)`,
      above: sql<number>`count(*) filter (where ${col} > ${state.rating})`,
    })
    .from(duprLink)
    .innerJoin(user, eq(user.id, duprLink.userId))
    .where(
      and(
        isNull(user.deletedAt),
        eq(duprLink.provider, provider.key),
        sql`${duprLink.status} <> 'REVOKED'`,
        isNotNull(col),
        gte(duprLink.lastSuccessfulSyncAt, fresh),
      ),
    );
  const total = Number(r?.total ?? 0);
  if (!total) return null;
  return { rank: Number(r?.above ?? 0) + 1, total };
}
