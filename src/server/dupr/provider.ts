/**
 * DUPR integration boundary. The rest of the app only talks to a
 * `RatingProvider`; swapping the mock for the authorised DUPR partner
 * integration requires no changes outside this folder.
 */
import { devToolsAllowed, env } from "@/lib/env";
import type { ProviderKey } from "../eligibility";
import { mockProvider } from "./mock";
import { duprPartnerProvider } from "./partner";

export * from "./types";
import type { RatingProvider } from "./types";

const registry: Record<ProviderKey, RatingProvider> = {
  MOCK: mockProvider,
  DUPR: duprPartnerProvider,
};

/** The provider new links use, or null if no provider is active/ready. */
export function activeProvider(): RatingProvider | null {
  const configured = env().DUPR_PROVIDER;
  if (configured === "none") return null;
  if (configured === "mock") {
    if (!devToolsAllowed()) {
      console.error("[dupr] DUPR_PROVIDER=mock is not allowed in production without DEMO_MODE=true");
      return null;
    }
    return mockProvider;
  }
  return duprPartnerProvider.isReady() ? duprPartnerProvider : null;
}

/** Whether ratings from `key` count right now. Mock data never counts in production (non-demo). */
export function isProviderActive(key: ProviderKey): boolean {
  return activeProvider()?.key === key;
}

export function providerFor(key: ProviderKey): RatingProvider | null {
  return isProviderActive(key) ? registry[key] : null;
}

/** Status shown in the UI/README so nobody mistakes the mock for live DUPR data. */
export function integrationStatus() {
  const e = env();
  const p = activeProvider();
  return {
    configured: e.DUPR_PROVIDER,
    active: p?.key ?? null,
    label: p?.label ?? null,
    isMock: p?.key === "MOCK",
    liveReady: duprPartnerProvider.isReady(),
  };
}
