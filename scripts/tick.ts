/** Background work for servers without an HTTP scheduler: run every ~5 min via cron. */
import { pool } from "../src/db";
import { processExpiredOffers } from "../src/server/bookings";
import { runScheduledSync } from "../src/server/dupr/sync";

async function main() {
  const offers = await processExpiredOffers();
  const sync = await runScheduledSync();
  console.log(JSON.stringify({ at: new Date().toISOString(), expiredOfferSessions: offers, sync }));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
