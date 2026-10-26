/**
 * DEVELOPMENT / DEMO ONLY mock of DUPR.
 *
 * Reads fake players from the `mock_dupr_player` table. Every rating it
 * returns is stored with provider = "MOCK" and is ignored for eligibility
 * whenever the mock provider is not the active provider (i.e. production
 * without DEMO_MODE). It must never be presented as real DUPR data.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mockDuprPlayer } from "@/db/schema";
import { devToolsAllowed, env } from "@/lib/env";
import type { HistoryPoint, ProviderIdentity, ProviderRating, RatingProvider, WebhookEvent } from "./types";
import { ProviderError } from "./types";

function assertAllowed() {
  if (!devToolsAllowed()) throw new ProviderError("UNAVAILABLE", "Mock DUPR provider is disabled in production.");
}

export function signMockWebhook(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export const mockProvider: RatingProvider = {
  key: "MOCK",
  label: "Mock-DUPR (kun udvikling/demo)",

  isReady: () => devToolsAllowed(),

  authorizeUrl({ state, redirectUri }) {
    const u = new URL("/dev/mock-dupr", env().APP_URL);
    u.searchParams.set("state", state);
    u.searchParams.set("redirect_uri", redirectUri);
    return u.toString();
  },

  async completeLink(params): Promise<ProviderIdentity> {
    assertAllowed();
    const code = params.get("code");
    if (!code) throw new ProviderError("INVALID", "Missing authorisation code");
    const [p] = await db.select().from(mockDuprPlayer).where(eq(mockDuprPlayer.id, code));
    if (!p) throw new ProviderError("NOT_FOUND", "Unknown mock DUPR player");
    return { externalId: p.id, displayName: p.name };
  },

  async getRating(externalId): Promise<ProviderRating> {
    assertAllowed();
    const [p] = await db.select().from(mockDuprPlayer).where(eq(mockDuprPlayer.id, externalId));
    if (!p) throw new ProviderError("NOT_FOUND", "Mock player not found");
    switch (p.failMode) {
      case "ERROR":
        throw new ProviderError("UNKNOWN", "Mock DUPR returned HTTP 500");
      case "RATE_LIMIT":
        throw new ProviderError("RATE_LIMITED", "Mock DUPR rate limit", 15 * 60);
      case "REVOKED":
        throw new ProviderError("REVOKED", "Mock DUPR access revoked");
      case "NO_RATING":
        return { doubles: null, singles: null };
      default:
        return { doubles: p.doublesRating, singles: p.singlesRating };
    }
  },

  // Test players may carry a history (demo data), served like DUPR's history endpoint.
  async getHistory(externalId): Promise<HistoryPoint[]> {
    assertAllowed();
    const [p] = await db.select({ history: mockDuprPlayer.history }).from(mockDuprPlayer).where(eq(mockDuprPlayer.id, externalId));
    return (p?.history ?? []).map((h) => ({ ratedAt: new Date(h.ratedAt), doubles: h.doubles, singles: h.singles }));
  },

  async parseWebhook(rawBody, headers): Promise<WebhookEvent> {
    assertAllowed();
    const secret = env().DUPR_WEBHOOK_SECRET;
    const sig = headers.get("x-webhook-signature") ?? "";
    if (!secret) throw new ProviderError("INVALID", "DUPR_WEBHOOK_SECRET not configured");
    const expected = Buffer.from(signMockWebhook(rawBody, secret), "hex");
    const given = Buffer.from(sig, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ProviderError("INVALID", "Invalid webhook signature");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new ProviderError("INVALID", "Invalid JSON");
    }
    const b = body as { id?: unknown; topic?: unknown; duprIds?: unknown };
    if (typeof b.id !== "string" || b.topic !== "RATING" || !Array.isArray(b.duprIds)) {
      throw new ProviderError("INVALID", "Unexpected webhook payload");
    }
    return { eventId: b.id, externalIds: b.duprIds.filter((x): x is string => typeof x === "string").slice(0, 500) };
  },
};
