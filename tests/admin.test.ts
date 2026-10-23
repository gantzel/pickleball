import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvent, booking, duprLink, notification, trainingSession } from "@/db/schema";
import { adminMetrics, getSessionAdmin, listSessionsAdmin, cancelSession, completeSession, createSession, duplicateSession, publishSession, updateSession } from "@/server/sessions";
import { adminCancelBooking, adminSetAttendance, bookSession } from "@/server/bookings";
import { deleteLevel, getMemberAdmin, listAudit, listSyncProblems, saveLevel, searchMembers, updateSettings } from "@/server/admin";
import { adminRetrySync } from "@/server/dupr/sync";
import { GET as cronGET } from "@/app/api/cron/tick/route";
import { linkWithRating, makeSession, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const futureLocal = (days: number, hm = "18:00") => {
  const d = new Date(Date.now() + days * 86400_000);
  return `${d.toISOString().slice(0, 10)}T${hm}`;
};

const sessionForm = (o: Record<string, unknown> = {}) => ({
  title: "Mellemgruppe — dink-spil",
  description: "Fokus på bløde slag ved køkkenlinjen.",
  focus: "Dinks",
  startsAt: futureLocal(5, "18:00"),
  endsAt: futureLocal(5, "19:30"),
  locationName: "Valby Idrætspark",
  address: "Julius Andersens Vej 7, 2450 København SV",
  mapUrl: "https://maps.google.com/?q=Valby+Idr%C3%A6tspark",
  minRating: "3.0",
  maxRating: "3.749",
  capacity: "20",
  ...o,
});

describe("non-admins are forbidden from every admin function", () => {
  it("throws FORBIDDEN for members", async () => {
    const m = await makeUser();
    const s = await makeSession();
    const calls: Array<() => Promise<unknown>> = [
      () => createSession(m, sessionForm()),
      () => updateSession(m, s.id, sessionForm()),
      () => publishSession(m, s.id),
      () => cancelSession(m, s.id, "x"),
      () => duplicateSession(m, s.id),
      () => completeSession(m, s.id),
      () => getSessionAdmin(m, s.id),
      () => listSessionsAdmin(m, { scope: "upcoming" }),
      () => adminMetrics(m),
      () => adminCancelBooking(m, "x"),
      () => adminSetAttendance(m, "x", "ATTENDED"),
      () => saveLevel(m, null, { name: "X", minRating: 2, color: "#000000" }),
      () => deleteLevel(m, "x"),
      () => updateSettings(m, {}),
      () => searchMembers(m, ""),
      () => getMemberAdmin(m, m.id),
      () => listSyncProblems(m),
      () => listAudit(m),
      () => adminRetrySync(m, "x"),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.select().from(trainingSession)).length).toBe(1);
  });

  it("cron endpoint requires the secret", async () => {
    const res = await cronGET(new Request("http://localhost/api/cron/tick"));
    expect(res.status).toBe(401);
    const ok = await cronGET(new Request("http://localhost/api/cron/tick", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(ok.status).toBe(200);
  });
});

describe("admin session management", () => {
  it("creates (Copenhagen time), publishes, edits, duplicates and cancels sessions with audit", async () => {
    const admin = await makeUser("ADMIN");
    const s = await createSession(admin, sessionForm({ startsAt: "2027-01-15T18:00", endsAt: "2027-01-15T19:30" }));
    expect(s.status).toBe("DRAFT");
    expect(s.startsAt.toISOString()).toBe("2027-01-15T17:00:00.000Z"); // CET = UTC+1
    expect(s.minRating).toBe(3.0);

    await publishSession(admin, s.id);
    const m = await makeUser();
    await linkWithRating(m, 3.2);
    await bookSession(m, s.id);

    await expect(updateSession(admin, s.id, sessionForm({ startsAt: "2027-01-15T18:00", endsAt: "2027-01-15T19:30", capacity: "0" }))).rejects.toMatchObject({ code: "VALIDATION" });
    const { flagged } = await updateSession(admin, s.id, sessionForm({ startsAt: "2027-01-15T18:00", endsAt: "2027-01-15T19:30", minRating: "3.5", maxRating: "" }));
    expect(flagged).toBe(1); // existing booking flagged, never cancelled
    const [b] = await db.select().from(booking).where(eq(booking.sessionId, s.id));
    expect(b).toMatchObject({ status: "CONFIRMED", flag: "RATING_OUT_OF_RANGE" });

    const detail = await getSessionAdmin(admin, s.id);
    expect(detail.participants).toHaveLength(1);
    expect(detail.participants[0].user.id).toBe(m.id);

    const copy = await duplicateSession(admin, s.id);
    expect(copy.status).toBe("DRAFT");
    expect(copy.startsAt.getTime() - s.startsAt.getTime()).toBe(7 * 86400_000);

    await cancelSession(admin, s.id, "Hallen er lukket");
    const [after] = await db.select().from(booking).where(eq(booking.sessionId, s.id));
    expect(after).toMatchObject({ status: "CANCELLED", cancelledBy: "ADMIN" });
    const notes = await db.select().from(notification).where(eq(notification.userId, m.id));
    expect(notes.some((n) => n.type === "SESSION_CANCELLED")).toBe(true);

    const actions = (await db.select().from(auditEvent)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["session.create", "session.publish", "session.update", "session.duplicate", "session.cancel"]));
  });

  it("validates session input on the server", async () => {
    const admin = await makeUser("ADMIN");
    await expect(createSession(admin, sessionForm({ endsAt: futureLocal(5, "17:00") }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createSession(admin, sessionForm({ minRating: "4", maxRating: "3" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createSession(admin, sessionForm({ mapUrl: "javascript:alert(1)" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createSession(admin, sessionForm({ title: "" }))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("won't reduce capacity below current participants", async () => {
    const admin = await makeUser("ADMIN");
    const s = await createSession(admin, sessionForm({ capacity: "2", minRating: "" }));
    await publishSession(admin, s.id);
    for (let i = 0; i < 2; i++) {
      const m = await makeUser();
      await linkWithRating(m, 3.5);
      await bookSession(m, s.id);
    }
    await expect(updateSession(admin, s.id, sessionForm({ capacity: "1", minRating: "" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records attendance after the session starts and awards a first-training achievement", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeUser();
    await linkWithRating(m, 3.5);
    const s = await makeSession();
    await bookSession(m, s.id);
    const [b] = await db.select().from(booking).where(eq(booking.sessionId, s.id));
    await expect(adminSetAttendance(admin, b.id, "ATTENDED")).rejects.toMatchObject({ code: "CONFLICT" });
    await db.update(trainingSession).set({ startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() - 60_000) }).where(eq(trainingSession.id, s.id));
    await adminSetAttendance(admin, b.id, "ATTENDED");
    await completeSession(admin, s.id);
    const notes = await db.select().from(notification).where(eq(notification.userId, m.id));
    expect(notes.some((n) => n.title.includes("Første træning"))).toBe(true);
  });

  it("admins can view members and sync problems, and retry syncs — but never set a rating", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeUser("MEMBER", "Karla Kant");
    await linkWithRating(m, 3.5);
    const found = await searchMembers(admin, "karla");
    expect(found).toHaveLength(1);
    expect(found[0].ratingState.kind).toBe("VERIFIED");
    const [l] = await db.select().from(duprLink).where(eq(duprLink.userId, m.id));
    await expect(adminRetrySync(admin, l.id)).resolves.toMatchObject({ result: "NO_CHANGE" });
    const metrics = await adminMetrics(admin);
    expect(metrics.linksActive).toBe(1);
    // There is intentionally no admin service that writes a rating.
    const adminModule = await import("@/server/admin");
    expect(Object.keys(adminModule).some((k) => /rating/i.test(k) && /set|update|write/i.test(k))).toBe(false);
  });

  it("validates settings and levels", async () => {
    const admin = await makeUser("ADMIN");
    await expect(updateSettings(admin, { ratingType: "DOUBLES", staleAfterDays: 0, syncIntervalHours: 24, offerWindowHours: 12, cancellationCutoffHours: 2, ratingDropPolicy: "KEEP_AND_FLAG" })).rejects.toMatchObject({ code: "VALIDATION" });
    await updateSettings(admin, { ratingType: "DOUBLES", staleAfterDays: 7, syncIntervalHours: 12, offerWindowHours: 6, cancellationCutoffHours: 4, ratingDropPolicy: "RELEASE_AND_NOTIFY" });
    await expect(saveLevel(admin, null, { name: "Øvet", minRating: 3.5, maxRating: 3.0, color: "#2f6b4f" })).rejects.toMatchObject({ code: "VALIDATION" });
    const l = await saveLevel(admin, null, { name: "Øvet", minRating: 3.0, maxRating: 3.75, color: "#2f6b4f" });
    expect(l.name).toBe("Øvet");
  });
});
