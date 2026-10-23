import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { devToolsAllowed } from "@/lib/env";
import { readDevMailbox } from "@/server/mailer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Udviklings-indbakke" };

const linkify = (text: string) =>
  text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="link break-all">{part}</a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );

/**
 * DEVELOPMENT/DEMO ONLY: mails the app would have sent when no SMTP server
 * is configured. Public on purpose (sign-up verification happens before login);
 * returns 404 in production unless DEMO_MODE=true.
 */
export default async function DevMail() {
  if (!devToolsAllowed()) notFound();
  const mails = await readDevMailbox();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 rounded-[12px] border-2 border-dashed border-wait bg-wait-soft p-4 text-sm font-semibold text-wait">
        Udviklings-indbakke: her vises de mails, appen ville have sendt. Siden findes ikke i produktion.
      </div>
      <Logo />
      <h1 className="mt-6 text-2xl font-bold">Sendte mails</h1>
      <ul className="mt-4 space-y-3">
        {mails.map((m, i) => (
          <li key={i} className="panel p-4">
            <p className="text-sm text-muted">Til {m.to}, {new Date(m.sentAt).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" })}</p>
            <p className="font-semibold">{m.subject}</p>
            <p className="mt-2 whitespace-pre-line text-sm">{linkify(m.text)}</p>
          </li>
        ))}
        {mails.length === 0 && <li className="text-muted">Ingen mails endnu.</li>}
      </ul>
    </main>
  );
}
