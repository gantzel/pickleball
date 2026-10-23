import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Privatliv og data" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/" className="rounded-md"><Logo /></Link>
      <h1 className="mt-8 text-3xl font-bold">Privatliv og data</h1>
      <div className="mt-4 space-y-4 text-[1.02rem] leading-relaxed">
        <p>Pickleball København behandler kun de oplysninger, der skal til for at du kan booke træninger, der passer til dit niveau.</p>
        <h2 className="pt-2 text-xl font-bold">Hvad vi gemmer</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Navn, e-mail og eventuelt profilbillede.</li>
          <li>Dit DUPR-ID og din rating, hentet fra DUPR med din tilladelse, samt tidspunktet for hver opdatering.</li>
          <li>Dine bookinger, ventelistepladser og fremmøde.</li>
          <li>Notifikationer, vi har sendt dig, og en log over synkroniseringer med DUPR.</li>
        </ul>
        <h2 className="pt-2 text-xl font-bold">Hvem kan se det</h2>
        <p>Profilbilleder vises kun for medlemmer, der er logget ind. Deltagerlister og ratings er kun synlige for klubbens administratorer.</p>
        <h2 className="pt-2 text-xl font-bold">Sletning</h2>
        <p>Du kan slette din konto under Profil. Personoplysninger slettes med det samme; tidligere fremmøde bevares anonymt i statistikken. Skrifttyper hostes lokalt, og siden bruger kun de cookies, der er nødvendige for at holde dig logget ind.</p>
      </div>
    </main>
  );
}
