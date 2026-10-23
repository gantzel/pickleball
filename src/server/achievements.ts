/**
 * Achievements are awarded only from facts the platform verifies itself:
 * admin-recorded attendance and ratings synced from the active provider.
 * They are never derived from manually entered ratings.
 */
import { and, eq } from "drizzle-orm";
import { type Tx } from "@/db";
import { booking, trainingSession, userAchievement } from "@/db/schema";
import type { Effects } from "./effects";
import { notify } from "./notify";

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
}

export const ATTENDANCE_ACHIEVEMENTS: (AchievementDef & { min: number })[] = [
  { code: "FIRST_TRAINING", min: 1, title: "Første træning", description: "Du deltog i din første træning." },
  { code: "TRAININGS_5", min: 5, title: "Fem på stribe", description: "Fem gennemførte træninger." },
  { code: "TRAININGS_10", min: 10, title: "Fast inventar", description: "Ti gennemførte træninger." },
  { code: "TRAININGS_25", min: 25, title: "Banens stamgæst", description: "25 gennemførte træninger." },
];

export const STREAK_ACHIEVEMENT: AchievementDef = {
  code: "STREAK_4_WEEKS",
  title: "Fire uger i træk",
  description: "Du har trænet fire uger i træk.",
};

export const VERIFIED_ACHIEVEMENT: AchievementDef = {
  code: "RATING_VERIFIED",
  title: "Verificeret spiller",
  description: "Din DUPR-rating er koblet til og verificeret.",
};

export const levelAchievementCode = (levelId: string) => `LEVEL:${levelId}`;

export function describeAchievement(code: string, levelNames: Map<string, string>): AchievementDef {
  const found = [...ATTENDANCE_ACHIEVEMENTS, STREAK_ACHIEVEMENT, VERIFIED_ACHIEVEMENT].find((a) => a.code === code);
  if (found) return found;
  if (code.startsWith("LEVEL:")) {
    const name = levelNames.get(code.slice(6)) ?? "et nyt niveau";
    return { code, title: `Nået: ${name}`, description: `Din verificerede rating har nået niveauet ${name}.` };
  }
  return { code, title: code, description: "" };
}

export async function award(tx: Tx, effects: Effects, userId: string, def: AchievementDef, context?: Record<string, unknown>) {
  const inserted = await tx
    .insert(userAchievement)
    .values({ userId, code: def.code, context: context ?? null })
    .onConflictDoNothing()
    .returning({ id: userAchievement.id });
  if (inserted.length) {
    await notify(tx, effects, userId, {
      type: "ACHIEVEMENT",
      title: `Ny milepæl: ${def.title}`,
      body: def.description,
      link: "/udvikling",
    });
  }
  return inserted.length > 0;
}

export function longestWeeklyStreak(dates: Date[]): number {
  const mondays = [...new Set(dates.map((d) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
    return m.getTime();
  }))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < mondays.length; i++) {
    run = i > 0 && mondays[i] - mondays[i - 1] === 7 * 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export async function evaluateAttendanceAchievements(tx: Tx, effects: Effects, userId: string) {
  const attended = await tx
    .select({ startsAt: trainingSession.startsAt })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(and(eq(booking.userId, userId), eq(booking.attendance, "ATTENDED"), eq(booking.status, "CONFIRMED")));
  for (const a of ATTENDANCE_ACHIEVEMENTS) {
    if (attended.length >= a.min) await award(tx, effects, userId, a, { attended: attended.length });
  }
  if (longestWeeklyStreak(attended.map((a) => a.startsAt)) >= 4) await award(tx, effects, userId, STREAK_ACHIEVEMENT);
}
