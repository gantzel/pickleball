/**
 * Official DUPR partner integration ("RaaS"), per DUPR's partner docs
 * (dupr.gitbook.io/dupr-raas) and their OpenAPI specs:
 *
 *  - Partner token: POST {partner}/auth/v1.0/token with header
 *    x-authorization: base64(clientKey:clientSecret). Valid ~1 hour; cached.
 *  - Member login: DUPR's SSO page in an iframe
 *    ({sso}/login-external-app/{base64(clientKey)}). It posts the member's
 *    read-only userToken, refreshToken and duprId to the parent window.
 *    We never trust the posted duprId: the server asks DUPR who the token
 *    belongs to (GET {public}/public/user/info) and only links that ID.
 *  - User gating: the member's entitlements (POST {public}/subscription/active)
 *    must include BASIC_L1, re-checked at most every 24 hours.
 *  - Ratings: GET {partner}/user/v1.0/{duprId} with the partner token. Only
 *    members who completed SSO are readable (others → 403).
 *  - Rating changes: we register a webhook (POST {partner}/v1.0/webhook) and
 *    subscribe each linked member (POST {partner}/user/v1.0/subscribe/webhook-event).
 *    DUPR does not sign webhooks, so the payload is only a hint: the URL
 *    carries our own secret, and the rating is always re-fetched.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { AccessCheck, HistoryPoint, MemberCredentials, ProviderIdentity, ProviderRating, RatingProvider, WebhookEvent } from "./types";
import { ProviderError } from "./types";

const HOSTS = {
  uat: { partner: "https://uat.mydupr.com/api", public: "https://api.uat.dupr.gg", sso: "https://uat.dupr.gg" },
  production: { partner: "https://prod.mydupr.com/api", public: "https://api.dupr.gg", sso: "https://dashboard.dupr.com" },
} as const;

export const duprHosts = () => HOSTS[env().DUPR_ENV];
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const TIMEOUT_MS = 10_000;

// ─── HTTP ────────────────────────────────────────────────────────────────────

let tokenCache: { token: string; expiresAt: number } | null = null;
/** Test hook. */
export const resetPartnerTokenCache = () => {
  tokenCache = null;
};

function errorFor(res: Response, what: string): ProviderError {
  const retry = Number(res.headers.get("retry-after"));
  switch (res.status) {
    case 429:
      return new ProviderError("RATE_LIMITED", `${what}: rate limited`, Number.isFinite(retry) && retry > 0 ? retry : undefined);
    case 401:
      return new ProviderError("UNAVAILABLE", `${what}: unauthorised`);
    case 403:
      return new ProviderError("REVOKED", `${what}: access denied (${res.status})`);
    case 404:
      return new ProviderError("NOT_FOUND", `${what}: not found`);
    case 400:
    case 422:
      return new ProviderError("INVALID", `${what}: rejected (${res.status})`);
    default:
      return new ProviderError(res.status >= 500 ? "UNAVAILABLE" : "UNKNOWN", `${what}: HTTP ${res.status}`);
  }
}

async function call(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    throw new ProviderError("UNAVAILABLE", `${what}: ${e instanceof Error ? e.message : "network error"}`);
  }
}

async function json(res: Response, what: string): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ProviderError("UNKNOWN", `${what}: response was not JSON`);
  }
}

async function partnerToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const e = env();
  const res = await call(
    `${duprHosts().partner}/auth/v1.0/token`,
    { method: "POST", headers: { "x-authorization": b64(`${e.DUPR_CLIENT_KEY}:${e.DUPR_CLIENT_SECRET}`), accept: "application/json" } },
    "partner token",
  );
  if (!res.ok) {
    // Our own credentials failing is never the member's fault: don't map it to REVOKED.
    throw new ProviderError(res.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE", `partner token: HTTP ${res.status}`);
  }
  const body = await json(res, "partner token");
  const result = body.result as { token?: unknown; expiry?: unknown } | undefined;
  if (typeof result?.token !== "string") throw new ProviderError("UNKNOWN", "partner token: no token in response");
  const exp = typeof result.expiry === "string" ? Date.parse(result.expiry) : NaN;
  tokenCache = { token: result.token, expiresAt: Number.isFinite(exp) ? exp : Date.now() + 50 * 60_000 };
  return result.token;
}

