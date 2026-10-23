import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isDomainError } from "@/lib/errors";
import { getCurrentUser, toActor } from "@/server/current-user";
import { completeLink } from "@/server/dupr/link";

export const dynamic = "force-dynamic";

/** Provider redirects here after the member approved access on DUPR's side. */
export async function GET(req: Request) {
  const base = env().APP_URL;
  const u = await getCurrentUser();
  if (!u) return NextResponse.redirect(new URL("/login", base), 303);
  const params = new URL(req.url).searchParams;
  try {
    await completeLink(toActor(u), params);
    return NextResponse.redirect(new URL("/profil?dupr=linked", base), 303);
  } catch (e) {
    const code = isDomainError(e) ? e.code : "INTERNAL";
    if (!isDomainError(e)) console.error("[dupr] callback failed", e);
    return NextResponse.redirect(new URL(`/profil?dupr_error=${code}`, base), 303);
  }
}
