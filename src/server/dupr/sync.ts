/**
 * Rating synchronisation. Ratings are only ever written here, from provider
 * responses — there is no code path that accepts a rating from a member or
 * an admin. Every attempt is recorded in dupr_sync_log (no secrets).
 */
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { duprLink, duprSyncLog, ratingSnapshot, type DuprLink } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Actor } from "../actor";
import { requireAdmin } from "../actor";
import { audit } from "../audit";
import { Effects } from "../effects";
import { ratingFromLink } from "../eligibility";
import { notify } from "../notify";
import { rateLimit } from "../rate-limit";
import { applyRatingEffects } from "../rating-effects";
import { getSettings } from "../settings";
import { providerFor } from "./provider";
import { ProviderError, type ProviderRating } from "./types";

type Trigger = "LINK" | "SCHEDULED" | "MANUAL" | "WEBHOOK" | "ADMIN_RETRY";

const SNAPSHOT_SOURCE = {
  LINK: "LINK",
  SCHEDULED: "SCHEDULED_SYNC",
  MANUAL: "MANUAL_SYNC",
  WEBHOOK: "WEBHOOK",
  ADMIN_RETRY: "ADMIN_RETRY",
} as const;

const round3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
const sameRating = (a: number | null, b: number | null) => round3(a) === round3(b);

function validRating(n: number | null): number | null {
  if (n === null || n === undefined) return null;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 8.5) {
    throw new ProviderError("INVALID", "Provider returned an out-of-range rating");
  }
  return round3(n);
}

/** Exponential backoff for failed syncs: 1h, 2h, 4h … capped at 24h. */
export function backoffMs(failures: number) {
  return Math.min(24, 2 ** Math.max(0, failures - 1)) * 3600_000;
}

export interface SyncOutcome {
  result: "SUCCESS" | "NO_CHANGE" | "FAILED" | "RATE_LIMITED" | "REVOKED" | "NO_RATING" | "UNAVAILABLE";
  changed: boolean;
}

export async function syncLink(linkId: string, trigger: Trigger): Promise<SyncOutcome> {
  const started = Date.now();
  const [link] = await db.select().from(duprLink).where(eq(duprLink.id, linkId));
  if (!link) throw new DomainError("NOT_FOUND", "DUPR-forbindelsen findes ikke.");
  const settings = await getSettings();
  const now = new Date();
  const log = (result: SyncOutcome["result"], message: string | null, extra: Partial<typeof duprSyncLog.$inferInsert> = {}) =>
    db.insert(duprSyncLog).values({
      userId: link.userId,
      linkId: link.id,
      trigger,
      result,
      message: message?.slice(0, 500) ?? null,
      durationMs: Date.now() - started,
      previousDoubles: link.doublesRating,
      previousSingles: link.singlesRating,
      ...extra,
    });

  const provider = providerFor(link.provider);
  if (!provider) {
    await db.update(duprLink).set({ lastSyncAttemptAt: now }).where(eq(duprLink.id, link.id));
    await log("UNAVAILABLE", `Provider ${link.provider} is not active`);
    return { result: "UNAVAILABLE", changed: false };
  }
  if (link.status === "REVOKED") {
    await log("REVOKED", "Link is revoked; member must reconnect");
    return { result: "REVOKED", changed: false };
  }

  let fetched: ProviderRating;
  try {
    const raw = await provider.getRating(link.externalId);
    fetched = { doubles: validRating(raw.doubles), singles: validRating(raw.singles) };
  } catch (err) {
    return handleFailure(link, err, trigger, now, log);
  }

  const prevConfigured = ratingFromLink(link, settings);
  const changed = !sameRating(link.doublesRating, fetched.doubles) || !sameRating(link.singlesRating, fetched.singles);
  const hasSnapshot = (await db.select({ id: ratingSnapshot.id }).from(ratingSnapshot).where(eq(ratingSnapshot.userId, link.userId)).limit(1)).length > 0;

  await db.transaction(async (tx) => {
    await tx
      .update(duprLink)
      .set({
        doublesRating: fetched.doubles,
        singlesRating: fetched.singles,
        status: "ACTIVE",
        lastSyncAttemptAt: now,
        lastSuccessfulSyncAt: now,
        lastError: null,
        consecutiveFailures: 0,
        nextSyncAfter: new Date(now.getTime() + settings.syncIntervalHours * 3600_000),
      })
      .where(eq(duprLink.id, link.id));
    if ((changed || !hasSnapshot) && (fetched.doubles !== null || fetched.singles !== null)) {
      await tx.insert(ratingSnapshot).values({
        userId: link.userId,
        provider: link.provider,
        externalId: link.externalId,
        doublesRating: fetched.doubles,
        singlesRating: fetched.singles,
        source: SNAPSHOT_SOURCE[trigger],
        observedAt: now,
      });
    }
  });

  const result: SyncOutcome["result"] =
    fetched.doubles === null && fetched.singles === null ? "NO_RATING" : changed ? "SUCCESS" : "NO_CHANGE";
  await log(result, null, { newDoubles: fetched.doubles, newSingles: fetched.singles });

  const newConfigured = ratingFromLink({ doublesRating: fetched.doubles, singlesRating: fetched.singles }, settings);
  // Always run effects after a successful sync: it is idempotent, and it
  // also re-evaluates flags if a stale rating became fresh again.
  if (newConfigured !== null) await applyRatingEffects(link.userId, prevConfigured, now);
  return { result, changed };
}

