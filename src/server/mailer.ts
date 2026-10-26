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

export const SITE_NAME = "Copenhagen Pickleball Collective";

/** The sender always shows the site's name; only the address comes from MAIL_FROM. */
export function fromHeader(mailFrom: string) {
  const address = mailFrom.match(/<([^>]+)>/)?.[1] ?? mailFrom.trim();
  return `"${SITE_NAME}" <${address}>`;
}

/**
 * SMTP is configured either as one URL (SMTP_URL) or as separate fields
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) — the latter avoids having to
 * URL-encode a login that contains "@".
 */
export function smtpConfig(e: Pick<ReturnType<typeof env>, "SMTP_URL" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS">) {
  if (e.SMTP_URL) return e.SMTP_URL;
  if (e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS) {
    const port = e.SMTP_PORT ?? 587;
    return { host: e.SMTP_HOST, port, secure: port === 465, auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } };
  }
  return null;
}

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const cfg = smtpConfig(env());
  transporter = cfg ? nodemailer.createTransport(cfg) : null;
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
      try {
        await mkdir(devMailDir(), { recursive: true });
        const file = `${Date.now()}-${randomUUID().slice(0, 8)}.json`;
        await writeFile(path.join(devMailDir(), file), JSON.stringify({ ...msg, sentAt: new Date().toISOString() }));
        console.info(`[mail:dev] To: ${msg.to} — ${msg.subject} (saved to dev mailbox)`);
      } catch {
        // Read-only filesystem (e.g. serverless): log the mail instead.
        console.info(`[mail:dev] To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}`);
      }
    } else {
      console.warn(`[mail] SMTP_URL not configured — email to ${msg.to} not sent: ${msg.subject}`);
    }
    return;
  }
  try {
    const replyTo = env().MAIL_REPLY_TO;
    await t.sendMail({ from: fromHeader(env().MAIL_FROM), ...(replyTo ? { replyTo } : {}), ...msg });
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
