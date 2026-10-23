import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isDomainError } from "@/lib/errors";
import { getCurrentUser, toActor } from "@/server/current-user";
import { startLink } from "@/server/dupr/link";
import { isSameOrigin } from "@/server/http";

/** Starts the DUPR linking flow (form POST from the profile page). */
export async function POST(req: Request) {
  const base = env().APP_URL;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = await getCurrentUser();
  if (!u) return NextResponse.redirect(new URL("/login", base), 303);
  try {
    const url = await startLink(toActor(u));
    return NextResponse.redirect(url, 303);
  } catch (e) {
    const code = isDomainError(e) ? e.code : "INTERNAL";
    if (!isDomainError(e)) console.error("[dupr] start link failed", e);
    return NextResponse.redirect(new URL(`/profil?dupr_error=${code}`, base), 303);
  }
}
