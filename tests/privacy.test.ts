import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvent, duprSyncLog, notification, session } from "@/db/schema";
import { bookSession } from "@/server/bookings";
import { exportMyData, runRetention } from "@/server/privacy";
import { linkWithRating, makeSession, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

describe("data export", () => {
  it("contains the member's own data and nobody else's", async () => {
    const m = await makeUser("MEMBER", "Eksport Erik");
    const other = await makeUser("MEMBER", "Anden Anna");
    await linkWithRating(m, 3.4);
    await linkWithRating(other, 3.9);
    const s = await makeSession({ title: "Eksporttræning" });
    await bookSession(m, s.id);
    const data = await exportMyData(m);
    expect(data.profile?.name).toBe("Eksport Erik");
    expect(data.dupr?.doublesRating).toBe(3.4);
    expect(data.ratingHistory).toHaveLength(1);
    expect(data.bookings.map((b) => b.session)).toEqual(["Eksporttræning"]);
    const json = JSON.stringify(data);
    expect(json).not.toContain("Anden Anna");
    expect(json).not.toContain("3.9");
    expect(json).not.toMatch(/password|avatar_key|token/i);
  });

  it("is rate limited", async () => {
    const m = await makeUser();
    for (let i = 0; i < 5; i++) await exportMyData(m);
    await expect(exportMyData(m)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("retention", () => {
  it("deletes data past its retention period and keeps recent data", async () => {
    const m = await makeUser();
    const old = (days: number) => new Date(Date.now() - days * 86400_000);
    await db.insert(duprSyncLog).values([
      { userId: m.id, trigger: "SCHEDULED", result: "SUCCESS", createdAt: old(200) },
      { userId: m.id, trigger: "SCHEDULED", result: "SUCCESS", createdAt: old(10) },
    ]);
    await db.insert(notification).values([
      { userId: m.id, type: "X", title: "gammel læst", body: "", readAt: old(190), createdAt: old(190) },
      { userId: m.id, type: "X", title: "gammel ulæst", body: "", createdAt: old(400) },
      { userId: m.id, type: "X", title: "ny ulæst", body: "", createdAt: old(190) },
    ]);
    await db.insert(auditEvent).values([{ action: "old", createdAt: old(800) }, { action: "new" }]);
    await db.insert(session).values({ id: "s-old", token: "t-old", userId: m.id, expiresAt: old(1) });

    const r = await runRetention();
    expect(r).toMatchObject({ syncLogs: 1, notifications: 2, auditEvents: 1, expiredSessions: 1 });
    expect(await db.select().from(duprSyncLog).where(eq(duprSyncLog.userId, m.id))).toHaveLength(1);
    expect((await db.select().from(notification).where(eq(notification.userId, m.id))).map((n) => n.title)).toEqual(["ny ulæst"]);
    expect((await db.select().from(auditEvent)).map((a) => a.action)).toEqual(["new"]);
  });
});

describe("smtp config", () => {
  it("accepts a URL or separate fields, and nothing when incomplete", async () => {
    const { smtpConfig } = await import("@/server/mailer");
    expect(smtpConfig({ SMTP_URL: "smtp://a:b@h:587" })).toBe("smtp://a:b@h:587");
    expect(smtpConfig({ SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: 587, SMTP_USER: "x@smtp-brevo.com", SMTP_PASS: "k" })).toEqual({
      host: "smtp-relay.brevo.com", port: 587, secure: false, auth: { user: "x@smtp-brevo.com", pass: "k" },
    });
    expect(smtpConfig({ SMTP_HOST: "h", SMTP_USER: "u" })).toBeNull();
  });
});
