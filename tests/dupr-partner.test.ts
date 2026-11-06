/**
 * The official DUPR partner provider, against stubbed DUPR HTTP responses
 * shaped like DUPR's OpenAPI specs (UAT).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { duprLink } from "@/db/schema";
import { resetEnvCache } from "@/lib/env";
import { open, seal } from "@/lib/secretbox";
import { bookSession } from "@/server/bookings";
import { completeLink, startLink, unlink } from "@/server/dupr/link";
import { parseDuprRating, resetPartnerTokenCache } from "@/server/dupr/partner";
import { syncLink } from "@/server/dupr/sync";
import { getSessionForMember } from "@/server/sessions";
import { POST as webhookPOST } from "@/app/api/dupr/webhook/route";
import { getLink, makeSession, makeUser, resetDb } from "./helpers";

const PARTNER = "https://uat.mydupr.com/api";
const PUBLIC = "https://api.uat.dupr.gg";

interface Fake {
  ratings: Record<string, { doubles: string; singles: string } | 403>;
  /** Which member access token belongs to which DUPR ID. */
  tokens: Record<string, string>;
  basic: Record<string, boolean>;
  refreshOk: boolean;
  calls: { method: string; url: string; headers: Record<string, string>; body?: string }[];
}
let fake: Fake;

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubDupr() {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const method = (init.method ?? "GET").toUpperCase();
    fake.calls.push({ method, url, headers, body: typeof init.body === "string" ? init.body : undefined });
    const bearer = headers.authorization?.replace(/^Bearer /, "") ?? "";

    if (url === `${PARTNER}/auth/v1.0/token`) {
      if (headers["x-authorization"] !== Buffer.from("ck-test:cs-test").toString("base64")) return reply(401, {});
      return reply(200, { status: "SUCCESS", result: { token: "partner-jwt", expiry: new Date(Date.now() + 3600_000).toISOString() } });
    }
    if (url.startsWith(`${PARTNER}/user/v1.0/subscribe/webhook-event`)) return bearer === "partner-jwt" ? reply(200, { status: "SUCCESS" }) : reply(401, {});
    if (url === `${PARTNER}/v1.0/webhook`) return reply(200, { status: "SUCCESS" });
    const m = url.match(/^https:\/\/uat\.mydupr\.com\/api\/user\/v1\.0\/([^/]+)$/);
    if (m) {
      if (bearer !== "partner-jwt") return reply(401, {});
      const r = fake.ratings[decodeURIComponent(m[1])];
      if (r === undefined) return reply(404, {});
      if (r === 403) return reply(403, {});
      return reply(200, { status: "SUCCESS", result: { id: m[1], fullName: "Test Spiller", ratings: r } });
    }
    if (url === `${PUBLIC}/public/user/info`) {
      const id = fake.tokens[bearer];
      return id ? reply(200, { status: "SUCCESS", results: [{ duprId: id, fullName: "Test S." }] }) : reply(401, {});
    }
    if (url === `${PUBLIC}/subscription/active`) {
      const id = fake.tokens[bearer];
      if (!id) return reply(401, {});
      return reply(200, { subscriptions: fake.basic[id] ? [{ status: "active", displayName: "DUPR", entitlements: { tournaments: ["BASIC_L1"] } }] : [] });
    }
    if (url === `${PUBLIC}/auth/v2.0/refresh`) {
      const id = fake.tokens[bearer];
      if (!id || !fake.refreshOk) return reply(401, {});
      const next = `${bearer}-r`;
      fake.tokens[next] = id;
      return reply(200, { status: "SUCCESS", result: { accessToken: next, refreshToken: `${headers["x-refresh-token"]}-r` } });
    }
    return reply(500, { error: `unexpected ${method} ${url}` });
  });
}

