import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Actor } from "./actor";
import { maybeBootstrapAdmin } from "./bootstrap-admin";

/** Resolves the logged-in member from the session cookie (null if none/deleted). Cached per request. */
export const getCurrentUser = cache(async () => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: user.role, avatarKey: user.avatarKey, emailNotifications: user.emailNotifications, membershipStatus: user.membershipStatus, paidThrough: user.paidThrough, createdAt: user.createdAt })
    .from(user)
    .where(and(eq(user.id, s.user.id), isNull(user.deletedAt)));
  if (!row) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip emailVerified from the result
  const { emailVerified: _verified, ...u } = row;
  if (await maybeBootstrapAdmin(row, process.env.INITIAL_ADMIN_EMAIL)) u.role = "ADMIN";
  return u;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdminUser(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "ADMIN") redirect("/");
  return u;
}

export const toActor = (u: { id: string; role: "MEMBER" | "ADMIN" }): Actor => ({ id: u.id, role: u.role });
