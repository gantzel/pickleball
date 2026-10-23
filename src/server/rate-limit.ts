import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DomainError } from "@/lib/errors";

/**
 * Fixed-window rate limiter backed by Postgres, so limits hold across
 * multiple app instances. Throws RATE_LIMITED when the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, message?: string) {
  const res = await db.execute<{ count: number; window_start: Date }>(sql`
    INSERT INTO rate_limit_bucket (key, count, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_bucket.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN 1 ELSE rate_limit_bucket.count + 1 END,
      window_start = CASE WHEN rate_limit_bucket.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN now() ELSE rate_limit_bucket.window_start END
    RETURNING count, window_start
  `);
  const row = res.rows[0];
  if (row && Number(row.count) > limit) {
    throw new DomainError(
      "RATE_LIMITED",
      message ?? "Du har prøvet for mange gange. Vent lidt og prøv igen.",
      { retryAfterSeconds: windowSeconds },
    );
  }
}
