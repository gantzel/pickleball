/**
 * Grants or revokes the admin role. Run on the server with database access:
 *   npm run admin:grant -- someone@example.com
 *   npm run admin:grant -- someone@example.com --revoke
 * This is the only way to create the first admin; roles can't be chosen at sign-up.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "../src/db";
import { user } from "../src/db/schema";
import { audit } from "../src/server/audit";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email) throw new Error("Usage: npm run admin:grant -- <email> [--revoke]");
  const [u] = await db.update(user).set({ role: revoke ? "MEMBER" : "ADMIN" }).where(and(eq(user.email, email), isNull(user.deletedAt))).returning();
  if (!u) throw new Error(`No active user with email ${email}. They must register first.`);
  await audit(db, { actorId: null, action: revoke ? "role.revoke_admin" : "role.grant_admin", targetType: "user", targetId: u.id, metadata: { via: "cli" } });
  console.log(`${email} is now ${revoke ? "a member" : "an admin"}.`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end();
  process.exit(1);
});
