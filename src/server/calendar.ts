/**
 * Calendar export: a single session as an .ics download, and a personal feed
 * of the member's confirmed bookings that calendar apps subscribe to.
 *
 * The feed URL contains a random secret (calendar apps can't log in). It shows
 * only session details the member is booked on — no other members — and the
 * member can replace it at any time, which makes the old URL stop working.
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { booking, child, trainingSession, user, type TrainingSession } from "@/db/schema";
import { env } from "@/lib/env";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import type { Actor } from "./actor";
import { requireActor } from "./actor";
import { audit } from "./audit";
import { getSessionForMember } from "./sessions";

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const host = () => new URL(env().APP_URL).host;

export function sessionEvent(s: TrainingSession): IcsEvent {
  const url = `${env().APP_URL}/traeninger/${s.id}`;
  return {
    uid: `${s.id}@${host()}`,
    start: s.startsAt,
    end: s.endsAt,
    summary: s.title,
    location: [s.locationName, s.address].filter(Boolean).join(", "),
    description: [s.focus ? `Fokus: ${s.focus}` : null, s.description, url].filter(Boolean).join("\n\n"),
    url,
    cancelled: s.status === "CANCELLED",
    updatedAt: s.updatedAt,
  };
}

/** One session as an .ics file (any session the member can see). */
export async function sessionIcs(actor: Actor, sessionId: string) {
  const v = await getSessionForMember(actor, sessionId);
  return { filename: `traening-${v.session.startsAt.toISOString().slice(0, 10)}.ics`, body: buildIcs([sessionEvent(v.session)], { name: "Copenhagen Pickleball Collective" }) };
}

const newToken = () => randomBytes(24).toString("base64url");

/** The member's feed URL, creating the secret on first use. */
export async function calendarFeedUrl(actor: Actor) {
  requireActor(actor);
  const [u] = await db.select({ token: user.calendarToken }).from(user).where(eq(user.id, actor.id));
  let token = u?.token ?? null;
  if (!token) {
    token = newToken();
    const [row] = await db
      .update(user)
      .set({ calendarToken: token })
      .where(and(eq(user.id, actor.id), isNull(user.calendarToken)))
      .returning({ token: user.calendarToken });
    // A concurrent request may have created it first.
    token = row?.token ?? (await db.select({ token: user.calendarToken }).from(user).where(eq(user.id, actor.id)))[0].token!;
  }
  return feedUrl(token);
}

export function feedUrl(token: string) {
  return `${env().APP_URL}/api/kalender/${token}`;
}

/** Replaces the secret; the old URL stops working immediately. */
export async function rotateCalendarToken(actor: Actor) {
  requireActor(actor);
  const token = newToken();
  await db.update(user).set({ calendarToken: token }).where(eq(user.id, actor.id));
  await audit(db, { actorId: actor.id, action: "calendar.rotate", targetType: "user", targetId: actor.id });
  return feedUrl(token);
}

/** Feed body for a token, or null if the token is unknown. Includes the last 30 days and everything ahead. */
export async function calendarFeed(token: string, now = new Date()) {
  if (!TOKEN_RE.test(token)) return null;
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.calendarToken, token), isNull(user.deletedAt)));
  if (!u) return null;
  const since = new Date(now.getTime() - 30 * 86400_000);
  const rows = await db
    .select({ s: trainingSession, childName: child.name, childId: child.id })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .leftJoin(child, eq(child.id, booking.childId))
    .where(and(eq(booking.userId, u.id), eq(booking.status, "CONFIRMED"), gte(trainingSession.startsAt, since)))
    .orderBy(asc(trainingSession.startsAt));
  return buildIcs(
    // Children's bookings appear in the parent's calendar, labelled with the child's name.
    rows.map((r) => {
      const e = sessionEvent(r.s);
      return r.childId ? { ...e, uid: `${r.childId}.${e.uid}`, summary: `${r.childName}: ${e.summary}` } : e;
    }),
    { name: "Mine træninger — Copenhagen Pickleball Collective", now },
  );
}
