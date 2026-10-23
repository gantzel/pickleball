import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { devToolsAllowed, env } from "@/lib/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const url = env().SMTP_URL;
  transporter = url ? nodemailer.createTransport(url) : null;
  return transporter;
}

/** Test hook: mails "sent" while NODE_ENV=test. */
export const testOutbox: Mail[] = [];

const devMailDir = () => path.resolve(process.env.DEV_MAIL_DIR ?? "./storage/dev-mail");

/**
 * Sends via SMTP_URL. Without SMTP:
 *  - test: kept in `testOutbox`
 *  - development/demo: written to the dev mailbox (see /dev/mail) and logged
 *  - production: a warning is logged and nothing is sent
 */
export async function sendMail(msg: Mail) {
  const t = getTransporter();
  if (!t) {
    if (env().NODE_ENV === "test") {
      testOutbox.push(msg);
    } else if (devToolsAllowed()) {
      await mkdir(devMailDir(), { recursive: true });
      const file = `${Date.now()}-${randomUUID().slice(0, 8)}.json`;
      await writeFile(path.join(devMailDir(), file), JSON.stringify({ ...msg, sentAt: new Date().toISOString() }));
      console.info(`[mail:dev] To: ${msg.to} — ${msg.subject} (saved to dev mailbox)`);
    } else {
      console.warn(`[mail] SMTP_URL not configured — email to ${msg.to} not sent: ${msg.subject}`);
    }
    return;
  }
  try {
    await t.sendMail({ from: env().MAIL_FROM, ...msg });
  } catch (err) {
    console.error("[mail] failed to send", { to: msg.to, subject: msg.subject, err });
  }
}

/** Dev/demo only: newest captured mails first. */
export async function readDevMailbox(limit = 50): Promise<(Mail & { sentAt: string })[]> {
  if (!devToolsAllowed()) return [];
  try {
    const files = (await readdir(devMailDir())).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit);
    return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(devMailDir(), f), "utf8"))));
  } catch {
    return [];
  }
}
