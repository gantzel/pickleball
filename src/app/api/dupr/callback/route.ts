import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isDomainError } from "@/lib/errors";
import { getCurrentUser, toActor } from "@/server/current-user";
import { completeLink } from "@/server/dupr/link";
import { isSameOrigin } from "@/server/http";

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

/** Embedded DUPR login (see /dupr/forbind): the page posts DUPR's answer here; the server verifies it with DUPR. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ redirect: "/login" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ redirect: "/profil?dupr_error=VALIDATION#dupr" }, { status: 400 });
  }
  const params = new URLSearchParams();
  for (const k of ["state", "userToken", "refreshToken", "duprId"]) {
    const v = body[k];
    if (typeof v === "string" && v.length < 8192) params.set(k, v);
  }
  try {
    await completeLink(toActor(u), params);
    return NextResponse.json({ redirect: "/profil?dupr=linked#dupr" });
  } catch (e) {
    const code = isDomainError(e) ? e.code : "INTERNAL";
    if (!isDomainError(e)) console.error("[dupr] embedded callback failed", e);
    return NextResponse.json({ redirect: `/profil?dupr_error=${code}#dupr` }, { status: 400 });
  }
}
