/**
 * Official DUPR partner API provider — NOT YET IMPLEMENTED.
 *
 * Status (researched Oct 2026, see docs/DUPR_INTEGRATION.md):
 *  - DUPR runs a partner API authenticated with a client key + secret that is
 *    exchanged for a bearer token. Environments: UAT (https://uat.mydupr.com/api)
 *    and production (https://api.dupr.com/api).
 *  - It exposes player rating lookup by DUPR ID, rating history, and
 *    webhook subscriptions for the RATING topic.
 *  - Credentials are only issued to approved partners, and the
 *    member-facing "Connect DUPR" login flow (how a member proves they own a
 *    DUPR ID) is documented to partners only.
 *
 * Until Pickleball København has partner credentials and the partner docs,
 * this provider reports `isReady() === false`, so the app shows DUPR as
 * unavailable instead of pretending. Each method lists what to implement.
 * Do NOT implement this by scraping dupr.com or using a member's password.
 */
import { env } from "@/lib/env";
import type { HistoryPoint, ProviderIdentity, ProviderRating, RatingProvider, WebhookEvent } from "./types";
import { ProviderError } from "./types";

const notImplemented = (what: string) =>
  new ProviderError("UNAVAILABLE", `DUPR partner integration not implemented yet: ${what}`);

/** Flip to true only once every method below is implemented and tested against DUPR UAT. */
const IMPLEMENTED = false;

export const duprPartnerProvider: RatingProvider = {
  key: "DUPR",
  label: "DUPR",

  isReady() {
    const e = env();
    return IMPLEMENTED && !!e.DUPR_API_BASE_URL && !!e.DUPR_CLIENT_KEY && !!e.DUPR_CLIENT_SECRET;
  },

  // TODO(dupr): redirect to DUPR's partner SSO/consent URL using `state` and
  // `redirectUri`, as specified in the partner documentation.
  authorizeUrl() {
    throw notImplemented("authorizeUrl (partner SSO)");
  },

  // TODO(dupr): exchange the callback code/token for the member's DUPR ID via
  // the partner API. Never accept a DUPR ID typed in by the member.
  async completeLink(): Promise<ProviderIdentity> {
    throw notImplemented("completeLink");
  },

  // TODO(dupr): token from client key/secret (cache until expiry), then GET
  // the player's ratings by DUPR ID. Map HTTP 429 → RATE_LIMITED (with
  // Retry-After), 401/403 for the player → REVOKED, 404 → NOT_FOUND.
  async getRating(): Promise<ProviderRating> {
    throw notImplemented("getRating");
  },

  // TODO(dupr): page through the rating-history endpoint.
  async getHistory(): Promise<HistoryPoint[]> {
    return [];
  },

  // TODO(dupr): verify DUPR's webhook signature scheme with
  // DUPR_WEBHOOK_SECRET and map the RATING payload to DUPR IDs.
  async parseWebhook(): Promise<WebhookEvent> {
    throw notImplemented("parseWebhook");
  },
};
