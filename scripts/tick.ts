/** Background work for servers without an HTTP scheduler: run every ~5 min via cron. */
import { pool } from "../src/db";
import { processExpiredOffers } from "../src/server/bookings";
import { runRetention } from "../src/server/privacy";
import { sendDueReminders } from "../src/server/reminders";
import { runScheduledSync } from "../src/server/dupr/sync";

async function main() {
  const offers = await processExpiredOffers();
  const reminders = await sendDueReminders();
  const sync = await runScheduledSync();
  const retention = await runRetention();
  console.log(JSON.stringify({ at: new Date().toISOString(), expiredOfferSessions: offers, reminders, sync, retention }));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
