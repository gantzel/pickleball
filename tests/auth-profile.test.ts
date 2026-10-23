import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { booking, duprLink, ratingSnapshot, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { bookSession, joinWaitlist } from "@/server/bookings";
import { deleteAccount, updateAvatar, updateProfile } from "@/server/members";
import { readAvatar } from "@/server/uploads";
import { linkWithRating, makeSession, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const authReq = (path: string, body: unknown, cookie?: string) =>
  auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

describe("registration and login", () => {
  it("a member can register, log in and get a session; role can't be chosen at sign-up", async () => {
    const res = await authReq("/sign-up/email", { email: "ny@test.local", password: "korrekt-hest-batteri", name: "Ny Spiller", role: "ADMIN" });
    expect([200, 400, 422]).toContain(res.status);
    const [u] = await db.select().from(user).where(eq(user.email, "ny@test.local"));
    if (res.status === 200) {
      expect(u.role).toBe("MEMBER");
    } else {
      expect(u).toBeUndefined(); // extra field rejected outright — also acceptable
      const ok = await authReq("/sign-up/email", { email: "ny@test.local", password: "korrekt-hest-batteri", name: "Ny Spiller" });
      expect(ok.status).toBe(200);
    }
    const [created] = await db.select().from(user).where(eq(user.email, "ny@test.local"));
    expect(created.role).toBe("MEMBER");

    const login = await authReq("/sign-in/email", { email: "ny@test.local", password: "korrekt-hest-batteri" });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("better-auth.session_token");

    const bad = await authReq("/sign-in/email", { email: "ny@test.local", password: "forkert-kode-123" });
    expect(bad.status).toBe(401);
  });

  it("rejects short passwords", async () => {
    const res = await authReq("/sign-up/email", { email: "kort@test.local", password: "123", name: "Kort" });
    expect(res.status).toBe(400);
  });

  it("the auth API cannot be used to change role", async () => {
    await authReq("/sign-up/email", { email: "r@test.local", password: "korrekt-hest-batteri", name: "R" });
    const login = await authReq("/sign-in/email", { email: "r@test.local", password: "korrekt-hest-batteri" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    await authReq("/update-user", { role: "ADMIN", name: "R2" }, cookie);
    const [u] = await db.select().from(user).where(eq(user.email, "r@test.local"));
    expect(u.role).toBe("MEMBER");
  });
});

describe("profile", () => {
  it("edits the display name with validation", async () => {
    const m = await makeUser();
    await updateProfile(m, { name: "  Rikke P  ", emailNotifications: false });
    const [u] = await db.select().from(user).where(eq(user.id, m.id));
    expect(u).toMatchObject({ name: "Rikke P", emailNotifications: false });
    await expect(updateProfile(m, { name: "x", emailNotifications: true })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("uploads a profile photo, re-encoded to WebP", async () => {
    const m = await makeUser();
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3a7" } }).png().toBuffer();
    const key = await updateAvatar(m, { bytes: png, declaredType: "image/png" });
    expect(key).toMatch(/\.webp$/);
    const stored = await readAvatar(key);
    const meta = await sharp(stored!).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 512, height: 512 });
  });

  it("rejects non-images regardless of declared type, and oversize files", async () => {
    const m = await makeUser();
    const html = Buffer.from("<svg onload=alert(1)></svg>");
    await expect(updateAvatar(m, { bytes: html, declaredType: "image/png" })).rejects.toMatchObject({ code: "VALIDATION" });
    const big = Buffer.alloc(6 * 1024 * 1024, 0xff);
    await expect(updateAvatar(m, { bytes: big, declaredType: "image/jpeg" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses path traversal when reading avatars", async () => {
    expect(await readAvatar("../../.env")).toBeNull();
  });
});

describe("account deletion", () => {
  it("anonymises the member, removes DUPR data and releases upcoming places", async () => {
    const [m, w] = [await makeUser(), await makeUser()];
    await linkWithRating(m, 3.5);
    await linkWithRating(w, 3.5);
    const s = await makeSession({ capacity: 1 });
    await bookSession(m, s.id);
    await joinWaitlist(w, s.id);
    await deleteAccount(m);
    const [u] = await db.select().from(user).where(eq(user.id, m.id));
    expect(u.name).toBe("Slettet medlem");
    expect(u.deletedAt).toBeInstanceOf(Date);
    expect(u.email).not.toContain(m.id + "@test.local");
    expect(await db.select().from(duprLink).where(eq(duprLink.userId, m.id))).toHaveLength(0);
    expect(await db.select().from(ratingSnapshot).where(eq(ratingSnapshot.userId, m.id))).toHaveLength(0);
    const rows = await db.select().from(booking).where(eq(booking.sessionId, s.id));
    expect(rows.find((r) => r.userId === w.id)?.status).toBe("OFFERED");
  });
});
