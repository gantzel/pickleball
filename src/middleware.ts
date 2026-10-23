import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for logged-out visitors. This is a UX convenience
 * only — every page and server action re-validates the session server-side.
 */
const PUBLIC = ["/login", "/opret", "/glemt-adgangskode", "/nulstil-adgangskode", "/privatliv"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!getSessionCookie(req)) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\.(?:png|svg|ico|webp|woff2?)$).*)"],
};
