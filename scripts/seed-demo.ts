/**
 * DEMO / DEVELOPMENT seed (see src/server/demo.ts). Refuses to run against
 * production unless DEMO_MODE=true. Safe to run repeatedly.
 *
 *   npm run db:seed
 */
import { pool } from "../src/db";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from "../src/server/demo";

async function main() {
  if (process.env.DUPR_PROVIDER !== "mock") console.warn("Note: DUPR_PROVIDER is not 'mock' — demo ratings won't count until it is.");
  await seedDemo();
  console.log(
    `Demo data ready.\n  Admin:   ${DEMO_ACCOUNTS.admin} / ${DEMO_PASSWORD}\n  Members: anna@ / mads@ (parent) / sofie@demo.pbk.local / ${DEMO_PASSWORD}`,
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
