import { describe, expect, it } from "vitest";
import {
  computeAvailability,
  computeRatingState,
  currentLevel,
  inSessionRange,
  levelProgress,
  nextLevel,
  type RatingState,
} from "@/server/eligibility";

const now = new Date("2026-10-23T10:00:00Z");
const settings = { ratingType: "DOUBLES" as const, staleAfterDays: 14 };
const active = () => true;
const link = (o: Partial<Parameters<typeof computeRatingState>[0] & object> = {}) => ({
  provider: "MOCK" as const,
  status: "ACTIVE" as const,
  doublesRating: 3.5,
  singlesRating: 3.2,
  lastSuccessfulSyncAt: new Date(now.getTime() - 86400_000),
  lastError: null,
  ...o,
});

describe("computeRatingState", () => {
  it("is VERIFIED for a fresh synced rating", () => {
    const s = computeRatingState(link(), settings, now, active);
    expect(s).toMatchObject({ kind: "VERIFIED", rating: 3.5 });
  });
  it("uses the configured rating type", () => {
    const s = computeRatingState(link(), { ...settings, ratingType: "SINGLES" }, now, active);
    expect(s).toMatchObject({ kind: "VERIFIED", rating: 3.2 });
  });
  it("is STALE when the last successful sync is older than the policy", () => {
    const s = computeRatingState(link({ lastSuccessfulSyncAt: new Date(now.getTime() - 15 * 86400_000) }), settings, now, active);
    expect(s.kind).toBe("STALE");
  });
  it("is STALE when never synced", () => {
    expect(computeRatingState(link({ lastSuccessfulSyncAt: null }), settings, now, active).kind).toBe("STALE");
  });
  it("keeps a recent rating VERIFIED with a warning when the latest sync failed", () => {
    const s = computeRatingState(link({ status: "ERROR" }), settings, now, active);
    expect(s.kind).toBe("VERIFIED");
    expect(s.kind === "VERIFIED" && s.warning).toBeTruthy();
  });
  it("handles revoked, missing rating, unlinked and inactive provider", () => {
    expect(computeRatingState(link({ status: "REVOKED" }), settings, now, active).kind).toBe("REVOKED");
    expect(computeRatingState(link({ doublesRating: null }), settings, now, active).kind).toBe("NO_RATING");
    expect(computeRatingState(null, settings, now, active).kind).toBe("NOT_LINKED");
    expect(computeRatingState(link(), settings, now, () => false).kind).toBe("INTEGRATION_UNAVAILABLE");
  });
});

describe("computeAvailability", () => {
  const verified = (rating: number): RatingState => ({ kind: "VERIFIED", rating, syncedAt: now, provider: "MOCK" });
  const session = {
    status: "PUBLISHED" as const,
    startsAt: new Date(now.getTime() + 86400_000),
    minRating: 3.0,
    maxRating: 3.75,
    capacity: 10,
    bookingOpensAt: null,
    bookingClosesAt: null,
  };
  const base = { session, heldCount: 3, booking: null, ratingState: verified(3.4), now };

  it("AVAILABLE when eligible with places", () => {
    expect(computeAvailability(base)).toEqual({ code: "AVAILABLE", remaining: 7 });
  });
  it("FULL_WAITLIST when eligible and full", () => {
    expect(computeAvailability({ ...base, heldCount: 10 }).code).toBe("FULL_WAITLIST");
  });
  it("LOCKED_LOW / LOCKED_HIGH outside range (inclusive bounds)", () => {
    expect(computeAvailability({ ...base, ratingState: verified(2.999) })).toMatchObject({ code: "LOCKED_LOW", min: 3 });
    expect(computeAvailability({ ...base, ratingState: verified(3.751) })).toMatchObject({ code: "LOCKED_HIGH", max: 3.75 });
    expect(computeAvailability({ ...base, ratingState: verified(3.0) }).code).toBe("AVAILABLE");
    expect(computeAvailability({ ...base, ratingState: verified(3.75) }).code).toBe("AVAILABLE");
  });
  it("VERIFY_NEEDED for any non-verified rating", () => {
    expect(computeAvailability({ ...base, ratingState: { kind: "STALE", rating: 3.4, syncedAt: null } })).toEqual({ code: "VERIFY_NEEDED", reason: "STALE" });
  });
  it("booking states take precedence", () => {
    expect(computeAvailability({ ...base, booking: { status: "CONFIRMED", offerExpiresAt: null, flag: "NONE" } }).code).toBe("BOOKED");
    expect(computeAvailability({ ...base, booking: { status: "WAITLISTED", offerExpiresAt: null, flag: "NONE" }, waitlistPosition: 2 })).toEqual({ code: "WAITLISTED", position: 2 });
    expect(computeAvailability({ ...base, booking: { status: "OFFERED", offerExpiresAt: new Date(now.getTime() + 1000), flag: "NONE" } }).code).toBe("OFFERED");
  });
  it("respects booking windows", () => {
    expect(computeAvailability({ ...base, session: { ...session, bookingOpensAt: new Date(now.getTime() + 1000) } }).code).toBe("NOT_OPEN");
    expect(computeAvailability({ ...base, session: { ...session, bookingClosesAt: new Date(now.getTime() - 1000) } }).code).toBe("CLOSED");
  });
});

describe("levels", () => {
  const levels = [
    { id: "a", name: "Begynder", minRating: 2.0, maxRating: 3.0, sortOrder: 0, color: "#000000" },
    { id: "b", name: "Øvet", minRating: 3.0, maxRating: 3.75, sortOrder: 1, color: "#000000" },
    { id: "c", name: "Avanceret", minRating: 3.75, maxRating: null, sortOrder: 2, color: "#000000" },
  ];
  it("finds the current and next level with half-open ranges", () => {
    expect(currentLevel(3.0, levels)?.id).toBe("b");
    expect(currentLevel(2.999, levels)?.id).toBe("a");
    expect(nextLevel(3.2, levels)?.id).toBe("c");
    expect(nextLevel(4.5, levels)).toBeNull();
  });
  it("computes the gap to the next level", () => {
    const p = levelProgress(3.5, levels);
    expect(p.next?.id).toBe("c");
    expect(p.gap).toBe(0.25);
    expect(p.progress).toBeCloseTo(0.6667, 3);
  });
  it("inSessionRange compares at DUPR precision", () => {
    expect(inSessionRange(0.1 + 0.2 + 2.7, 3.0, null)).toBe(true);
  });
});
