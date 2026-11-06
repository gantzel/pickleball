import Link from "next/link";
import { Logo } from "@/components/logo";
import { env } from "@/lib/env";

export const metadata = { title: "Kontakt og support" };
export const dynamic = "force-dynamic";

/** Members' way to reach the club's own support team (also a DUPR partner requirement). */
export default function ContactPage() {
  const email = env().SUPPORT_EMAIL ?? env().MAIL_REPLY_TO;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/" className="rounded-md"><Logo /></Link>
      <h1 className="mt-8 text-3xl font-bold">Kontakt og support</h1>
      <div className="mt-6 space-y-4 text-[1.02rem] leading-relaxed">
        <p>Skriv til klubbens support, hvis du har spørgsmål om:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>din konto, dit medlemskab eller kontingent</li>
          <li>bookinger, ventelister og afbud</li>
          <li>forbindelsen til DUPR, din rating eller hvilke hold du har adgang til</li>
          <li>uenighed om en kamp eller et resultat</li>
        </ul>
        {email ? (
          <p className="panel p-5">
            <span className="block text-sm text-muted">E-mail</span>
            <a href={`mailto:${email}`} className="link text-lg font-semibold">{email}</a>
          </p>
        ) : (
          <p className="panel p-5 text-muted">Klubbens support-e-mail er ikke sat op endnu. Kontakt en fra bestyrelsen.</p>
        )}
        <p className="text-sm text-muted">
          Vi svarer normalt inden for et par dage. Spørgsmål om selve DUPR-kontoen (log ind, adgangskode, sletning af konto) håndteres af DUPR&apos;s egen support.
        </p>
      </div>
    </main>
  );
}
