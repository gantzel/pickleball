import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { booking, child, notification, user } from "@/db/schema";
import { addToRoster, listRoster } from "@/server/admin";
import { acceptOffer, bookSession, cancelBooking, joinWaitlist } from "@/server/bookings";
import { calendarFeed, calendarFeedUrl } from "@/server/calendar";
import { addChild, removeChild } from "@/server/children";
import { deleteAccount } from "@/server/members";
import { exportMyData } from "@/server/privacy";
import { sendDueReminders } from "@/server/reminders";
import { getSessionAdmin, getSessionForMember } from "@/server/sessions";
import { makeLevel, makeSession, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Copenhagen", year: "numeric" }).format(new Date()));
const open = (o: Parameters<typeof makeSession>[0] = {}) => makeSession({ minRating: null, ...o });
const emailOf = async (id: string) => (await db.select({ e: user.email }).from(user).where(eq(user.id, id)))[0].e;

describe("children on a parent's profile", () => {
  it("accepts children from the year they turn 11 and under 18", async () => {
    const p = await makeUser();
    await expect(addChild(p, { name: "Lille Bo", birthYear: year - 10 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(addChild(p, { name: "Voksen", birthYear: year - 18 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(addChild(p, { name: "E", birthYear: year - 12 })).rejects.toMatchObject({ code: "VALIDATION" });
    const c = await addChild(p, { name: "Emma", birthYear: year - 11 });
    expect(c).toMatchObject({ name: "Emma", parentId: p.id });
  });

  it("a parent books for a child (and for themselves) on an open session; nobody else can use the child", async () => {
    const p = await makeUser();
    const stranger = await makeUser();
    const emma = await addChild(p, { name: "Emma", birthYear: year - 13 });
    const s = await open({ capacity: 2 });
    await bookSession(p, s.id, emma.id);
    await bookSession(p, s.id); // the parent's own place is separate
    await expect(bookSession(p, s.id, emma.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(bookSession(stranger, s.id, emma.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const v = await getSessionForMember(p, s.id);
    expect(v.availability.code).toBe("BOOKED");
    expect(v.children).toEqual([{ id: emma.id, name: "Emma", availability: { code: "BOOKED", flagged: false } }]);
    const notes = await db.select().from(notification).where(eq(notification.userId, p.id));
    expect(notes.map((n) => n.title)).toContain("Booking bekræftet: Emma");

    const admin = await makeUser("ADMIN");
    const { participants } = await getSessionAdmin(admin, s.id);
    const kid = participants.find((x) => x.child);
    expect(kid?.child?.name).toBe("Emma");
    expect(kid?.user.id).toBe(p.id); // parent shown as contact
  });

  it("children can book junior sessions only when on the roster, and never rating programmes", async () => {
    const admin = await makeUser("ADMIN");
    const p = await makeUser();
    const emma = await addChild(p, { name: "Emma", birthYear: year - 12 });
    const jr = await makeLevel({ kind: "JUNIOR", minRating: null, maxRating: null });
    const level = await makeLevel({ minRating: null, maxRating: 3.0, allowUnrated: true });
    const junior = await open({ levelId: jr.id });
    const rated = await open({ levelId: level.id });

    await expect(bookSession(p, junior.id, emma.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE", message: expect.stringContaining("Emma") });
    await addToRoster(admin, jr.id, await emailOf(p.id), emma.id);
    const roster = await listRoster(admin, jr.id);
    expect(roster).toEqual([expect.objectContaining({ name: "Emma", isChild: true, childId: emma.id })]);
    expect((await getSessionForMember(p, junior.id)).availability.code).toBe("NOT_ON_ROSTER"); // the parent isn't on it
    await expect(bookSession(p, junior.id, emma.id)).resolves.toMatchObject({ status: "CONFIRMED" });

    await expect(bookSession(p, rated.id, emma.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // Another member's child can't be added through someone else's email.
    const other = await makeUser();
    await expect(addToRoster(admin, jr.id, await emailOf(other.id), emma.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("waitlist offers reach the parent on the child's behalf", async () => {
    const p = await makeUser();
    const m = await makeUser();
    const emma = await addChild(p, { name: "Emma", birthYear: year - 14 });
    const s = await open({ capacity: 1 });
    await bookSession(m, s.id);
    await joinWaitlist(p, s.id, emma.id);
    await cancelBooking(m, s.id);
    const [b] = await db.select().from(booking).where(and(eq(booking.sessionId, s.id), eq(booking.childId, emma.id)));
    expect(b.status).toBe("OFFERED");
    const notes = await db.select().from(notification).where(eq(notification.userId, p.id));
    expect(notes.map((n) => n.title)).toContain("Der er en plads til Emma!");
    await expect(acceptOffer(p, s.id)).rejects.toMatchObject({ code: "CONFLICT" }); // the parent has no offer
    await expect(acceptOffer(p, s.id, emma.id)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("removing a child frees its upcoming places for the waitlist", async () => {
    const p = await makeUser();
    const m = await makeUser();
    const emma = await addChild(p, { name: "Emma", birthYear: year - 13 });
    const s = await open({ capacity: 1 });
    await bookSession(p, s.id, emma.id);
    await joinWaitlist(m, s.id);
    await removeChild(p, emma.id);
    expect(await db.select().from(child).where(eq(child.id, emma.id))).toHaveLength(0);
    const [mb] = await db.select().from(booking).where(and(eq(booking.sessionId, s.id), eq(booking.userId, m.id)));
    expect(mb.status).toBe("OFFERED");
  });

  it("children appear in the parent's calendar, reminders and data export, and go with the account", async () => {
    const p = await makeUser();
    const emma = await addChild(p, { name: "Emma", birthYear: year - 15 });
    const start = new Date(Date.now() + 20 * 3600_000);
    const s = await open({ title: "Juniortræning", startsAt: start, endsAt: new Date(start.getTime() + 3600_000) });
    await bookSession(p, s.id, emma.id);

    const feed = (await calendarFeed((await calendarFeedUrl(p)).split("/").pop()!))!;
    expect(feed).toContain("SUMMARY:Emma: Juniortræning");
    expect(await sendDueReminders()).toBe(1);
    const notes = await db.select().from(notification).where(eq(notification.userId, p.id));
    expect(notes.some((n) => n.type === "SESSION_REMINDER" && n.title.includes("for Emma"))).toBe(true);
    const data = await exportMyData(p);
    expect(data.children).toEqual([expect.objectContaining({ name: "Emma", birthYear: year - 15 })]);
    expect(data.bookings[0]).toMatchObject({ participant: "Emma" });

    await deleteAccount(p);
    expect(await db.select().from(child).where(eq(child.parentId, p.id))).toHaveLength(0);
  });
});
