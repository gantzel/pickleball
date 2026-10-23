import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Actor } from "./actor";

/** Resolves the logged-in member from the session cookie (null if none/deleted). Cached per request. */
export const getCurrentUser = cache(async () => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const [u] = await db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, avatarKey: user.avatarKey, emailNotifications: user.emailNotifications })
    .from(user)
    .where(and(eq(user.id, s.user.id), isNull(user.deletedAt)));
  return u ?? null;
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
