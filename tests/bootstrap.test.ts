import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { maybeBootstrapAdmin } from "@/server/bootstrap-admin";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const roleOf = async (id: string) => (await db.select({ role: user.role }).from(user).where(eq(user.id, id)))[0].role;
const row = async (id: string) => (await db.select().from(user).where(eq(user.id, id)))[0];

describe("first-admin bootstrap", () => {
  it("promotes the verified initial-admin email when no admin exists", async () => {
    const m = await makeUser();
    await db.update(user).set({ emailVerified: true, email: "Boss@Club.dk" }).where(eq(user.id, m.id));
    expect(await maybeBootstrapAdmin(await row(m.id), "boss@club.dk")).toBe(true);
    expect(await roleOf(m.id)).toBe("ADMIN");
  });

  it("does nothing if unverified, a different email, unset, or an admin already exists", async () => {
    const m = await makeUser();
    await db.update(user).set({ email: "boss@club.dk" }).where(eq(user.id, m.id));
    expect(await maybeBootstrapAdmin(await row(m.id), "boss@club.dk")).toBe(false); // unverified
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, m.id));
    expect(await maybeBootstrapAdmin(await row(m.id), "other@club.dk")).toBe(false);
    expect(await maybeBootstrapAdmin(await row(m.id), undefined)).toBe(false);
    await makeUser("ADMIN");
    expect(await maybeBootstrapAdmin(await row(m.id), "boss@club.dk")).toBe(false);
    expect(await roleOf(m.id)).toBe("MEMBER");
  });
});
