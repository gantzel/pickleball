/** Shared types for the DUPR integration boundary. */
import type { ProviderKey } from "../eligibility";

export interface ProviderRating {
  doubles: number | null;
  singles: number | null;
}

/** The member's own read-only DUPR tokens (from SSO), used for the entitlement check. */
export interface MemberCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface ProviderIdentity {
  /** Stable DUPR ID — the only identifier stored. */
  externalId: string;
  displayName: string | null;
  credentials?: MemberCredentials;
  /** True when DUPR says the member may not take part in play (no BASIC_L1 entitlement). */
  restricted?: boolean;
  /** DUPR+ subscriber (PREMIUM_L1 entitlement). */
  premium?: boolean;
}

export interface AccessCheck {
  restricted: boolean;
  premium: boolean;
  /** Tokens rotate on refresh: always store these. */
  credentials: MemberCredentials;
}

export interface HistoryPoint extends ProviderRating {
  ratedAt: Date;
}

export type ProviderErrorKind = "RATE_LIMITED" | "REVOKED" | "NOT_FOUND" | "UNAVAILABLE" | "INVALID" | "UNKNOWN";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface WebhookEvent {
  /** Ratings carried by the event itself, keyed by DUPR ID (push providers). */
  ratings?: Record<string, ProviderRating>;
  eventId: string;
  /** DUPR IDs whose rating may have changed. Without `ratings` for an ID, its rating is re-fetched. */
  externalIds: string[];
}

export interface RatingProvider {
  key: ProviderKey;
  label: string;
  /** False when credentials/implementation are missing; the UI then shows the integration as unavailable. */
  isReady(): boolean;
  /** URL where the member proves ownership of their DUPR profile. */
  authorizeUrl(params: { state: string; redirectUri: string }): string;
  /** Ratings are pushed by webhook after the initial fetch at link time; never polled. */
  ratingsByWebhookOnly?: boolean;
  /** For providers whose login runs in an embedded frame: the frame URL and the origin its messages come from. */
  ssoEmbed?(): { url: string; origin: string };
  /** Re-checks the member's entitlements with their own tokens. Throws ProviderError("REVOKED") if the tokens are dead. */
  checkAccess?(credentials: MemberCredentials): Promise<AccessCheck>;
  /** Ask the provider to push rating changes for these DUPR IDs to our webhook. */
  subscribe?(externalIds: string[]): Promise<void>;
  /** Exchanges the callback parameters for a verified DUPR identity. */
  completeLink(params: URLSearchParams): Promise<ProviderIdentity>;
  getRating(externalId: string): Promise<ProviderRating>;
  /** Rating history from the provider if it offers it; [] otherwise. Never synthesised. */
  getHistory(externalId: string): Promise<HistoryPoint[]>;
  /** Verifies signature and parses a webhook; throws ProviderError("INVALID") on bad signatures. */
  parseWebhook(rawBody: string, headers: Headers, url: URL): Promise<WebhookEvent>;
  /** Optional: tell the provider we no longer need access. */
  revoke?(externalId: string): Promise<void>;
}
