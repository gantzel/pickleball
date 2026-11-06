import "./deploy-defaults";
import { z } from "zod";

/**
 * Server-side configuration. Parsed lazily so `next build` doesn't need
 * runtime secrets. Never import this module from client components.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  /** none | mock | dupr — which rating provider is active. */
  DUPR_PROVIDER: z.enum(["none", "mock", "dupr"]).default("none"),
  /** Allows the mock provider in a production build for a clearly-labelled demo deployment. */
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Which DUPR environment the partner keys belong to: uat (testing) or production. */
  DUPR_ENV: z.enum(["uat", "production"]).default("uat"),
  DUPR_CLIENT_ID: z.string().optional(),
  DUPR_CLIENT_KEY: z.string().optional(),
  DUPR_CLIENT_SECRET: z.string().optional(),
  /** Random secret we put in the webhook URL we register with DUPR (DUPR does not sign webhooks). */
  DUPR_WEBHOOK_SECRET: z.string().optional(),
  /** Shown to members as the club's support contact (DUPR requires one). */
  SUPPORT_EMAIL: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),

  CRON_SECRET: z.string().min(12).optional(),
  /** db = in PostgreSQL; local = UPLOAD_DIR on disk (needs a persistent disk); s3 = any S3-compatible bucket. */
  STORAGE_DRIVER: z.enum(["db", "local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("./storage/avatars"),
  S3_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Copenhagen Pickleball Collective <no-reply@example.com>"),
  /** Where members' replies to app emails go (MAIL_FROM can be a no-reply address). */
  MAIL_REPLY_TO: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  /** First-admin bootstrap: this verified email becomes admin while the club has no admin. */
  INITIAL_ADMIN_EMAIL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: forget the cached env after mutating process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export const isProduction = () => env().NODE_ENV === "production";

/**
 * The mock DUPR provider and every dev-only control are allowed outside
 * production, or in production only when DEMO_MODE=true (which also shows a
 * permanent "demo data" banner).
 */
export function devToolsAllowed(): boolean {
  const e = env();
  return e.NODE_ENV !== "production" || e.DEMO_MODE;
}

export function isDemo(): boolean {
  const e = env();
  return e.DUPR_PROVIDER === "mock" && devToolsAllowed();
}
