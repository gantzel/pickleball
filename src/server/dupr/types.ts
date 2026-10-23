/** Shared types for the DUPR integration boundary. */
import type { ProviderKey } from "../eligibility";

export interface ProviderRating {
  doubles: number | null;
  singles: number | null;
}

export interface ProviderIdentity {
  /** Stable DUPR ID — the only identifier stored. */
  externalId: string;
  displayName: string | null;
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
  eventId: string;
  /** DUPR IDs whose rating may have changed. Ratings are always re-fetched, never trusted from the payload. */
  externalIds: string[];
}

export interface RatingProvider {
  key: ProviderKey;
  label: string;
  /** False when credentials/implementation are missing; the UI then shows the integration as unavailable. */
  isReady(): boolean;
  /** URL where the member proves ownership of their DUPR profile. */
  authorizeUrl(params: { state: string; redirectUri: string }): string;
  /** Exchanges the callback parameters for a verified DUPR identity. */
  completeLink(params: URLSearchParams): Promise<ProviderIdentity>;
  getRating(externalId: string): Promise<ProviderRating>;
  /** Rating history from the provider if it offers it; [] otherwise. Never synthesised. */
  getHistory(externalId: string): Promise<HistoryPoint[]>;
  /** Verifies signature and parses a webhook; throws ProviderError("INVALID") on bad signatures. */
  parseWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>;
  /** Optional: tell the provider we no longer need access. */
  revoke?(externalId: string): Promise<void>;
}