/** Partner API call; retries once with a fresh token if ours was rejected. */
async function partner(path: string, init: RequestInit, what: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await partnerToken();
    const res = await call(
      `${duprHosts().partner}${path}`,
      { ...init, headers: { ...init.headers, authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" } },
      what,
    );
    if (res.status === 401 && attempt === 0) {
      tokenCache = null;
      continue;
    }
    return res;
  }
  throw new ProviderError("UNAVAILABLE", `${what}: unauthorised`);
}

/** Member-token call to DUPR's public (read-only) API. */
const memberError = (res: Response, what: string) =>
  res.status === 401 ? new ProviderError("REVOKED", `${what}: member token rejected`) : errorFor(res, what);

async function member(path: string, accessToken: string, init: RequestInit, what: string) {
  return call(`${duprHosts().public}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}`, accept: "application/json" } }, what);
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/** DUPR sends ratings as strings ("3.512", or "NR" for not rated). */
export function parseDuprRating(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.trim().replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
}

async function basicInfo(accessToken: string) {
  const res = await member("/public/user/info", accessToken, { method: "GET" }, "user info");
  if (!res.ok) throw memberError(res, "user info");
  const body = await json(res, "user info");
  const first = Array.isArray(body.results) ? (body.results[0] as { duprId?: unknown; fullName?: unknown } | undefined) : undefined;
  if (typeof first?.duprId !== "string" || !first.duprId) throw new ProviderError("INVALID", "user info: no DUPR ID");
  return { duprId: first.duprId, name: typeof first.fullName === "string" && first.fullName.trim() ? first.fullName.trim() : null };
}

/** True unless DUPR says the member lacks BASIC_L1 (restricted or banned). */
async function isRestricted(accessToken: string): Promise<boolean> {
  const res = await member("/subscription/active", accessToken, { method: "POST" }, "entitlements");
  if (!res.ok) throw memberError(res, "entitlements");
  const body = await json(res, "entitlements");
  const subs = Array.isArray(body.subscriptions) ? body.subscriptions : Array.isArray((body.result as { subscriptions?: unknown })?.subscriptions) ? ((body.result as { subscriptions: unknown[] }).subscriptions) : [];
  const basic = subs.some((s) => {
    const ent = (s as { entitlements?: Record<string, unknown> }).entitlements ?? {};
    return Object.values(ent).some((list) => Array.isArray(list) && list.includes("BASIC_L1"));
  });
  return !basic;
}

async function refresh(c: MemberCredentials): Promise<MemberCredentials> {
  const res = await member("/auth/v2.0/refresh", c.accessToken, { method: "GET", headers: { "x-refresh-token": c.refreshToken } }, "token refresh");
  if (!res.ok) throw memberError(res, "token refresh");
  const body = await json(res, "token refresh");
  const r = body.result as { accessToken?: unknown; refreshToken?: unknown } | undefined;
  if (typeof r?.accessToken !== "string" || typeof r.refreshToken !== "string") throw new ProviderError("UNKNOWN", "token refresh: no tokens");
  return { accessToken: r.accessToken, refreshToken: r.refreshToken };
}

const safeEqual = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

// ─── Provider ────────────────────────────────────────────────────────────────

