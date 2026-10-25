/**
 * First-admin bootstrap. If INITIAL_ADMIN_EMAIL is set and the club has no
 * admin yet, the member with that (verified) email becomes admin. Once any
 * admin exists this does nothing, so it can't be used to take over later.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { audit } from "./audit";

export async function maybeBootstrapAdmin(u: { id: string; email: string; emailVerified: boolean; role: "MEMBER" | "ADMIN" }, initialAdminEmail: string | undefined) {
  if (!initialAdminEmail || u.role === "ADMIN" || !u.emailVerified) return false;
  if (u.email.trim().toLowerCase() !== initialAdminEmail.trim().toLowerCase()) return false;
  return db.transaction(async (tx) => {
    // Lock existing admins so two requests can't both bootstrap.
    const admins = await tx.select({ id: user.id }).from(user).where(and(eq(user.role, "ADMIN"), isNull(user.deletedAt))).for("update");
    if (admins.length > 0) return false;
    await tx.update(user).set({ role: "ADMIN" }).where(eq(user.id, u.id));
    await audit(tx, { actorId: null, action: "role.grant_admin", targetType: "user", targetId: u.id, metadata: { via: "INITIAL_ADMIN_EMAIL" } });
    return true;
  });
}