beforeEach(async () => {
  await resetDb();
  Object.assign(process.env, { DUPR_PROVIDER: "dupr", DUPR_ENV: "uat", DUPR_CLIENT_ID: "5787", DUPR_CLIENT_KEY: "ck-test", DUPR_CLIENT_SECRET: "cs-test" });
  resetEnvCache();
  resetPartnerTokenCache();
  fake = { ratings: {}, tokens: {}, basic: {}, refreshOk: true, calls: [] };
  stubDupr();
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.DUPR_PROVIDER = "mock";
  for (const k of ["DUPR_ENV", "DUPR_CLIENT_ID", "DUPR_CLIENT_KEY", "DUPR_CLIENT_SECRET"]) delete process.env[k];
  resetEnvCache();
});

/** A member logs in with DUPR in the embedded frame; the page posts DUPR's answer to us. */
async function linkViaSso(actor: { id: string; role: "MEMBER" | "ADMIN" }, duprId: string, opts: { doubles?: string; basic?: boolean; claimed?: string } = {}) {
  fake.ratings[duprId] = { doubles: opts.doubles ?? "3.512", singles: "NR" };
  fake.tokens[`ut-${duprId}`] = duprId;
  fake.basic[duprId] = opts.basic ?? true;
  const url = new URL(await startLink(actor));
  expect(url.pathname).toBe("/dupr/forbind");
  return completeLink(
    actor,
    new URLSearchParams({ state: url.searchParams.get("state")!, userToken: `ut-${duprId}`, refreshToken: `rt-${duprId}`, duprId: opts.claimed ?? duprId }),
  );
}

