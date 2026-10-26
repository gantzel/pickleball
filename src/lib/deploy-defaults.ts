/**
 * Fills a few environment defaults before anything reads them. Imported first
 * by env.ts and auth.ts. Production sets everything explicitly, so this only
 * matters for zero-config deployments:
 *  - APP_URL/BETTER_AUTH_URL default to the Vercel production URL.
 *  - DEMO deployments only: if BETTER_AUTH_SECRET is missing it is derived from
 *    DATABASE_URL (itself a server-side secret), so a demo needs no hand-made
 *    secret. Never applies outside DEMO_MODE=true.
 */
import { createHash } from "node:crypto";

const e = process.env;
if (!e.APP_URL && e.VERCEL_PROJECT_PRODUCTION_URL) e.APP_URL = `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`;
if (!e.BETTER_AUTH_URL && e.APP_URL) e.BETTER_AUTH_URL = e.APP_URL;
if (e.DEMO_MODE === "true" && !e.BETTER_AUTH_SECRET && e.DATABASE_URL) {
  e.BETTER_AUTH_SECRET = createHash("sha256").update(`pbk-demo-auth:${e.DATABASE_URL}`).digest("base64url");
}

/** Demo deployments on serverless hosts can't deliver mail, so demo sign-ups skip email verification. */
export const demoWithoutMail = () => e.DEMO_MODE === "true" && !!e.VERCEL && !e.SMTP_URL && !e.SMTP_HOST;
