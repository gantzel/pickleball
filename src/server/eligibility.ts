/**
 * Pure eligibility rules. No I/O — every input is passed in, so the same
 * function decides what the UI shows and what the server enforces.
 *
 * Policy (documented in README → "Eligibility policy"):
 *  - Only a rating obtained from the active, authorised provider counts.
 *  - A rating counts as VERIFIED only if the last *successful* sync is within
 *    `staleAfterDays`. A failed sync inside that window keeps the rating
 *    verified (with a warning); after the window it becomes STALE.
 *  - STALE / missing / revoked / unavailable ratings never unlock booking.
 *  - Session rating limits are inclusive at both ends.
 *  - Training levels are [minRating, maxRating) so they never overlap.
 */
import type { AppSettings, Booking, DuprLink, TrainingLevel, TrainingSession } from "@/db/schema";

export type ProviderKey = "MOCK" | "DUPR";

export type RatingState =
  | {
      kind: "VERIFIED";
      rating: number;
      syncedAt: Date;
      provider: ProviderKey;
      /** e.g. the latest sync attempt failed but the rating is still within policy */
      warning?: string;
    }
  | { kind: "NOT_LINKED" }
  | { kind: "INTEGRATION_UNAVAILABLE"; rating: number | null; syncedAt: Date | null }
  | { kind: "REVOKED" }
  | { kind: "NO_RATING"; syncedAt: Date | null }
  | { kind: "STALE"; rating: number | null; syncedAt: Date | null };

export type SettingsLike = Pick<AppSettings, "ratingType" | "staleAfterDays">;
type LinkLike = Pick<
  DuprLink,
  "provider" | "status" | "doublesRating" | "singlesRating" | "lastSuccessfulSyncAt" | "lastError"
>;

export function ratingFromLink(link: Pick<LinkLike, "doublesRating" | "singlesRating">, settings: Pick<SettingsLike, "ratingType">) {
  const v = settings.ratingType === "SINGLES" ? link.singlesRating : link.doublesRating;
  return v === null || v === undefined ? null : Number(v);
}

export function computeRatingState(
  link: LinkLike | null | undefined,
  settings: SettingsLike,
  now: Date,
  isProviderActive: (p: ProviderKey) => boolean,
): RatingState {
  if (!link) return { kind: "NOT_LINKED" };
  const rating = ratingFromLink(link, settings);
  const syncedAt = link.lastSuccessfulSyncAt ?? null;

  if (!isProviderActive(link.provider)) return { kind: "INTEGRATION_UNAVAILABLE", rating, syncedAt };
  if (link.status === "REVOKED") return { kind: "REVOKED" };

  const staleMs = settings.staleAfterDays * 24 * 3600 * 1000;
  const fresh = syncedAt !== null && now.getTime() - syncedAt.getTime() <= staleMs;
  if (!fresh) return { kind: "STALE", rating, syncedAt };
  if (rating === null) return { kind: "NO_RATING", syncedAt };

  return {
    kind: "VERIFIED",
    rating,
    syncedAt: syncedAt!,
    provider: link.provider,
    warning:
      link.status === "ERROR"
        ? "Seneste synkronisering med DUPR fejlede. Din rating er stadig gyldig, indtil den bliver forældet."
        : undefined,
  };
}

export function inSessionRange(rating: number, min: number | null, max: number | null) {
  // Compare at DUPR precision to avoid float artefacts (3 decimals).
  const r = Math.round(rating * 1000);
  if (min !== null && r < Math.round(min * 1000)) return false;
  if (max !== null && r > Math.round(max * 1000)) return false;
  return true;
}

export function ratingStateMessage(s: RatingState): string {
  switch (s.kind) {
    case "VERIFIED":
      return "Verificeret rating fra DUPR.";
    case "NOT_LINKED":
      return "Kobl din DUPR-profil til for at kunne booke træninger.";
    case "INTEGRATION_UNAVAILABLE":
      return "DUPR-forbindelsen er ikke aktiv lige nu, så ratings kan ikke verificeres.";
    case "REVOKED":
      return "Adgangen til din DUPR-profil er tilbagekaldt. Kobl den til igen.";
    case "NO_RATING":
      return "DUPR har endnu ingen rating for dig. Spil registrerede kampe for at få en rating.";
    case "STALE":
      return "Din rating er ikke blevet opdateret for nylig og skal synkroniseres igen.";
  }
}

// ─── Session availability ────────────────────────────────────────────────────

export type Availability =
  | { code: "BOOKED"; flagged: boolean }
  | { code: "OFFERED"; expiresAt: Date }
  | { code: "WAITLISTED"; position: number }
  | { code: "AVAILABLE"; remaining: number }
  | { code: "FULL_WAITLIST" }
  | { code: "LOCKED_LOW"; min: number; rating: number }
  | { code: "LOCKED_HIGH"; min: number | null; max: number; rating: number }
  | { code: "VERIFY_NEEDED"; reason: RatingState["kind"] }
  | { code: "NOT_OPEN"; opensAt: Date }
  | { code: "CLOSED" }
  | { code: "CANCELLED" }
  | { code: "PAST" };

