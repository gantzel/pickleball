/** Applies SQL migrations from ./drizzle and ensures the settings singleton exists. */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";

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
