/**
 * Linking a member account to a DUPR profile. The member proves ownership on
 * the provider's side (DUPR login/consent); we never accept a typed-in DUPR
 * ID or rating. A single-use, expiring `state` bound to the logged-in member
 * protects the callback against CSRF and session mix-ups.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { duprLink, duprLinkRequest, ratingSnapshot } from "@/db/schema";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import type { Actor } from "../actor";
import { audit } from "../audit";
import { rateLimit } from "../rate-limit";
import { activeProvider, providerFor } from "./provider";
import { syncLink } from "./sync";
import { ProviderError, type RatingProvider } from "./types";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const callbackUrl = () => new URL("/api/dupr/callback", env().APP_URL).toString();

export async function startLink(actor: Actor): Promise<string> {
  const provider = activeProvider();
  if (!provider) {
    throw new DomainError("INTEGRATION_UNAVAILABLE", "DUPR-forbindelsen er ikke aktiveret endnu.");
  }
  await rateLimit(`link:${actor.id}`, 10, 3600);
  const state = randomBytes(32).toString("base64url");
  await db.insert(duprLinkRequest).values({
    userId: actor.id,
    stateHash: hash(state),
    provider: provider.key,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return provider.authorizeUrl({ state, redirectUri: callbackUrl() });
}

export async function completeLink(actor: Actor, params: URLSearchParams) {
  const state = params.get("state");
  if (!state) throw new DomainError("VALIDATION", "Ugyldigt svar fra DUPR.");
  const now = new Date();

  // Consume the state atomically: valid, unused, unexpired, same member.
  const [req] = await db
    .update(duprLinkRequest)
    .set({ usedAt: now })
    .where(
      and(
        eq(duprLinkRequest.stateHash, hash(state)),
        eq(duprLinkRequest.userId, actor.id),
        isNull(duprLinkRequest.usedAt),
        gt(duprLinkRequest.expiresAt, now),
      ),
    )
    .returning();
  if (!req) throw new DomainError("VALIDATION", "Linket er udløbet eller ugyldigt. Prøv at koble til igen.");
  if (params.get("error")) throw new DomainError("VALIDATION", "Tilkoblingen blev afbrudt.");

  const provider = providerFor(req.provider);
  if (!provider) throw new DomainError("INTEGRATION_UNAVAILABLE", "DUPR-forbindelsen er ikke aktiv.");

  let identity;
  try {
    identity = await provider.completeLink(params);
  } catch (e) {
    if (e instanceof ProviderError) throw new DomainError("VALIDATION", "DUPR kunne ikke bekræfte din profil. Prøv igen.");
    throw e;
  }

  const [taken] = await db
    .select({ userId: duprLink.userId })
    .from(duprLink)
    .where(and(eq(duprLink.provider, provider.key), eq(duprLink.externalId, identity.externalId)));
  if (taken && taken.userId !== actor.id) {
    throw new DomainError("CONFLICT", "Denne DUPR-profil er allerede koblet til en anden konto. Kontakt klubben, hvis det er en fejl.");
  }

  const [link] = await db
    .insert(duprLink)
    .values({
      userId: actor.id,
      provider: provider.key,
      externalId: identity.externalId,
      displayName: identity.displayName,
      status: "ACTIVE",
      linkedAt: now,
    })
    .onConflictDoUpdate({
      target: duprLink.userId,
      set: {
        provider: provider.key,
        externalId: identity.externalId,
        displayName: identity.displayName,
        status: "ACTIVE",
        linkedAt: now,
        doublesRating: null,
        singlesRating: null,
        lastSuccessfulSyncAt: null,
        lastError: null,
        consecutiveFailures: 0,
        nextSyncAfter: null,
      },
    })
    .returning();

  await audit(db, {
    actorId: actor.id,
    action: "dupr.link",
    targetType: "dupr_link",
    targetId: link.id,
    metadata: { provider: provider.key, externalId: identity.externalId },
  });

  await importProviderHistory(actor.id, provider, identity.externalId);

  const outcome = await syncLink(link.id, "LINK");
  return { link, outcome };
}

/** Imports the provider's rating history once, at link time (never synthesised by the app). */
export async function importProviderHistory(userId: string, provider: RatingProvider, externalId: string) {
  try {
    const history = await provider.getHistory(externalId);
    if (history.length) {
      await db.insert(ratingSnapshot).values(
        history.slice(-500).map((h) => ({
          userId,
          provider: provider.key,
          externalId,
          doublesRating: h.doubles,
          singlesRating: h.singles,
          source: "PROVIDER_HISTORY" as const,
          observedAt: h.ratedAt,
        })),
      );
    }
  } catch (e) {
    console.warn("[dupr] history import failed", e instanceof Error ? e.message : e);
  }
}

export async function unlink(actor: Actor) {
  const [link] = await db.select().from(duprLink).where(eq(duprLink.userId, actor.id));
  if (!link) return;
  const provider = providerFor(link.provider);
  try {
    await provider?.revoke?.(link.externalId);
  } catch (e) {
    console.warn("[dupr] revoke failed", e instanceof Error ? e.message : e);
  }
  await db.delete(duprLink).where(eq(duprLink.id, link.id));
  await audit(db, { actorId: actor.id, action: "dupr.unlink", targetType: "dupr_link", targetId: link.id, metadata: { provider: link.provider } });
}