type SessionLike = Pick<
  TrainingSession,
  "status" | "startsAt" | "minRating" | "maxRating" | "capacity" | "bookingOpensAt" | "bookingClosesAt"
>;
type BookingLike = Pick<Booking, "status" | "offerExpiresAt" | "flag"> | null | undefined;

export interface AvailabilityInput {
  session: SessionLike;
  /** CONFIRMED + unexpired OFFERED bookings (places held). */
  heldCount: number;
  booking: BookingLike;
  /** 1-based position among WAITLISTED bookings, if waitlisted. */
  waitlistPosition?: number;
  ratingState: RatingState;
  now: Date;
}

export const bookingClosesAt = (s: Pick<TrainingSession, "bookingClosesAt" | "startsAt">) =>
  s.bookingClosesAt ?? s.startsAt;

export function isActiveOffer(b: BookingLike, now: Date) {
  return !!b && b.status === "OFFERED" && !!b.offerExpiresAt && b.offerExpiresAt > now;
}

/** Rating eligibility only (ignores capacity/window). */
export function ratingEligibility(
  session: Pick<TrainingSession, "minRating" | "maxRating">,
  state: RatingState,
): Availability | { code: "ELIGIBLE" } {
  if (state.kind !== "VERIFIED") return { code: "VERIFY_NEEDED", reason: state.kind };
  const min = session.minRating ?? null;
  const max = session.maxRating ?? null;
  if (min !== null && !inSessionRange(state.rating, min, null)) {
    return { code: "LOCKED_LOW", min, rating: state.rating };
  }
  if (max !== null && !inSessionRange(state.rating, null, max)) {
    return { code: "LOCKED_HIGH", min, max, rating: state.rating };
  }
  return { code: "ELIGIBLE" };
}

export function computeAvailability(i: AvailabilityInput): Availability {
  const { session, booking, now } = i;
  if (session.status === "CANCELLED") return { code: "CANCELLED" };

  if (booking?.status === "CONFIRMED") return { code: "BOOKED", flagged: booking.flag !== "NONE" };
  if (isActiveOffer(booking, now)) return { code: "OFFERED", expiresAt: booking!.offerExpiresAt! };
  if (booking?.status === "WAITLISTED") return { code: "WAITLISTED", position: i.waitlistPosition ?? 0 };

  if (session.status !== "PUBLISHED" || session.startsAt <= now) return { code: "PAST" };

  const rating = ratingEligibility(session, i.ratingState);
  if (rating.code !== "ELIGIBLE") return rating;

  if (session.bookingOpensAt && now < session.bookingOpensAt) {
    return { code: "NOT_OPEN", opensAt: session.bookingOpensAt };
  }
  if (now >= bookingClosesAt(session)) return { code: "CLOSED" };

  const remaining = session.capacity - i.heldCount;
  if (remaining <= 0) return { code: "FULL_WAITLIST" };
  return { code: "AVAILABLE", remaining };
}

// ─── Levels ──────────────────────────────────────────────────────────────────

type LevelLike = Pick<TrainingLevel, "id" | "name" | "minRating" | "maxRating" | "sortOrder" | "color">;

export function sortLevels<T extends LevelLike>(levels: T[]): T[] {
  return [...levels].sort((a, b) => Number(a.minRating) - Number(b.minRating) || a.sortOrder - b.sortOrder);
}

export function currentLevel<T extends LevelLike>(rating: number, levels: T[]): T | null {
  let match: T | null = null;
  for (const l of sortLevels(levels)) {
    const min = Number(l.minRating);
    const max = l.maxRating === null ? Infinity : Number(l.maxRating);
    if (rating >= min && rating < max) match = l;
  }
  return match;
}

export function nextLevel<T extends LevelLike>(rating: number, levels: T[]): T | null {
  return sortLevels(levels).find((l) => Number(l.minRating) > rating) ?? null;
}

/** 0..1 progress from the current level's floor to the next level's threshold. */
export function levelProgress(rating: number, levels: LevelLike[]) {
  const cur = currentLevel(rating, levels);
  const next = nextLevel(rating, levels);
  if (!next) return { current: cur, next: null, gap: 0, progress: 1 };
  const floor = cur ? Number(cur.minRating) : Math.max(0, Number(next.minRating) - 0.5);
  const target = Number(next.minRating);
  const progress = Math.min(1, Math.max(0, (rating - floor) / (target - floor)));
  return { current: cur, next, gap: Math.max(0, Math.round((target - rating) * 1000) / 1000), progress };
}
