/**
 * Day-before reminders for confirmed bookings, sent by the background job.
 *
 * A booking gets one reminder when its session starts within the next
 * REMINDER_WINDOW_HOURS, unless the session starts in less than
 * MIN_LEAD_HOURS (a last-minute booking needs no reminder). The reminder is
 * claimed with a single UPDATE … RETURNING, so overlapping job runs can never
 * send it twice. Re-booking or moving the session resets it.
 */
import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { booking, trainingSession } from "@/db/schema";
import { formatDate, formatTime } from "@/lib/format";
import { Effects } from "./effects";
import { notify } from "./notify";
import { getSettings } from "./settings";

export const REMINDER_WINDOW_HOURS = 24;
export const MIN_LEAD_HOURS = 2;

export async function sendDueReminders(now = new Date()) {
  const from = new Date(now.getTime() + MIN_LEAD_HOURS * 3600_000);
  const to = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 3600_000);
  const due = db
    .select({ id: booking.id })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(
      and(
        eq(booking.status, "CONFIRMED"),
        isNull(booking.reminderSentAt),
        eq(trainingSession.status, "PUBLISHED"),
        gt(trainingSession.startsAt, from),
        lte(trainingSession.startsAt, to),
      ),
    );

  const settings = await getSettings();
  const effects = new Effects();
  const sent = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(booking)
      .set({ reminderSentAt: now })
      .where(and(inArray(booking.id, due), isNull(booking.reminderSentAt)))
      .returning({ userId: booking.userId, sessionId: booking.sessionId });
    if (!claimed.length) return 0;
    const sessions = await tx
      .select()
      .from(trainingSession)
      .where(inArray(trainingSession.id, [...new Set(claimed.map((c) => c.sessionId))]));
    const byId = new Map(sessions.map((s) => [s.id, s]));
    for (const c of claimed) {
      const s = byId.get(c.sessionId)!;
      const cutoff = settings.cancellationCutoffHours;
      await notify(tx, effects, c.userId, {
        type: "SESSION_REMINDER",
        title: `Påmindelse: ${s.title} ${formatDate(s.startsAt).toLowerCase()} kl. ${formatTime(s.startsAt)}`,
        body:
          `Du er booket på ${s.title} ${formatDate(s.startsAt).toLowerCase()} kl. ${formatTime(s.startsAt)} — ${s.locationName}${s.address ? `, ${s.address}` : ""}.` +
          (cutoff > 0
            ? ` Kan du ikke komme, så afmeld senest ${cutoff} ${cutoff === 1 ? "time" : "timer"} før start, så pladsen kan gå videre.`
            : " Kan du ikke komme, så afmeld, så pladsen kan gå videre."),
        link: `/traeninger/${s.id}`,
      });
    }
    return claimed.length;
  });
  await effects.flush();
  return sent;
}

/** For tests/diagnostics: confirmed bookings still waiting for a reminder. */
export async function pendingReminderCount() {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(booking)
    .where(and(eq(booking.status, "CONFIRMED"), isNull(booking.reminderSentAt)));
  return Number(r?.n ?? 0);
}
