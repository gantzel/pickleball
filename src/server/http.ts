import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** CSRF defence for cookie-authenticated route handlers: require a same-origin request. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const expected = new URL(env().APP_URL).origin;
  if (origin) return origin === expected;
  const fetchSite = req.headers.get("sec-fetch-site");
  return fetchSite === "same-origin";
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
