import { sql } from "drizzle-orm";
import { db } from "@/db";
import { duprLink, mockDuprPlayer, trainingLevel, trainingSession, user } from "@/db/schema";
import type { Actor } from "@/server/actor";
import { completeLink, startLink } from "@/server/dupr/link";

export async function resetDb() {
  await db.execute(sql`
    TRUNCATE TABLE booking, training_session, training_level, rating_snapshot, dupr_sync_log, dupr_link,
      dupr_link_request, mock_dupr_player, notification, user_achievement, audit_event, rate_limit_bucket,
      processed_webhook, session, account, verification, rate_limit, "user", app_settings, stored_file, child CASCADE`);
  await db.execute(sql`INSERT INTO app_settings (id) VALUES (1)`);
}

let n = 0;
export async function makeUser(
  role: "MEMBER" | "ADMIN" = "MEMBER",
  name?: string,
  membershipStatus: "PENDING" | "ACTIVE" | "ENDED" = "ACTIVE",
): Promise<Actor> {
  n++;
  const id = `u_${Date.now()}_${n}`;
  await db.insert(user).values({ id, name: name ?? `Spiller ${n}`, email: `${id}@test.local`, role, membershipStatus });
  return { id, role };
}

/** Links a member through the real mock-DUPR flow (state → callback) and syncs. */
export async function linkWithRating(actor: Actor, doubles: number | null, mockId?: string) {
  const id = mockId ?? `MOCK-${actor.id}`;
  await db.insert(mockDuprPlayer).values({ id, name: `Mock ${id}`, doublesRating: doubles, singlesRating: doubles }).onConflictDoNothing();
  const url = new URL(await startLink(actor));
  const params = new URLSearchParams({ state: url.searchParams.get("state")!, code: id });
  return completeLink(actor, params);
}

export async function setMockRating(mockId: string, doubles: number | null) {
  await db.update(mockDuprPlayer).set({ doublesRating: doubles, singlesRating: doubles }).where(sql`${mockDuprPlayer.id} = ${mockId}`);
}

export async function makeSession(opts: Partial<typeof trainingSession.$inferInsert> = {}) {
  const start = new Date(Date.now() + 3 * 86400_000);
  const [s] = await db
    .insert(trainingSession)
    .values({
      title: "Testtræning",
      startsAt: start,
      endsAt: new Date(start.getTime() + 90 * 60_000),
      locationName: "Testhallen",
      capacity: 4,
      status: "PUBLISHED",
      // Rating-gated by default (any verified rating); pass minRating: null for an open session.
      minRating: 1.0,
      ...opts,
    })
    .returning();
  return s;
}

export async function makeLevel(opts: Partial<typeof trainingLevel.$inferInsert> = {}) {
  const [l] = await db
    .insert(trainingLevel)
    .values({ name: `Hold ${++n}`, kind: "LEVEL", minRating: 3.0, maxRating: 3.5, ...opts })
    .returning();
  return l;
}

export async function getLink(userId: string) {
  const [l] = await db.select().from(duprLink).where(sql`${duprLink.userId} = ${userId}`);
  return l;
}
