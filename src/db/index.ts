import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
/** A transaction handle or the root db — services accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

const globalForDb = globalThis as unknown as { __pbkPool?: Pool };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Serverless hosts run many small instances: keep each pool small and use
  // the provider's pooled connection string (e.g. Neon's "-pooler" host).
  const defaultMax = process.env.VERCEL ? 3 : 10;
  return new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? defaultMax) });
}

export const pool = globalForDb.__pbkPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__pbkPool = pool;

export const db: DB = drizzle(pool, { schema });
export { schema };