describe("DUPR partner provider", () => {
  it("parses DUPR's string ratings, with NR as no rating", () => {
    expect(parseDuprRating("3.512")).toBe(3.512);
    expect(parseDuprRating("NR")).toBeNull();
    expect(parseDuprRating("")).toBeNull();
    expect(parseDuprRating(4.1)).toBe(4.1);
  });

  it("links via SSO: verifies the token with DUPR, stores tokens encrypted, subscribes to webhooks and syncs", async () => {
    const m = await makeUser();
    const { outcome } = await linkViaSso(m, "AB12CD");
    expect(outcome.result).toBe("SUCCESS");
    const l = await getLink(m.id);
    expect(l).toMatchObject({ provider: "DUPR", externalId: "AB12CD", displayName: "Test S.", status: "ACTIVE", doublesRating: 3.512, singlesRating: null });
    expect(l.accessTokenEnc).not.toContain("ut-AB12CD");
    expect(open(l.accessTokenEnc)).toBe("ut-AB12CD");
    expect(open(l.refreshTokenEnc)).toBe("rt-AB12CD");
    const sub = fake.calls.find((c) => c.url.endsWith("/subscribe/webhook-event"));
    expect(JSON.parse(sub!.body!)).toEqual({ duprIds: ["AB12CD"], topic: "RATING" });
    // Partner token was requested with base64(key:secret) once and reused.
    expect(fake.calls.filter((c) => c.url.endsWith("/auth/v1.0/token"))).toHaveLength(1);
  });

  it("refuses a posted DUPR ID that doesn't match the token's owner", async () => {
    const m = await makeUser();
    await expect(linkViaSso(m, "AB12CD", { claimed: "ZZ99ZZ" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await getLink(m.id)).toBeUndefined();
  });

  it("members without BASIC_L1 are restricted and cannot book rated sessions", async () => {
    const m = await makeUser();
    await linkViaSso(m, "RS1234", { basic: false });
    expect((await getLink(m.id)).status).toBe("RESTRICTED");
    const s = await makeSession({ minRating: 3.0, maxRating: 4.0 });
    const v = await getSessionForMember(m, s.id);
    expect(v.availability.code).not.toBe("AVAILABLE");
    await expect(bookSession(m, s.id)).rejects.toMatchObject({ code: "RATING_UNVERIFIED", message: expect.stringContaining("begrænset") });
    // Open sessions don't depend on DUPR.
    const open_ = await makeSession({ minRating: null });
    await expect(bookSession(m, open_.id)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("re-checks entitlements daily with rotated tokens, and lifts or sets the restriction", async () => {
    const m = await makeUser();
    await linkViaSso(m, "EN1234");
    const l = await getLink(m.id);
    await db.update(duprLink).set({ accessCheckedAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(duprLink.id, l.id));
    fake.basic.EN1234 = false;
    await syncLink(l.id, "SCHEDULED");
    let after = await getLink(m.id);
    expect(after.status).toBe("RESTRICTED");
    expect(open(after.accessTokenEnc)).toBe("ut-EN1234-r");
    expect(open(after.refreshTokenEnc)).toBe("rt-EN1234-r");

    // Within 24 hours no new check is made.
    const before = fake.calls.length;
    await syncLink(l.id, "MANUAL");
    expect(fake.calls.slice(before).some((c) => c.url.includes("/refresh"))).toBe(false);

    await db.update(duprLink).set({ accessCheckedAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(duprLink.id, l.id));
    fake.basic.EN1234 = true;
    await syncLink(l.id, "SCHEDULED");
    after = await getLink(m.id);
    expect(after.status).toBe("ACTIVE");
  });

  it("dead member tokens or a 403 on the rating mean the member must reconnect", async () => {
    const a = await makeUser();
    await linkViaSso(a, "DT1234");
    const la = await getLink(a.id);
    await db.update(duprLink).set({ accessCheckedAt: new Date(0) }).where(eq(duprLink.id, la.id));
    fake.refreshOk = false;
    expect((await syncLink(la.id, "SCHEDULED")).result).toBe("REVOKED");
    expect((await getLink(a.id)).status).toBe("REVOKED");

    const b = await makeUser();
    fake.refreshOk = true;
    await linkViaSso(b, "FB4031");
    fake.ratings.FB4031 = 403;
    const lb = await getLink(b.id);
    expect((await syncLink(lb.id, "MANUAL")).result).toBe("REVOKED");
  });

  it("our own key failing never revokes members", async () => {
    const m = await makeUser();
    await linkViaSso(m, "KY1234");
    process.env.DUPR_CLIENT_SECRET = "wrong";
    resetEnvCache();
    resetPartnerTokenCache();
    const l = await getLink(m.id);
    expect((await syncLink(l.id, "MANUAL")).result).toBe("FAILED");
    expect((await getLink(m.id)).status).toBe("ERROR");
  });

  it("webhooks need our secret in the URL and only trigger a re-fetch", async () => {
    const m = await makeUser();
    await linkViaSso(m, "WH1234", { doubles: "3.100" });
    fake.ratings.WH1234 = { doubles: "3.250", singles: "NR" };
    // The payload's rating is ignored: we fetch it from DUPR.
    const body = JSON.stringify({ clientId: "5787", event: "RATING", message: { duprId: "WH1234", rating: { doubles: "7.9" } } });
    const bad = await webhookPOST(new Request("http://localhost:3000/api/dupr/webhook?key=nope", { method: "POST", body }));
    expect(bad.status).toBe(401);
    const otherClient = JSON.stringify({ clientId: "999", event: "RATING", message: { duprId: "WH1234" } });
    expect((await webhookPOST(new Request("http://localhost:3000/api/dupr/webhook?key=test-webhook-secret", { method: "POST", body: otherClient }))).status).toBe(401);
    const ok = await webhookPOST(new Request("http://localhost:3000/api/dupr/webhook?key=test-webhook-secret", { method: "POST", body }));
    expect(await ok.json()).toMatchObject({ ok: true, synced: 1 });
    expect((await getLink(m.id)).doublesRating).toBe(3.25);
  });

  it("unlinking unsubscribes from DUPR's rating webhook", async () => {
    const m = await makeUser();
    await linkViaSso(m, "UN1234");
    await unlink(m);
    const del = fake.calls.find((c) => c.method === "DELETE" && c.url.endsWith("/subscribe/webhook-event"));
    expect(JSON.parse(del!.body!)).toEqual({ duprIds: ["UN1234"], topic: "RATING" });
  });
});

describe("secretbox", () => {
  it("round-trips and rejects tampering", () => {
    const s = seal("hemmelig");
    expect(open(s)).toBe("hemmelig");
    const parts = s.split(".");
    parts[3] = Buffer.from("andet").toString("base64url");
    expect(open(parts.join("."))).toBeNull();
    expect(open("garbage")).toBeNull();
  });
});
