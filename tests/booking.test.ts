import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { booking, notification } from "@/db/schema";
import {
  acceptOffer,
  bookSession,
  cancelBooking,
  joinWaitlist,
  processExpiredOffers,
} from "@/server/bookings";
import { getSessionForMember } from "@/server/sessions";
import { linkWithRating, makeSession, makeUser, resetDb } from "./helpers";

const statusOf = async (sessionId: string, userId: string) =>
  (await db.select().from(booking).where(and(eq(booking.sessionId, sessionId), eq(booking.userId, userId))))[0]?.status;

beforeEach(resetDb);

describe("booking eligibility (server-enforced)", () => {
  it("an eligible member can book an available place", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.4);
    const s = await makeSession({ minRating: 3.0, maxRating: 3.75 });
    await expect(bookSession(m, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });
    expect(await statusOf(s.id, m.id)).toBe("CONFIRMED");
    const view = await getSessionForMember(m, s.id);
    expect(view.availability.code).toBe("BOOKED");
    expect(view.remaining).toBe(3);
  });

  it("rejects a member below the minimum, even when calling the service directly", async () => {
    const m = await makeUser();
    await linkWithRating(m, 2.9);
    const s = await makeSession({ minRating: 3.0 });
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(joinWaitlist(m, s.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(await statusOf(s.id, m.id)).toBeUndefined();
  });

  it("rejects a member above the maximum", async () => {
    const m = await makeUser();
    await linkWithRating(m, 4.2);
    const s = await makeSession({ minRating: 3.0, maxRating: 3.75 });
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("rejects members without a linked/verified rating", async () => {
    const m = await makeUser();
    const s = await makeSession({ minRating: null });
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "RATING_UNVERIFIED" });
  });

  it("rejects drafts, cancelled, past and not-yet-open sessions", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.4);
    const draft = await makeSession({ status: "DRAFT" });
    const cancelled = await makeSession({ status: "CANCELLED" });
    const past = await makeSession({ startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() - 60_000) });
    const notOpen = await makeSession({ bookingOpensAt: new Date(Date.now() + 86400_000) });
    await expect(bookSession(m, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bookSession(m, cancelled.id)).rejects.toMatchObject({ code: "BOOKING_WINDOW" });
    await expect(bookSession(m, past.id)).rejects.toMatchObject({ code: "BOOKING_WINDOW" });
    await expect(bookSession(m, notOpen.id)).rejects.toMatchObject({ code: "BOOKING_WINDOW" });
  });
});

describe("capacity and duplicates", () => {
  it("never overbooks under concurrent attempts for the last places", async () => {
    const s = await makeSession({ capacity: 4, minRating: null });
    const members = await Promise.all(Array.from({ length: 20 }, () => makeUser()));
    for (const m of members) await linkWithRating(m, 3.5);

    const results = await Promise.allSettled(members.map((m) => bookSession(m, s.id)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const full = results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "SESSION_FULL").length;
    expect(ok).toBe(4);
    expect(full).toBe(16);
    const confirmed = await db.select().from(booking).where(and(eq(booking.sessionId, s.id), eq(booking.status, "CONFIRMED")));
    expect(confirmed).toHaveLength(4);
  });

  it("prevents duplicate bookings, including concurrent double-clicks", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    const s = await makeSession({ capacity: 10 });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => bookSession(m, s.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await db.select().from(booking).where(eq(booking.sessionId, s.id));
    expect(rows).toHaveLength(1);
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("waitlist", () => {
  it("offers a freed place to the first eligible waitlisted member, who can accept", async () => {
    const s = await makeSession({ capacity: 1, minRating: 3.0 });
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    await linkWithRating(a, 3.5);
    await linkWithRating(b, 3.5);
    await linkWithRating(c, 3.5);
    await bookSession(a, s.id);
    await expect(bookSession(b, s.id)).rejects.toMatchObject({ code: "SESSION_FULL" });
    await expect(joinWaitlist(b, s.id)).resolves.toMatchObject({ position: 1 });
    await expect(joinWaitlist(c, s.id)).resolves.toMatchObject({ position: 2 });

    await cancelBooking(a, s.id);
    expect(await statusOf(s.id, b.id)).toBe("OFFERED");
    expect(await statusOf(s.id, c.id)).toBe("WAITLISTED");
    // The offered place is held: c cannot grab it directly.
    await expect(bookSession(c, s.id)).rejects.toMatchObject({ code: "SESSION_FULL" });

    const notes = await db.select().from(notification).where(and(eq(notification.userId, b.id), eq(notification.type, "WAITLIST_OFFER")));
    expect(notes).toHaveLength(1);

    await acceptOffer(b, s.id);
    expect(await statusOf(s.id, b.id)).toBe("CONFIRMED");
  });

  it("skips waitlisted members who are no longer eligible, keeping their position", async () => {
    const s = await makeSession({ capacity: 1, minRating: 3.0 });
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    await linkWithRating(a, 3.5);
    await linkWithRating(b, 3.5, "MOCK-B");
    await linkWithRating(c, 3.5);
    await bookSession(a, s.id);
    await joinWaitlist(b, s.id);
    await joinWaitlist(c, s.id);
    // b's verified rating drops below the session minimum.
    const { setMockRating } = await import("./helpers");
    const { manualSync } = await import("@/server/dupr/sync");
    await setMockRating("MOCK-B", 2.8);
    await manualSync(b);

    await cancelBooking(a, s.id);
    expect(await statusOf(s.id, b.id)).toBe("WAITLISTED");
    expect(await statusOf(s.id, c.id)).toBe("OFFERED");
  });

  it("expires unaccepted offers and passes the place on", async () => {
    const s = await makeSession({ capacity: 1 });
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    for (const m of [a, b, c]) await linkWithRating(m, 3.5);
    await bookSession(a, s.id);
    await joinWaitlist(b, s.id);
    await joinWaitlist(c, s.id);
    await cancelBooking(a, s.id);
    expect(await statusOf(s.id, b.id)).toBe("OFFERED");

    await db.update(booking).set({ offerExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(booking.sessionId, s.id), eq(booking.userId, b.id)));
    await processExpiredOffers();
    expect(await statusOf(s.id, b.id)).toBe("EXPIRED");
    expect(await statusOf(s.id, c.id)).toBe("OFFERED");
    await expect(acceptOffer(b, s.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("can't join the waitlist while places remain", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    const s = await makeSession({ capacity: 3 });
    await expect(joinWaitlist(m, s.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("cancellation", () => {
  it("frees capacity on cancel and allows re-booking", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    const s = await makeSession({ capacity: 1 });
    await bookSession(m, s.id);
    await cancelBooking(m, s.id);
    expect(await statusOf(s.id, m.id)).toBe("CANCELLED");
    await expect(bookSession(m, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("blocks member cancellation inside the cut-off window", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    const start = new Date(Date.now() + 60 * 60_000); // 1h away, cut-off is 2h
    const s = await makeSession({ startsAt: start, endsAt: new Date(start.getTime() + 3600_000) });
    await bookSession(m, s.id);
    await expect(cancelBooking(m, s.id)).rejects.toMatchObject({ code: "BOOKING_WINDOW" });
  });
});
