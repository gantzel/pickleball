import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { booking, notification, user } from "@/db/schema";
import { membershipCounts, onNewAccount, searchMembers, setMembership } from "@/server/admin";
import { bookSession, cancelBooking, joinWaitlist } from "@/server/bookings";
import { addChild } from "@/server/children";
import { endOfHalfYear, membershipState } from "@/server/membership";
import { getSessionForMember } from "@/server/sessions";
import { makeSession, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const open = (o: Parameters<typeof makeSession>[0] = {}) => makeSession({ minRating: null, ...o });
const year = new Date().getUTCFullYear();

describe("membership approval", () => {
  it("pending members can see sessions but not book or join waitlists", async () => {
    const m = await makeUser("MEMBER", "Ny", "PENDING");
    const s = await open();
    expect((await getSessionForMember(m, s.id)).availability).toEqual({ code: "MEMBERSHIP", state: "PENDING" });
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE", message: expect.stringContaining("afventer godkendelse") });
    const full = await open({ capacity: 1 });
    await bookSession(await makeUser(), full.id);
    await expect(joinWaitlist(m, full.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("an admin approves; the member is told and can book", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeUser("MEMBER", "Ny", "PENDING");
    const s = await open();
    await expect(setMembership(m, m.id, { status: "ACTIVE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await setMembership(admin, m.id, { status: "ACTIVE", paidThrough: endOfHalfYear() });
    expect(r.active).toBe(true);
    const notes = await db.select().from(notification).where(eq(notification.userId, m.id));
    expect(notes.map((n) => n.type)).toContain("MEMBERSHIP_ACTIVE");
    await expect(bookSession(m, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("a passed 'paid through' date stops booking until extended; admins can always book", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeUser();
    await setMembership(admin, m.id, { status: "ACTIVE", paidThrough: `${year - 1}-12-31` });
    const s = await open();
    expect((await getSessionForMember(m, s.id)).availability).toEqual({ code: "MEMBERSHIP", state: "LAPSED" });
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE", message: expect.stringContaining("kontingent") });
    await setMembership(admin, m.id, { status: "ACTIVE", paidThrough: `${year + 1}-06-30` });
    await expect(bookSession(m, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });

    await db.update(user).set({ membershipStatus: "PENDING" }).where(eq(user.id, admin.id));
    await expect(bookSession(admin, s.id)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("children follow their parent's membership", async () => {
    const admin = await makeUser("ADMIN");
    const parent = await makeUser();
    const kid = await addChild(parent, { name: "Emma", birthYear: new Date().getFullYear() - 12 });
    await setMembership(admin, parent.id, { status: "ENDED" });
    const s = await open();
    await expect(bookSession(parent, s.id, kid.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("waitlist offers skip members who are no longer active (keeping their place)", async () => {
    const admin = await makeUser("ADMIN");
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const s = await open({ capacity: 1 });
    await bookSession(a, s.id);
    await joinWaitlist(b, s.id);
    await joinWaitlist(c, s.id);
    await setMembership(admin, b.id, { status: "ENDED" });
    await cancelBooking(a, s.id);
    const rows = await db.select().from(booking).where(eq(booking.sessionId, s.id));
    expect(rows.find((r) => r.userId === b.id)?.status).toBe("WAITLISTED");
    expect(rows.find((r) => r.userId === c.id)?.status).toBe("OFFERED");
  });

  it("new accounts notify admins and show up as pending", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeUser("MEMBER", "Nina Ny", "PENDING");
    await onNewAccount(m.id);
    const notes = await db.select().from(notification).where(and(eq(notification.userId, admin.id), eq(notification.type, "ADMIN_MEMBER_PENDING")));
    expect(notes[0].body).toContain("Nina Ny");
    expect((await searchMembers(admin, "", 50, "afventer")).map((r) => r.name)).toEqual(["Nina Ny"]);
    expect((await membershipCounts(admin)).pending).toBe(1);
  });

  it("state rules", () => {
    const today = new Date("2026-10-26T10:00:00Z");
    expect(membershipState({ role: "MEMBER", membershipStatus: "ACTIVE", paidThrough: "2026-10-26" }, today)).toBe("ACTIVE");
    expect(membershipState({ role: "MEMBER", membershipStatus: "ACTIVE", paidThrough: "2026-10-25" }, today)).toBe("LAPSED");
    expect(membershipState({ role: "MEMBER", membershipStatus: "ACTIVE", paidThrough: null }, today)).toBe("ACTIVE");
    expect(membershipState({ role: "ADMIN", membershipStatus: "ENDED", paidThrough: null }, today)).toBe("ACTIVE");
    expect(endOfHalfYear(new Date("2026-03-01T12:00:00Z"))).toBe("2026-06-30");
    expect(endOfHalfYear(new Date("2026-10-26T12:00:00Z"))).toBe("2026-12-31");
  });
});