export const duprPartnerProvider: RatingProvider = {
  key: "DUPR",
  label: "DUPR",

  isReady() {
    const e = env();
    return !!e.DUPR_CLIENT_KEY && !!e.DUPR_CLIENT_SECRET;
  },

  /** Our own page that embeds DUPR's login (see ssoEmbed). */
  authorizeUrl({ state }) {
    const u = new URL("/dupr/forbind", env().APP_URL);
    u.searchParams.set("state", state);
    return u.toString();
  },

  ssoEmbed() {
    const sso = duprHosts().sso;
    return { url: `${sso}/login-external-app/${b64(env().DUPR_CLIENT_KEY ?? "")}`, origin: new URL(sso).origin };
  },

  async completeLink(params): Promise<ProviderIdentity> {
    const accessToken = params.get("userToken");
    const refreshToken = params.get("refreshToken");
    const claimed = params.get("duprId");
    if (!accessToken || !refreshToken) throw new ProviderError("INVALID", "Missing DUPR tokens");
    // Ask DUPR whose token this is; a posted DUPR ID alone proves nothing.
    const info = await basicInfo(accessToken);
    if (claimed && claimed.toUpperCase() !== info.duprId.toUpperCase()) throw new ProviderError("INVALID", "DUPR ID does not match the token");
    const restricted = await isRestricted(accessToken);
    return { externalId: info.duprId, displayName: info.name, credentials: { accessToken, refreshToken }, restricted };
  },

  async checkAccess(credentials): Promise<AccessCheck> {
    // Refreshing rotates both tokens and keeps the refresh token from expiring.
    const fresh = await refresh(credentials);
    return { restricted: await isRestricted(fresh.accessToken), credentials: fresh };
  },

  async getRating(externalId): Promise<ProviderRating> {
    const res = await partner(`/user/v1.0/${encodeURIComponent(externalId)}`, { method: "GET" }, "user detail");
    if (!res.ok) throw errorFor(res, "user detail");
    const body = await json(res, "user detail");
    const ratings = (body.result as { ratings?: { doubles?: unknown; singles?: unknown } } | undefined)?.ratings;
    if (!ratings) return { doubles: null, singles: null };
    return { doubles: parseDuprRating(ratings.doubles), singles: parseDuprRating(ratings.singles) };
  },

  // History comes from our own verified snapshots; DUPR's history endpoint isn't needed.
  async getHistory(): Promise<HistoryPoint[]> {
    return [];
  },

  async subscribe(externalIds) {
    if (!externalIds.length) return;
    const res = await partner("/user/v1.0/subscribe/webhook-event", { method: "POST", body: JSON.stringify({ duprIds: externalIds, topic: "RATING" }) }, "subscribe");
    if (!res.ok) throw errorFor(res, "subscribe");
  },

  async revoke(externalId) {
    const res = await partner("/user/v1.0/subscribe/webhook-event", { method: "DELETE", body: JSON.stringify({ duprIds: [externalId], topic: "RATING" }) }, "unsubscribe");
    if (!res.ok && res.status !== 404) throw errorFor(res, "unsubscribe");
  },

  async parseWebhook(rawBody, _headers, url): Promise<WebhookEvent> {
    const e = env();
    const secret = e.DUPR_WEBHOOK_SECRET;
    const given = url.searchParams.get("key") ?? "";
    if (!secret || !safeEqual(given, secret)) throw new ProviderError("INVALID", "Wrong webhook key");
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new ProviderError("INVALID", "Invalid JSON");
    }
    const envelopes = (Array.isArray(body) ? body : [body]) as { clientId?: unknown; event?: unknown; message?: unknown }[];
    const ids = new Set<string>();
    for (const env_ of envelopes) {
      if (e.DUPR_CLIENT_ID && env_.clientId !== undefined && String(env_.clientId) !== e.DUPR_CLIENT_ID) {
        throw new ProviderError("INVALID", "Webhook for another client");
      }
      const messages = Array.isArray(env_.message) ? env_.message : [env_.message];
      for (const m of messages) {
        const id = (m as { duprId?: unknown } | null)?.duprId;
        if (typeof id === "string" && id) ids.add(id);
      }
    }
    // DUPR events carry no id: dedupe on the exact payload.
    return { eventId: createHash("sha256").update(rawBody).digest("hex"), externalIds: [...ids].slice(0, 500) };
  },
};

/** Admin action: tell DUPR where to send rating webhooks. */
export async function registerDuprWebhook(): Promise<string> {
  const e = env();
  if (!e.DUPR_WEBHOOK_SECRET) throw new ProviderError("INVALID", "DUPR_WEBHOOK_SECRET is not set");
  const hook = new URL("/api/dupr/webhook", e.APP_URL);
  hook.searchParams.set("key", e.DUPR_WEBHOOK_SECRET);
  const res = await partner("/v1.0/webhook", { method: "POST", body: JSON.stringify({ webhookUrl: hook.toString(), topics: ["RATING"] }) }, "register webhook");
  if (!res.ok) throw errorFor(res, "register webhook");
  hook.searchParams.set("key", "•••");
  return hook.toString();
}