async function handleFailure(
  link: DuprLink,
  err: unknown,
  trigger: Trigger,
  now: Date,
  log: (r: SyncOutcome["result"], m: string | null) => Promise<unknown>,
): Promise<SyncOutcome> {
  const pe = err instanceof ProviderError ? err : new ProviderError("UNKNOWN", err instanceof Error ? err.message : "Unknown error");
  const effects = new Effects();

  if (pe.kind === "RATE_LIMITED") {
    const retry = (pe.retryAfterSeconds ?? 900) * 1000;
    await db.update(duprLink).set({ lastSyncAttemptAt: now, nextSyncAfter: new Date(now.getTime() + retry) }).where(eq(duprLink.id, link.id));
    await log("RATE_LIMITED", pe.message);
    return { result: "RATE_LIMITED", changed: false };
  }

  if (pe.kind === "REVOKED") {
    await db.transaction(async (tx) => {
      await tx.update(duprLink).set({ status: "REVOKED", lastSyncAttemptAt: now, lastError: "Adgang tilbagekaldt" }).where(eq(duprLink.id, link.id));
      await notify(tx, effects, link.userId, {
        type: "DUPR_REVOKED",
        title: "DUPR-adgang tilbagekaldt",
        body: "Vi har ikke længere adgang til din DUPR-rating. Kobl din profil til igen for at kunne booke træninger.",
        link: "/profil",
      });
    });
    await effects.flush();
    await log("REVOKED", pe.message);
    return { result: "REVOKED", changed: false };
  }

  const failures = link.consecutiveFailures + 1;
  await db.transaction(async (tx) => {
    await tx
      .update(duprLink)
      .set({
        status: "ERROR",
        lastSyncAttemptAt: now,
        lastError: "Synkronisering mislykkedes",
        consecutiveFailures: failures,
        nextSyncAfter: new Date(now.getTime() + backoffMs(failures)),
      })
      .where(eq(duprLink.id, link.id));
    if (link.status !== "ERROR" && trigger !== "MANUAL") {
      await notify(tx, effects, link.userId, {
        type: "DUPR_SYNC_FAILED",
        title: "Vi kunne ikke opdatere din DUPR-rating",
        body: "Vi prøver automatisk igen. Din seneste verificerede rating gælder, indtil den bliver forældet.",
        link: "/profil",
      });
    }
  });
  await effects.flush();
  await log("FAILED", `${pe.kind}: ${pe.message}`);
  return { result: "FAILED", changed: false };
}

/** Member-initiated "Sync nu" — requests fresh data; never accepts a rating. */
export async function manualSync(actor: Actor) {
  const [link] = await db.select().from(duprLink).where(eq(duprLink.userId, actor.id));
  if (!link) throw new DomainError("NOT_FOUND", "Du har ikke koblet en DUPR-profil til.");
  await rateLimit(`sync:${actor.id}:burst`, 1, 60, "Du kan synkronisere igen om et minut.");
  await rateLimit(`sync:${actor.id}:hour`, 6, 3600, "Du har synkroniseret mange gange den seneste time. Prøv igen senere.");
  return syncLink(link.id, "MANUAL");
}

export async function adminRetrySync(actor: Actor, linkId: string) {
  requireAdmin(actor);
  await audit(db, { actorId: actor.id, action: "dupr.retry_sync", targetType: "dupr_link", targetId: linkId });
  return syncLink(linkId, "ADMIN_RETRY");
}

/** Background job: sync links that are due (respects backoff and rate-limit waits). */
export async function runScheduledSync(limit = 50, now = new Date()) {
  const due = await db
    .select({ id: duprLink.id, provider: duprLink.provider })
    .from(duprLink)
    .where(and(inArray(duprLink.status, ["ACTIVE", "ERROR"]), or(isNull(duprLink.nextSyncAfter), lte(duprLink.nextSyncAfter, now))))
    .orderBy(asc(duprLink.nextSyncAfter))
    .limit(limit);
  const results: Record<string, number> = {};
  for (const l of due) {
    if (!providerFor(l.provider)) continue;
    try {
      const r = await syncLink(l.id, "SCHEDULED");
      results[r.result] = (results[r.result] ?? 0) + 1;
      if (r.result === "RATE_LIMITED") break; // provider-wide limit: stop this run
    } catch (e) {
      console.error("[sync] unexpected error", l.id, e);
    }
  }
  return { checked: due.length, results };
}

export async function recentSyncLogs(userId: string, limit = 10) {
  return db.select().from(duprSyncLog).where(eq(duprSyncLog.userId, userId)).orderBy(desc(duprSyncLog.createdAt)).limit(limit);
}
