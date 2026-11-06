/** Admin: register our rating webhook with DUPR and (re)subscribe every linked member. */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { duprLink } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Actor } from "../actor";
import { requireAdmin } from "../actor";
import { audit } from "../audit";
import { registerDuprWebhook } from "./partner";
import { activeProvider } from "./provider";
import { ProviderError } from "./types";

export async function setUpDuprWebhooks(actor: Actor) {
  requireAdmin(actor);
  const provider = activeProvider();
  if (provider?.key !== "DUPR") throw new DomainError("INTEGRATION_UNAVAILABLE", "Den officielle DUPR-integration er ikke aktiv.");
  try {
    const url = await registerDuprWebhook();
    const links = await db
      .select({ externalId: duprLink.externalId })
      .from(duprLink)
      .where(and(eq(duprLink.provider, "DUPR"), inArray(duprLink.status, ["ACTIVE", "ERROR", "RESTRICTED"])));
    const ids = links.map((l) => l.externalId);
    for (let i = 0; i < ids.length; i += 100) await provider.subscribe?.(ids.slice(i, i + 100));
    await audit(db, { actorId: actor.id, action: "dupr.webhook_register", targetType: "integration", targetId: "DUPR", metadata: { subscribed: ids.length } });
    return { url, subscribed: ids.length };
  } catch (e) {
    if (e instanceof ProviderError) throw new DomainError("INTEGRATION_UNAVAILABLE", `DUPR afviste: ${e.message}`);
    throw e;
  }
}
