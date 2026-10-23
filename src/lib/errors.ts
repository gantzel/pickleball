/**
 * Domain errors carry a stable code plus a Danish, member-facing message.
 * Anything that isn't a DomainError is treated as an internal error and its
 * details are never shown to users.
 */
export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_ELIGIBLE"
  | "RATING_UNVERIFIED"
  | "SESSION_FULL"
  | "BOOKING_WINDOW"
  | "RATE_LIMITED"
  | "INTEGRATION_UNAVAILABLE";

const STATUS: Record<DomainErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  NOT_ELIGIBLE: 403,
  RATING_UNVERIFIED: 403,
  SESSION_FULL: 409,
  BOOKING_WINDOW: 409,
  RATE_LIMITED: 429,
  INTEGRATION_UNAVAILABLE: 503,
};

export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.status = STATUS[code];
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; code: DomainErrorCode | "INTERNAL"; message: string };

/** Wraps a server action body, converting errors into a safe result object. */
export async function toActionResult<T>(
  fn: () => Promise<T>,
  successMessage?: string,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (e) {
    if (isDomainError(e)) return { ok: false, code: e.code, message: e.message };
    // Re-throw Next.js control-flow errors (redirect/notFound).
    if (e && typeof e === "object" && "digest" in e && typeof e.digest === "string" && e.digest.startsWith("NEXT_")) {
      throw e;
    }
    console.error("[action] unexpected error", e);
    return { ok: false, code: "INTERNAL", message: "Noget gik galt. Prøv igen om lidt." };
  }
}
