/**
 * The club structure: rating levels that members move between automatically,
 * plus junior (roster), social (open) and DUPR-event programmes.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { booking, notification, trainingLevel } from "@/db/schema";
import { addToRoster, applyStandardStructure, removeFromRoster, saveLevel, STANDARD_STRUCTURE } from "@/server/admin";
import { bookSession } from "@/server/bookings";
import { syncLink } from "@/server/dupr/sync";
import { accessRule, currentLevel, ruleEligibility, type RatingState } from "@/server/eligibility";
import { createSession, getSessionForMember } from "@/server/sessions";
import { getLink, linkWithRating, makeLevel, makeSession, makeUser, resetDb, setMockRating } from "./helpers";

beforeEach(resetDb);

const verified = (rating: number): RatingState => ({ kind: "VERIFIED", rating, syncedAt: new Date(), provider: "MOCK" });
const level = (minRating: number | null, maxRating: number | null, allowUnrated = false) =>
  ({ kind: "LEVEL" as const, minRating, maxRating, allowUnrated });
const noLimits = { minRating: null, maxRating: null };

describe("access rules (pure)", () => {
  const L1 = level(null, 3.0, true);
  const L2 = level(3.0, 3.5);
  const L3 = level(3.5, 4.0);
  const K = level(4.0, null);
  const check = (l: ReturnType<typeof level>, s: RatingState) => ruleEligibility(accessRule(noLimits, l), s).code;

  it("levels are half-open, so every rating belongs to exactly one level", () => {
    expect(check(L2, verified(3.499))).toBe("ELIGIBLE");
    expect(check(L3, verified(3.499))).toBe("LOCKED_LOW");
    expect(check(L2, verified(3.5))).toBe("LOCKED_HIGH");
    expect(check(L3, verified(3.5))).toBe("ELIGIBLE");
    expect(check(L1, verified(2.999))).toBe("ELIGIBLE");
    expect(check(L1, verified(3.0))).toBe("LOCKED_HIGH");
    expect(check(L3, verified(3.999))).toBe("ELIGIBLE");
    expect(check(K, verified(3.999))).toBe("LOCKED_LOW");
    expect(check(K, verified(4.0))).toBe("ELIGIBLE");
    expect(check(K, verified(6.2))).toBe("ELIGIBLE");
    for (const r of [2.4, 3.0, 3.25, 3.499, 3.5, 3.75, 3.999, 4.0, 5.1]) {
      expect([L1, L2, L3, K].filter((l) => check(l, verified(r)) === "ELIGIBLE")).toHaveLength(1);
    }
  });

  it("Level 1 admits linked beginners without a rating; every other level needs a verified rating", () => {
    expect(check(L1, { kind: "NO_RATING", syncedAt: new Date() })).toBe("ELIGIBLE");
    expect(check(L2, { kind: "NO_RATING", syncedAt: new Date() })).toBe("VERIFY_NEEDED");
    expect(check(L1, { kind: "NOT_LINKED" })).toBe("VERIFY_NEEDED");
    expect(check(L1, { kind: "STALE", rating: 2.5, syncedAt: null })).toBe("VERIFY_NEEDED");
  });

  it("a level's band overrides any limits stored on the session", () => {
    expect(ruleEligibility(accessRule({ minRating: 1, maxRating: 8 }, L2), verified(3.6)).code).toBe("LOCKED_HIGH");
  });

  it("social is open to everyone, also without DUPR — unless the session sets limits", () => {
    const social = { kind: "SOCIAL" as const, minRating: null, maxRating: null, allowUnrated: false };
    expect(ruleEligibility(accessRule(noLimits, social), { kind: "NOT_LINKED" }).code).toBe("ELIGIBLE");
    expect(ruleEligibility(accessRule({ minRating: 3.0, maxRating: null }, social), { kind: "NOT_LINKED" }).code).toBe("VERIFY_NEEDED");
  });

  it("DUPR events need a linked profile, and use the event's own (inclusive) limits", () => {
    const ev = { kind: "EVENT" as const, minRating: null, maxRating: null, allowUnrated: false };
    expect(ruleEligibility(accessRule(noLimits, ev), { kind: "NOT_LINKED" }).code).toBe("DUPR_NEEDED");
    expect(ruleEligibility(accessRule(noLimits, ev), { kind: "NO_RATING", syncedAt: new Date() }).code).toBe("ELIGIBLE");
    const banded = accessRule({ minRating: 3.0, maxRating: 3.5 }, ev);
    expect(ruleEligibility(banded, verified(3.5)).code).toBe("ELIGIBLE");
    expect(ruleEligibility(banded, verified(3.501)).code).toBe("LOCKED_HIGH");
  });

  it("junior programmes use the roster", () => {
    const jr = { kind: "JUNIOR" as const, minRating: null, maxRating: null, allowUnrated: false };
    expect(ruleEligibility(accessRule(noLimits, jr), verified(3.2), false).code).toBe("NOT_ON_ROSTER");
    expect(ruleEligibility(accessRule(noLimits, jr), { kind: "NOT_LINKED" }, true).code).toBe("ELIGIBLE");
  });

  it("only rating levels count for progression", () => {
    const levels = STANDARD_STRUCTURE.map((l, i) => ({ ...l, id: String(i), sortOrder: i }));
    expect(currentLevel(2.1, levels)?.name).toBe("Novice");
    expect(currentLevel(3.5, levels)?.name).toBe("Advanced");
    expect(currentLevel(4.4, levels)?.name).toBe("Competition");
  });
});

describe("members move between levels automatically", () => {
  it("3.42 → 3.51 moves access from Level 2 to Level 3, and back again", async () => {
    const m = await makeUser();
    const l2 = await makeLevel({ name: "Level 2", minRating: 3.0, maxRating: 3.5 });
    const l3 = await makeLevel({ name: "Level 3", minRating: 3.5, maxRating: 4.0 });
    const s2 = await makeSession({ levelId: l2.id, ...noLimits });
    const s3 = await makeSession({ levelId: l3.id, ...noLimits });
    await linkWithRating(m, 3.42, "MOCK-MOVE");
    const code = async (id: string) => (await getSessionForMember(m, id)).availability.code;

    expect(await code(s2.id)).toBe("AVAILABLE");
    expect(await code(s3.id)).toBe("LOCKED_LOW");
    await bookSession(m, s2.id);

    await setMockRating("MOCK-MOVE", 3.51);
    await syncLink((await getLink(m.id)).id, "SCHEDULED");
    expect(await code(s3.id)).toBe("AVAILABLE");
    // The existing Level 2 booking is kept but flagged (default policy), never silently cancelled.
    const [b] = await db.select().from(booking).where(and(eq(booking.sessionId, s2.id), eq(booking.userId, m.id)));
    expect(b).toMatchObject({ status: "CONFIRMED", flag: "RATING_OUT_OF_RANGE" });
    const notes = await db.select().from(notification).where(eq(notification.userId, m.id));
    expect(notes.map((n) => n.type)).toContain("LEVEL_UNLOCKED");

    await setMockRating("MOCK-MOVE", 3.42);
    await syncLink((await getLink(m.id)).id, "SCHEDULED");
    expect(await code(s3.id)).toBe("LOCKED_LOW");
    const [b2] = await db.select().from(booking).where(eq(booking.id, b.id));
    expect(b2.flag).toBe("NONE"); // back in range → flag cleared
    await expect(bookSession(m, s3.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("changing a level's band applies to its existing sessions at once", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeUser();
    await linkWithRating(m, 3.45);
    const l2 = await makeLevel({ minRating: 3.0, maxRating: 3.5 });
    const s = await makeSession({ levelId: l2.id, ...noLimits });
    expect((await getSessionForMember(m, s.id)).availability.code).toBe("AVAILABLE");
    await saveLevel(admin, l2.id, { name: l2.name, kind: "LEVEL", minRating: "3.0", maxRating: "3.4", color: "#2f6b4f" });
    expect((await getSessionForMember(m, s.id)).availability.code).toBe("LOCKED_HIGH");
  });

  it("sessions on a rating level never store their own limits", async () => {
    const admin = await makeUser("ADMIN");
    const l2 = await makeLevel();
    const d = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    const s = await createSession(admin, {
      title: "Level 2 tirsdag", startsAt: `${d}T18:00`, endsAt: `${d}T19:30`, locationName: "Hallen",
      capacity: "12", levelId: l2.id, minRating: "2.0", maxRating: "5.0",
    });
    expect(s).toMatchObject({ minRating: null, maxRating: null });
  });
});

describe("programme administration", () => {
  it("creates the club's standard structure once", async () => {
    const admin = await makeUser("ADMIN");
    expect(await applyStandardStructure(admin)).toBe(7);
    const rows = await db.select().from(trainingLevel);
    expect(rows.map((r) => r.kind).sort()).toEqual(["EVENT", "JUNIOR", "LEVEL", "LEVEL", "LEVEL", "LEVEL", "SOCIAL"]);
    await expect(applyStandardStructure(admin)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(applyStandardStructure(await makeUser())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects overlapping rating levels and levels without a band", async () => {
    const admin = await makeUser("ADMIN");
    await applyStandardStructure(admin);
    await expect(saveLevel(admin, null, { name: "Level 2.5", kind: "LEVEL", minRating: "3.25", maxRating: "3.75", color: "#2f6b4f" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveLevel(admin, null, { name: "Tom", kind: "LEVEL", minRating: "", maxRating: "", color: "#2f6b4f" })).rejects.toMatchObject({ code: "VALIDATION" });
    // Non-rating programmes ignore rating fields.
    const social = await saveLevel(admin, null, { name: "Morgen-social", kind: "SOCIAL", minRating: "3", color: "#2f6b4f" });
    expect(social.minRating).toBeNull();
  });

  it("junior sessions are bookable only by members on the roster", async () => {
    const admin = await makeUser("ADMIN");
    const parent = await makeUser();
    const jr = await makeLevel({ kind: "JUNIOR", minRating: null, maxRating: null });
    const s = await makeSession({ levelId: jr.id, ...noLimits });
    expect((await getSessionForMember(parent, s.id)).availability.code).toBe("NOT_ON_ROSTER");
    await expect(bookSession(parent, s.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const email = (await db.query.user.findFirst({ where: (t, { eq }) => eq(t.id, parent.id) }))!.email;
    await addToRoster(admin, jr.id, email.toUpperCase());
    await addToRoster(admin, jr.id, email); // idempotent
    await expect(bookSession(parent, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });
    await removeFromRoster(admin, jr.id, parent.id);
    expect((await getSessionForMember(parent, s.id)).availability.code).toBe("BOOKED"); // existing booking kept
    await expect(addToRoster(admin, jr.id, "findes-ikke@test.local")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("social play can be booked without DUPR; DUPR events cannot", async () => {
    const m = await makeUser();
    const social = await makeLevel({ kind: "SOCIAL", minRating: null, maxRating: null });
    const ev = await makeLevel({ kind: "EVENT", minRating: null, maxRating: null });
    const s1 = await makeSession({ levelId: social.id, ...noLimits });
    const s2 = await makeSession({ levelId: ev.id, ...noLimits });
    await expect(bookSession(m, s1.id)).resolves.toMatchObject({ status: "CONFIRMED" });
    expect((await getSessionForMember(m, s2.id)).availability.code).toBe("DUPR_NEEDED");
    await expect(bookSession(m, s2.id)).rejects.toMatchObject({ code: "RATING_UNVERIFIED" });
    await linkWithRating(m, null);
    await expect(bookSession(m, s2.id)).resolves.toMatchObject({ status: "CONFIRMED" });
  });
});
