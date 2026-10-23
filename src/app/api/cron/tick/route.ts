import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { processExpiredOffers } from "@/server/bookings";
import { runScheduledSync } from "@/server/dupr/sync";
import { safeEqual } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background work, called every ~5 minutes by an external scheduler
 * (cron, Vercel Cron, GitHub Actions…) with `Authorization: Bearer $CRON_SECRET`.
 * Expires waitlist offers and runs due DUPR syncs.
 */
async function handle(req: Request) {
  const secret = env().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const offers = await processExpiredOffers();
  const sync = await runScheduledSync();
  return NextResponse.json({ ok: true, expiredOfferSessions: offers, sync });
}

export const GET = handle;
export const POST = handle;
