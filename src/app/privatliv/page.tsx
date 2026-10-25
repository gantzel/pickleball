import Link from "next/link";
import { Logo } from "@/components/logo";
import { RETENTION } from "@/lib/retention";

export const metadata = { title: "Privatlivspolitik" };

/**
 * Privacy policy. Text in [square brackets] must be filled in by the club
 * before launch (legal entity, contact, processors). Retention periods are
 * read from the same constants the deletion job uses.
 */
function Fill({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-wait-soft px-1 text-wait">[{children}]</mark>;
}

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="pt-4 text-xl font-bold">{children}</h2>;

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/" className="rounded-md"><Logo /></Link>
      <h1 className="mt-8 text-3xl font-bold">Privatlivspolitik</h1>
      <p className="mt-2 text-sm text-muted">Senest opdateret 25. oktober 2026</p>

      <div className="mt-6 space-y-3 text-[1.02rem] leading-relaxed">
        <p>
          Her kan du læse, hvilke personoplysninger Pickleball Copenhagen (PBCPH) behandler, når du bruger træningsplatformen, hvorfor vi gør det, og hvilke rettigheder du har.
        </p>

        <H2>Dataansvarlig</H2>
        <p>
          Foreningen Pickleball Copenhagen (PBCPH), hjemsted Københavns Kommune, <Fill>CVR-nr., hvis foreningen har et</Fill>. Kontakt om persondata: <Fill>e-mail</Fill>. Bestyrelsen er ansvarlig for behandlingen, og kassereren fører medlemsregistret (vedtægternes § 7).
        </p>

        <H2>Hvilke oplysninger vi behandler</H2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Konto:</strong> navn, e-mail, krypteret adgangskode, om din e-mail er bekræftet, og om du er medlem eller administrator.</li>
          <li><strong>Profilbillede</strong>, hvis du uploader et. Billedet beskæres, og metadata som GPS-position fjernes.</li>
          <li><strong>DUPR:</strong> dit DUPR-ID, navn på din DUPR-profil, din double- og single-rating og tidspunktet for hver opdatering. Vi henter dem fra DUPR, efter du har givet tilladelse.</li>
          <li><strong>Træning:</strong> bookinger, ventelistepladser, afmeldinger, fremmøde og milepæle.</li>
          <li><strong>Børn:</strong> Hvis du tilføjer dine børn, gemmer vi barnets navn og fødselsår samt barnets bookinger og pladser på holdenes deltagerlister. Barnet har ikke selv et login. Det er dig som forælder, der opretter, booker og kan slette.</li>
          <li><strong>Notifikationer</strong>, vi har sendt dig i appen eller på e-mail.</li>
          <li><strong>Tekniske oplysninger:</strong> login-sessioner (IP-adresse og browser), en log over hentninger fra DUPR og en log over administratorers handlinger.</li>
        </ul>

        <H2>Formål og retsgrundlag</H2>
        <ul className="list-disc space-y-1 pl-5">
          <li>At give dig adgang til at booke træninger på de hold, du har adgang til, administrere ventelister og registrere fremmøde. Retsgrundlag: dit medlemskab og brugen af platformen (GDPR art. 6, stk. 1, litra b).</li>
          <li>At sende dig beskeder om bookinger, ledige pladser og ændringer i din rating. E-mails kan slås fra under Profil; beskeder i appen er en del af tjenesten.</li>
          <li>Sikkerhed, fejlsøgning og dokumentation af ændringer (logs). Retsgrundlag: klubbens legitime interesse i en sikker og korrekt drift (art. 6, stk. 1, litra f).</li>
        </ul>
        <p>Vi bruger ikke dine oplysninger til markedsføring og sælger dem ikke.</p>

        <H2>Hvem kan se dine oplysninger</H2>
        <p>
          Du kan se dine egne oplysninger. Klubbens administratorer kan se medlemmers navne, e-mails, ratings, bookinger og fremmøde — og navn og fødselsår på børn, der er tilmeldt — for at kunne planlægge træninger. Andre medlemmer kan ikke se din rating eller hvem der er tilmeldt. Profilbilleder vises kun for medlemmer, der er logget ind.
        </p>

        <H2>Databehandlere og modtagere</H2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Hosting af platformen: Vercel Inc., USA. Platformen kører på servere i EU (Frankfurt).</li>
          <li>Database og profilbilleder: Neon (Databricks Inc.), USA. Databasen ligger i EU (Frankfurt).</li>
          <li>Udsendelse af e-mails: Brevo SAS, Frankrig (EU).</li>
          <li>Sikkerhedskopier af databasen og den automatiske baggrundsopgave: GitHub Inc. (Microsoft), USA.</li>
          <li>DUPR (Dynamic Universal Pickleball Rating), som vi henter din rating fra med din tilladelse. DUPR behandler dine data efter sin egen privatlivspolitik.</li>
        </ul>
        <p>Vi har databehandleraftaler med vores leverandører. Overføres data til lande uden for EU/EØS, sker det på grundlag af EU-Kommissionens standardkontraktbestemmelser eller en tilsvarende garanti.</p>

        <H2>Hvor længe vi gemmer oplysningerne</H2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Konto, DUPR-forbindelse, ratinghistorik og bookinger: så længe du har en konto.</li>
          <li>Læste notifikationer: {RETENTION.readNotificationDays} dage. Alle notifikationer: højst {RETENTION.anyNotificationDays} dage.</li>
          <li>Log over hentninger fra DUPR: {RETENTION.syncLogDays} dage.</li>
          <li>Log over administratorers handlinger: {Math.round(RETENTION.auditDays / 365)} år.</li>
          <li>Udløbne login-sessioner og engangslinks slettes automatisk.</li>
          <li>Sikkerhedskopier af databasen: 35 dage. Sletter du din konto, forsvinder dine oplysninger derfor helt fra sikkerhedskopierne senest 35 dage efter.</li>
        </ul>
        <p>Oplysninger slettes automatisk, når perioden er udløbet.</p>

        <H2>Når du sletter din konto</H2>
        <p>
          Du kan slette din konto under Profil. Navn, e-mail, profilbillede, adgangskode, DUPR-forbindelse, ratinghistorik, notifikationer og milepæle slettes med det samme, og kommende bookinger afmeldes. Tidligere fremmøde bevares uden navn i klubbens statistik og kan ikke føres tilbage til dig.
        </p>

        <H2>Børn og alder</H2>
        <p>
          Man kan være medlem af klubben fra 11 år. Børn under 18 har ikke deres eget login: en forælder tilføjer barnet på sin profil og booker for det. Barnets navn vises for trænere og administratorer på deltagerlister med mærket &quot;Barn&quot; og forælderen som kontakt. Vi gemmer kun fødselsåret, ikke den fulde fødselsdato. Fjerner du barnet, eller sletter du din konto, slettes barnets oplysninger og bookinger.
        </p>

        <H2>Dine rettigheder</H2>
        <p>Du har ret til at:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>få indsigt i dine oplysninger. Du kan selv hente en kopi under Profil, Download mine data.</li>
          <li>få forkerte oplysninger rettet. Navn og billede retter du selv; din rating kommer fra DUPR og rettes dér.</li>
          <li>få dine oplysninger slettet og trække din tilladelse til DUPR tilbage (Profil, Kobl DUPR fra).</li>
          <li>få dine oplysninger udleveret i et maskinlæsbart format (dataportabilitet).</li>
          <li>gøre indsigelse mod behandling, der sker på grundlag af legitim interesse, og få behandlingen begrænset.</li>
        </ul>
        <p>Skriv til <Fill>e-mail</Fill> for at bruge dine rettigheder. Du kan også klage til Datatilsynet, datatilsynet.dk.</p>

        <H2>Cookies</H2>
        <p>Vi bruger kun de cookies, der er nødvendige for at holde dig logget ind. Vi bruger ikke statistik- eller marketingcookies, og skrifttyper hentes ikke fra tredjeparter.</p>
      </div>
    </main>
  );
}
