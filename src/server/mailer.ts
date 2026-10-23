import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const url = env().SMTP_URL;
  transporter = url ? nodemailer.createTransport(url) : null;
  return transporter;
}

/** Sends an email via SMTP_URL; without SMTP configured it logs (dev) or warns (prod). */
export async function sendMail(msg: { to: string; subject: string; text: string }) {
  const t = getTransporter();
  if (!t) {
    if (env().NODE_ENV === "production") {
      console.warn(`[mail] SMTP_URL not configured — email to ${msg.to} not sent: ${msg.subject}`);
    } else if (env().NODE_ENV !== "test") {
      console.info(`[mail:dev] To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
    }
    return;
  }
  try {
    await t.sendMail({ from: env().MAIL_FROM, ...msg });
  } catch (err) {
    console.error("[mail] failed to send", { to: msg.to, subject: msg.subject, err });
  }
}
