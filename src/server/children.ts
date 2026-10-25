/**
 * Children on a parent's profile. A child has no login: the parent books on
 * the child's behalf, and the child's name (labelled "Barn") is what appears
 * on rosters and participant lists. Only name and birth year are stored.
 *
 * Membership age (club bylaws § 3): 11 years. With only the birth year we
 * accept a child from the calendar year they turn 11.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { booking, child, trainingSession } from "@/db/schema";
import { CLUB_TZ } from "@/lib/format";
import { DomainError } from "@/lib/errors";
import type { Actor } from "./actor";
import { requireActor } from "./actor";
import { audit } from "./audit";
import { offerFreedPlacesLocked, withSessionLock } from "./bookings";

export const MIN_CHILD_AGE = 11;
export const MAX_CHILD_AGE = 17;
const MAX_CHILDREN = 8;

const currentYear = (now = new Date()) => Number(new Intl.DateTimeFormat("en", { timeZone: CLUB_TZ, year: "numeric" }).format(now));

const ChildInput = z.object({
  name: z.string().trim().min(2, "Skriv barnets navn").max(60, "Navnet er for langt"),
  birthYear: z.coerce.number().int("Skriv et årstal").min(1990).max(2100),
});

function parseChild(raw: unknown, now = new Date()) {
  const p = ChildInput.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", p.error.issues[0]?.message ?? "Ugyldige oplysninger");
  const age = currentYear(now) - p.data.birthYear;
  if (age < MIN_CHILD_AGE) throw new DomainError("VALIDATION", `Man skal være mindst ${MIN_CHILD_AGE} år for at blive medlem af klubben.`);
  if (age > MAX_CHILD_AGE) throw new DomainError("VALIDATION", "Er barnet fyldt 18, skal det have sin egen konto.");
  return p.data;
}

export async function listChildren(actor: Actor) {
  requireActor(actor);
  return db.select().from(child).where(eq(child.parentId, actor.id)).orderBy(asc(child.createdAt));
}

export async function addChild(actor: Actor, raw: unknown) {
  requireActor(actor);
  const v = parseChild(raw);
  const existing = await listChildren(actor);
  if (existing.length >= MAX_CHILDREN) throw new DomainError("CONFLICT", "Du kan højst have otte børn på din profil.");
  const [row] = await db.insert(child).values({ ...v, parentId: actor.id }).returning();
  await audit(db, { actorId: actor.id, action: "child.add", targetType: "child", targetId: row.id });
  return row;
}

export async function updateChild(actor: Actor, childId: string, raw: unknown) {
  requireActor(actor);
  const v = parseChild(raw);
  const [row] = await db.update(child).set(v).where(and(eq(child.id, childId), eq(child.parentId, actor.id))).returning();
  if (!row) throw new DomainError("NOT_FOUND", "Barnet findes ikke på din profil.");
  return row;
}

/** Releases the child's upcoming places (so others get them), then deletes the child and its history. */
export async function removeChild(actor: Actor, childId: string, now = new Date()) {
  requireActor(actor);
  const [c] = await db.select().from(child).where(and(eq(child.id, childId), eq(child.parentId, actor.id)));
  if (!c) throw new DomainError("NOT_FOUND", "Barnet findes ikke på din profil.");
  await releaseChildPlaces([childId], now);
  await db.delete(child).where(eq(child.id, childId));
  await audit(db, { actorId: actor.id, action: "child.remove", targetType: "child", targetId: childId });
}

/** Cancels upcoming bookings/waitlist entries for these children and passes the places on. */
export async function releaseChildPlaces(childIds: string[], now = new Date()) {
  if (!childIds.length) return;
  const upcoming = await db
    .selectDistinct({ sessionId: booking.sessionId })
    .from(booking)
    .innerJoin(trainingSession, eq(trainingSession.id, booking.sessionId))
    .where(and(inArray(booking.childId, childIds), inArray(booking.status, ["CONFIRMED", "WAITLISTED", "OFFERED"]), gt(trainingSession.startsAt, now)));
  for (const { sessionId } of upcoming) {
    await withSessionLock(sessionId, async (tx, s, effects, n) => {
      await tx
        .update(booking)
        .set({ status: "CANCELLED", cancelledAt: n, cancelledBy: "SYSTEM", offerExpiresAt: null })
        .where(and(eq(booking.sessionId, sessionId), inArray(booking.childId, childIds), inArray(booking.status, ["CONFIRMED", "WAITLISTED", "OFFERED"])));
      await offerFreedPlacesLocked(tx, s, effects, n);
    });
  }
}
