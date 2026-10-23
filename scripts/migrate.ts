/** Applies SQL migrations from ./drizzle and ensures the settings singleton exists. */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Migrations prefer a direct (unpooled) connection when the host provides one.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.execute(sql`INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  console.log("Migrations applied.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
