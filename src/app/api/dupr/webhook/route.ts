import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { duprLink, processedWebhook } from "@/db/schema";
import { activeProvider } from "@/server/dupr/provider";
import { syncLink } from "@/server/dupr/sync";
import { ProviderError } from "@/server/dupr/types";

export const dynamic = "force-dynamic";

/**
 * Rating-change webhook. The payload only tells us *which* DUPR IDs to
 * refresh; ratings are always re-fetched from the provider API, so a forged
 * or replayed payload can never set a rating.
 */
export async function POST(req: Request) {
  const provider = activeProvider();
  if (!provider) return NextResponse.json({ error: "integration_unavailable" }, { status: 503 });

  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let event;
  try {
    event = await provider.parseWebhook(raw, req.headers);
  } catch (e) {
    if (e instanceof ProviderError && e.kind === "INVALID") return NextResponse.json({ error: "invalid" }, { status: 401 });
    if (e instanceof ProviderError && e.kind === "UNAVAILABLE") return NextResponse.json({ error: "unavailable" }, { status: 503 });
    throw e;
  }

  const fresh = await db.insert(processedWebhook).values({ id: `${provider.key}:${event.eventId}` }).onConflictDoNothing().returning();
  if (!fresh.length) return NextResponse.json({ ok: true, duplicate: true });

  const links = event.externalIds.length
    ? await db
        .select({ id: duprLink.id })
        .from(duprLink)
        .where(and(eq(duprLink.provider, provider.key), inArray(duprLink.externalId, event.externalIds)))
    : [];
  let synced = 0;
  for (const l of links) {
    try {
      await syncLink(l.id, "WEBHOOK");
      synced++;
    } catch (e) {
      console.error("[webhook] sync failed", l.id, e);
    }
  }
  return NextResponse.json({ ok: true, synced });
}
