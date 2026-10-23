import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appSettings, booking, duprLink, duprSyncLog, mockDuprPlayer, notification, ratingSnapshot, user, userAchievement } from "@/db/schema";
import { resetEnvCache } from "@/lib/env";
import { bookSession } from "@/server/bookings";
import { completeLink, startLink, unlink } from "@/server/dupr/link";
import { signMockWebhook } from "@/server/dupr/mock";
import { isProviderActive } from "@/server/dupr/provider";
import { manualSync, runScheduledSync, syncLink } from "@/server/dupr/sync";
import { updateProfile } from "@/server/members";
import { getSessionForMember } from "@/server/sessions";
import { POST as webhookPOST } from "@/app/api/dupr/webhook/route";
import { getLink, linkWithRating, makeSession, makeUser, resetDb, setMockRating } from "./helpers";

beforeEach(resetDb);

describe("linking", () => {
  it("links via a single-use state bound to the member and records a verified snapshot", async () => {
    const m = await makeUser();
    const { outcome } = await linkWithRating(m, 3.456);
    expect(outcome.result).toBe("SUCCESS");
    const l = await getLink(m.id);
    expect(l).toMatchObject({ provider: "MOCK", status: "ACTIVE", doublesRating: 3.456 });
    expect(l.lastSuccessfulSyncAt).toBeInstanceOf(Date);
    const snaps = await db.select().from(ratingSnapshot).where(eq(ratingSnapshot.userId, m.id));
    expect(snaps).toHaveLength(1);
  });

  it("rejects a state used by a different member or used twice", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await db.insert(mockDuprPlayer).values({ id: "MOCK-X", name: "X", doublesRating: 3 });
    const state = new URL(await startLink(a)).searchParams.get("state")!;
    await expect(completeLink(b, new URLSearchParams({ state, code: "MOCK-X" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await completeLink(a, new URLSearchParams({ state, code: "MOCK-X" }));
    await expect(completeLink(a, new URLSearchParams({ state, code: "MOCK-X" }))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("prevents two members linking the same DUPR profile", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await linkWithRating(a, 3.2, "MOCK-SHARED");
    await expect(linkWithRating(b, 3.2, "MOCK-SHARED")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("unlinking removes eligibility", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    await unlink(m);
    const s = await makeSession();
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "RATING_UNVERIFIED" });
  });
});

describe("members cannot set their own rating", () => {
  it("profile updates ignore rating fields", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.0);
    await updateProfile(m, { name: "Ny Navn", emailNotifications: true, doublesRating: 5.5, rating: 5.5, role: "ADMIN" });
    const l = await getLink(m.id);
    expect(l.doublesRating).toBe(3.0);
    const [u] = await db.select().from(user).where(eq(user.id, m.id));
    expect(u.name).toBe("Ny Navn");
    expect(u.role).toBe("MEMBER");
  });

  it("'Sync nu' only re-fetches from the provider and is rate limited", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.0, "MOCK-SYNC");
    await setMockRating("MOCK-SYNC", 3.1);
    await expect(manualSync(m)).resolves.toMatchObject({ result: "SUCCESS", changed: true });
    expect((await getLink(m.id)).doublesRating).toBe(3.1);
    await expect(manualSync(m)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("rating changes update eligibility", () => {
  it("an increase unlocks higher sessions and records a level milestone", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.4, "MOCK-UP");
    const s = await makeSession({ minRating: 3.5 });
    expect((await getSessionForMember(m, s.id)).availability.code).toBe("LOCKED_LOW");
    await setMockRating("MOCK-UP", 3.6);
    const l = await getLink(m.id);
    await syncLink(l.id, "SCHEDULED");
    expect((await getSessionForMember(m, s.id)).availability.code).toBe("AVAILABLE");
    await expect(bookSession(m, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });
    const snaps = await db.select().from(ratingSnapshot).where(eq(ratingSnapshot.userId, m.id));
    expect(snaps.map((x) => x.doublesRating)).toEqual([3.4, 3.6]);
    const ach = await db.select().from(userAchievement).where(eq(userAchievement.userId, m.id));
    expect(ach.map((a) => a.code)).toContain("RATING_VERIFIED");
  });

  it("a decrease locks sessions and flags (but keeps) existing bookings under KEEP_AND_FLAG", async () => {
    const m = await makeUser();
    const admin = await makeUser("ADMIN");
    await linkWithRating(m, 3.6, "MOCK-DOWN");
    const s = await makeSession({ minRating: 3.5 });
    const other = await makeSession({ minRating: 3.5 });
    await bookSession(m, s.id);
    await setMockRating("MOCK-DOWN", 3.3);
    await syncLink((await getLink(m.id)).id, "WEBHOOK");

    const [b] = await db.select().from(booking).where(eq(booking.userId, m.id));
    expect(b.status).toBe("CONFIRMED");
    expect(b.flag).toBe("RATING_OUT_OF_RANGE");
    expect((await getSessionForMember(m, other.id)).availability.code).toBe("LOCKED_LOW");
    const adminNotes = await db.select().from(notification).where(and(eq(notification.userId, admin.id), eq(notification.type, "ADMIN_BOOKING_FLAGGED")));
    expect(adminNotes).toHaveLength(1);

    // Rating recovers → flag clears.
    await setMockRating("MOCK-DOWN", 3.55);
    await syncLink((await getLink(m.id)).id, "SCHEDULED");
    const [b2] = await db.select().from(booking).where(eq(booking.userId, m.id));
    expect(b2.flag).toBe("NONE");
  });

  it("RELEASE_AND_NOTIFY releases the place to the waitlist with a notification", async () => {
    await db.update(appSettings).set({ ratingDropPolicy: "RELEASE_AND_NOTIFY" });
    const [m, w] = [await makeUser(), await makeUser()];
    await linkWithRating(m, 3.6, "MOCK-REL");
    await linkWithRating(w, 3.6);
    const s = await makeSession({ minRating: 3.5, capacity: 1 });
    await bookSession(m, s.id);
    const { joinWaitlist } = await import("@/server/bookings");
    await joinWaitlist(w, s.id);
    await setMockRating("MOCK-REL", 3.2);
    await syncLink((await getLink(m.id)).id, "SCHEDULED");
    const rows = await db.select().from(booking).where(eq(booking.sessionId, s.id));
    expect(rows.find((r) => r.userId === m.id)).toMatchObject({ status: "CANCELLED", cancelledBy: "SYSTEM" });
    expect(rows.find((r) => r.userId === w.id)?.status).toBe("OFFERED");
    const notes = await db.select().from(notification).where(and(eq(notification.userId, m.id), eq(notification.type, "BOOKING_RELEASED_RATING")));
    expect(notes).toHaveLength(1);
  });
});

describe("stale, missing and failed syncs", () => {
  it("a stale rating blocks booking (verification needed)", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    await db.update(duprLink).set({ lastSuccessfulSyncAt: new Date(Date.now() - 20 * 86400_000) }).where(eq(duprLink.userId, m.id));
    const s = await makeSession();
    expect((await getSessionForMember(m, s.id)).availability).toEqual({ code: "VERIFY_NEEDED", reason: "STALE" });
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "RATING_UNVERIFIED" });
  });

  it("a failed sync keeps a recent rating usable, logs the failure and backs off", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5, "MOCK-ERR");
    await db.update(mockDuprPlayer).set({ failMode: "ERROR" }).where(eq(mockDuprPlayer.id, "MOCK-ERR"));
    const l = await getLink(m.id);
    await expect(syncLink(l.id, "SCHEDULED")).resolves.toMatchObject({ result: "FAILED" });
    const after = await getLink(m.id);
    expect(after.status).toBe("ERROR");
    expect(after.consecutiveFailures).toBe(1);
    expect(after.nextSyncAfter!.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect(after.doublesRating).toBe(3.5);
    const s = await makeSession();
    await expect(bookSession(m, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });
    const logs = await db.select().from(duprSyncLog).where(and(eq(duprSyncLog.userId, m.id), eq(duprSyncLog.result, "FAILED")));
    expect(logs).toHaveLength(1);
  });

  it("revoked access blocks booking and notifies the member", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5, "MOCK-REV");
    await db.update(mockDuprPlayer).set({ failMode: "REVOKED" }).where(eq(mockDuprPlayer.id, "MOCK-REV"));
    await syncLink((await getLink(m.id)).id, "SCHEDULED");
    expect((await getLink(m.id)).status).toBe("REVOKED");
    const s = await makeSession();
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "RATING_UNVERIFIED" });
  });

  it("missing rating (no DUPR rating yet) blocks booking", async () => {
    const m = await makeUser();
    const { outcome } = await linkWithRating(m, null);
    expect(outcome.result).toBe("NO_RATING");
    const s = await makeSession({ minRating: null });
    expect((await getSessionForMember(m, s.id)).availability).toEqual({ code: "VERIFY_NEEDED", reason: "NO_RATING" });
  });

  it("rate limits defer the next sync without marking the link as failed", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5, "MOCK-RL");
    await db.update(mockDuprPlayer).set({ failMode: "RATE_LIMIT" }).where(eq(mockDuprPlayer.id, "MOCK-RL"));
    await syncLink((await getLink(m.id)).id, "SCHEDULED");
    const l = await getLink(m.id);
    expect(l.status).toBe("ACTIVE");
    expect(l.nextSyncAfter!.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
  });

  it("scheduled sync only processes due links", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    await linkWithRating(a, 3.5);
    await linkWithRating(b, 3.5);
    await db.update(duprLink).set({ nextSyncAfter: new Date(Date.now() - 1000) }).where(eq(duprLink.userId, a.id));
    const r = await runScheduledSync();
    expect(r.checked).toBe(1);
  });

  it("mock ratings never count when the mock provider is not active (production)", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    (process.env as Record<string, string>).NODE_ENV = "production";
    resetEnvCache();
    try {
      expect(isProviderActive("MOCK")).toBe(false);
      const s = await makeSession();
      await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "RATING_UNVERIFIED" });
    } finally {
      (process.env as Record<string, string>).NODE_ENV = "test";
      resetEnvCache();
    }
  });
});

describe("webhook", () => {
  const post = (body: string, sig: string) =>
    webhookPOST(new Request("http://localhost/api/dupr/webhook", { method: "POST", body, headers: { "x-webhook-signature": sig, "content-type": "application/json" } }));

  it("rejects bad signatures", async () => {
    const res = await post(JSON.stringify({ id: "e1", topic: "RATING", duprIds: [] }), "deadbeef");
    expect(res.status).toBe(401);
  });

  it("re-fetches ratings (never trusts payload values) and is idempotent", async () => {
    const m = await makeUser();
    await linkWithRating(m, 3.0, "MOCK-WH");
    await setMockRating("MOCK-WH", 3.25);
    const body = JSON.stringify({ id: "evt-1", topic: "RATING", duprIds: ["MOCK-WH"], rating: 7.9 });
    const sig = signMockWebhook(body, "test-webhook-secret");
    expect((await post(body, sig)).status).toBe(200);
    expect((await getLink(m.id)).doublesRating).toBe(3.25);
    const replay = await post(body, sig);
    expect(await replay.json()).toMatchObject({ duplicate: true });
  });
});
