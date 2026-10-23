import { and, eq, isNull } from "drizzle-orm";
import { type Tx } from "@/db";
import { notification, user } from "@/db/schema";
import { env } from "@/lib/env";
import type { Effects } from "./effects";
import { sendMail } from "./mailer";

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: string;
}

/** Creates an in-app notification and queues an email (after commit) if the member wants emails. */
export async function notify(tx: Tx, effects: Effects, userId: string, n: NotificationInput) {
  await tx.insert(notification).values({ userId, ...n });
  const [u] = await tx
    .select({ email: user.email, wants: user.emailNotifications })
    .from(user)
    .where(and(eq(user.id, userId), isNull(user.deletedAt)));
  if (u?.wants) {
    const link = n.link ? `\n\n${env().APP_URL}${n.link}` : "";
    effects.add(() => sendMail({ to: u.email, subject: n.title, text: `${n.body}${link}` }));
  }
}

export async function notifyAdmins(tx: Tx, effects: Effects, n: NotificationInput) {
  const admins = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "ADMIN"), isNull(user.deletedAt)));
  for (const a of admins) await notify(tx, effects, a.id, n);
}
