import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { booking, notification, trainingSession } from "@/db/schema";
import { buildIcs, escapeText, foldLine } from "@/lib/ics";
import { applyStandardStructure, countTestSessions, createTestSessions, deleteTestSessions } from "@/server/admin";
import { bookSession, cancelBooking } from "@/server/bookings";
import { calendarFeed, calendarFeedUrl, rotateCalendarToken, sessionIcs } from "@/server/calendar";
import { testOutbox } from "@/server/mailer";
import { deleteAccount } from "@/server/members";
import { sendDueReminders } from "@/server/reminders";
import { makeSession, makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  testOutbox.length = 0;
});

const inHours = (h: number) => new Date(Date.now() + h * 3600_000);
const openSession = (hours: number, extra: Partial<typeof trainingSession.$inferInsert> = {}) =>
  makeSession({ minRating: null, startsAt: inHours(hours), endsAt: inHours(hours + 1.5), ...extra });

describe("day-before reminders", () => {
  it("sends exactly one reminder for bookings starting within 24 hours", async () => {
    const m = await makeUser();
    const soon = await openSession(20, { title: "Tirsdagstræning" });
    const later = await openSession(30);
    const tooSoon = await openSession(1);
    for (const s of [soon, later, tooSoon]) await bookSession(m, s.id);
    testOutbox.length = 0;

    expect(await sendDueReminders()).toBe(1);
    expect(await sendDueReminders()).toBe(0); // never twice
    const notes = await db.select().from(notification).where(eq(notification.userId, m.id));
    expect(notes.filter((n) => n.type === "SESSION_REMINDER")).toHaveLength(1);
    expect(testOutbox).toHaveLength(1);
    expect(testOutbox[0].subject).toContain("Påmindelse: Tirsdagstræning");
    expect(testOutbox[0].text).toContain("afmeld senest");
  });

  it("skips cancelled bookings, and re-booking gives a fresh reminder", async () => {
    const m = await makeUser();
    const s = await openSession(20);
    await bookSession(m, s.id);
    await sendDueReminders();
    await cancelBooking(m, s.id);
    expect(await sendDueReminders()).toBe(0);
    await bookSession(m, s.id);
    expect(await sendDueReminders()).toBe(1);
  });

  it("concurrent job runs cannot double-send", async () => {
    const members = await Promise.all([1, 2, 3].map(() => makeUser()));
    const s = await openSession(10, { capacity: 10 });
    for (const m of members) await bookSession(m, s.id);
    const results = await Promise.all([sendDueReminders(), sendDueReminders(), sendDueReminders()]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("calendar", () => {
  it("escapes text and folds long lines per RFC 5545", () => {
    expect(escapeText("Hal 2, Valby; kl. 18\nTag sko med\\")).toBe("Hal 2\\, Valby\\; kl. 18\\nTag sko med\\\\");
    const long = "DESCRIPTION:" + "æ".repeat(60);
    const folded = foldLine(long);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(long);
    const ics = buildIcs([{ uid: "x@y", start: new Date("2027-01-05T17:00:00Z"), end: new Date("2027-01-05T18:30:00Z"), summary: "Træning" }], { name: "Test" });
    expect(ics).toContain("DTSTART:20270105T170000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("exports a single session the member can see", async () => {
    const m = await makeUser();
    const s = await openSession(48, { title: "Social Play fredag", locationName: "Østerbro Idrætshus" });
    const { body, filename } = await sessionIcs(m, s.id);
    expect(filename).toMatch(/^traening-\d{4}-\d{2}-\d{2}\.ics$/);
    expect(body).toContain("SUMMARY:Social Play fredag");
    expect(body).toContain("LOCATION:Østerbro Idrætshus");
    const draft = await openSession(48, { status: "DRAFT" });
    await expect(sessionIcs(m, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the personal feed lists confirmed bookings only, and rotating the link revokes the old one", async () => {
    const m = await makeUser();
    const other = await makeUser();
    const a = await openSession(48, { title: "Booket træning" });
    const b = await openSession(72, { title: "Afmeldt træning" });
    const c = await openSession(96, { title: "Andres træning" });
    await bookSession(m, a.id);
    await bookSession(m, b.id);
    await cancelBooking(m, b.id);
    await bookSession(other, c.id);

    const url = await calendarFeedUrl(m);
    expect(await calendarFeedUrl(m)).toBe(url); // stable until rotated
    const token = url.split("/").pop()!;
    const feed = (await calendarFeed(token))!;
    expect(feed).toContain("Booket træning");
    expect(feed).not.toContain("Afmeldt træning");
    expect(feed).not.toContain("Andres træning");

    const fresh = (await rotateCalendarToken(m)).split("/").pop()!;
    expect(fresh).not.toBe(token);
    expect(await calendarFeed(token)).toBeNull();
    expect(await calendarFeed(fresh)).toContain("Booket træning");
    expect(await calendarFeed("not-a-token")).toBeNull();

    await deleteAccount(m);
    expect(await calendarFeed(fresh)).toBeNull();
  });
});

describe("test sessions", () => {
  it("creates marked sessions on every programme and deletes only those", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeUser();
    await expect(createTestSessions(admin)).rejects.toMatchObject({ code: "CONFLICT" }); // no programmes yet
    await applyStandardStructure(admin);
    const real = await openSession(48, { title: "Rigtig træning" });

    expect(await createTestSessions(admin)).toBe(21); // 7 programmes × 3 weeks
    expect(await countTestSessions()).toBe(21);
    await expect(createTestSessions(admin)).rejects.toMatchObject({ code: "CONFLICT" });
    const tests = await db.select().from(trainingSession).where(eq(trainingSession.isDemo, true));
    expect(tests.every((t) => t.title.startsWith("TEST – ") && t.status === "PUBLISHED" && t.startsAt > new Date())).toBe(true);

    const social = tests.find((t) => t.title === "TEST – Social Play" && t.capacity === 20)!;
    await bookSession(m, social.id);
    await bookSession(m, real.id);

    await expect(deleteTestSessions(m)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await deleteTestSessions(admin)).toBe(21);
    expect(await countTestSessions()).toBe(0);
    const left = await db.select().from(booking).where(eq(booking.userId, m.id));
    expect(left.map((b) => b.sessionId)).toEqual([real.id]); // real session and its booking untouched
  });
});
