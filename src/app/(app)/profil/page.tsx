import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { SyncButton } from "@/components/sync-button";
import { Chip } from "@/components/status-chip";
import { formatDateTime, formatRating, formatRelative } from "@/lib/format";
import { requireUser, toActor } from "@/server/current-user";
import { integrationStatus } from "@/server/dupr/provider";
import { recentSyncLogs } from "@/server/dupr/sync";
import { ratingStateMessage } from "@/server/eligibility";
import { memberProgress } from "@/server/progress";
import { listChildren, MAX_CHILD_AGE, MIN_CHILD_AGE } from "@/server/children";
import { AvatarForm, CalendarPanel, ChildForm, DeleteAccountForm, ProfileForm, UnlinkButton } from "./forms";

export const metadata = { title: "Profil" };

const ERRORS: Record<string, string> = {
  INTEGRATION_UNAVAILABLE: "DUPR-forbindelsen er ikke aktiveret endnu.",
  CONFLICT: "Denne DUPR-profil er allerede koblet til en anden konto. Kontakt klubben, hvis det er en fejl.",
  VALIDATION: "Tilkoblingen kunne ikke gennemføres. Prøv igen.",
  RATE_LIMITED: "For mange forsøg. Vent lidt og prøv igen.",
  INTERNAL: "Noget gik galt under tilkoblingen. Prøv igen.",
};

const RESULT_LABEL: Record<string, string> = {
  SUCCESS: "Opdateret",
  NO_CHANGE: "Uændret",
  FAILED: "Fejlede",
  RATE_LIMITED: "Udsat (DUPR travl)",
  REVOKED: "Adgang tilbagekaldt",
  NO_RATING: "Ingen rating",
  UNAVAILABLE: "Ikke aktiv",
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ dupr?: string; dupr_error?: string; velkommen?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const actor = toActor(user);
  const [p, logs, kids] = await Promise.all([memberProgress(actor), recentSyncLogs(user.id, 5), listChildren(actor)]);
  const year = new Date().getFullYear();
  const integ = integrationStatus();
  const link = p.link;
  const state = p.ratingState;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Profil" intro={user.email} />
      {sp.velkommen && (
        <p role="status" className="rounded-[12px] bg-court-soft p-4 font-medium text-court">
          Din e-mail er bekræftet, og din konto er klar. Næste skridt er at koble din DUPR-profil til herunder.
        </p>
      )}

      <section aria-labelledby="me-h" className="panel space-y-6 p-5 sm:p-6">
        <h2 id="me-h" className="text-xl font-bold">Dig</h2>
        <AvatarForm name={user.name} avatarKey={user.avatarKey} />
        <ProfileForm name={user.name} emailNotifications={user.emailNotifications} />
      </section>

      <section id="dupr" aria-labelledby="dupr-h" className="panel scroll-mt-24 space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="dupr-h" className="text-xl font-bold">DUPR</h2>
          {integ.isMock && <Chip tone="mine">Demo-udbyder, ikke ægte DUPR</Chip>}
        </div>

        {sp.dupr === "linked" && <p role="status" className="rounded-[10px] bg-court-soft p-3 font-medium text-court">Din DUPR-profil er koblet til.</p>}
        {sp.dupr_error && <p role="alert" className="rounded-[10px] bg-alert-soft p-3 font-medium text-alert">{ERRORS[sp.dupr_error] ?? ERRORS.INTERNAL}</p>}

        {!integ.active ? (
          <p>
            Forbindelsen til DUPR er ikke aktiveret endnu. Klubben afventer adgang til DUPR&apos;s officielle integration. Indtil da kan ratings ikke verificeres, og din rating kan ikke indtastes manuelt.
          </p>
        ) : link ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted">DUPR-profil</dt>
                <dd className="font-semibold">{link.displayName ?? "Ukendt navn"}</dd>
                <dd className="num text-sm text-muted">ID {link.externalId}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Verificeret rating</dt>
                <dd className="num text-2xl font-bold">{state.kind === "VERIFIED" ? formatRating(state.rating) : "–"}</dd>
                <dd className="num text-sm text-muted">
                  Double {formatRating(link.doublesRating)}, single {formatRating(link.singlesRating)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Senest synkroniseret</dt>
                <dd className="font-semibold">{link.lastSuccessfulSyncAt ? formatRelative(link.lastSuccessfulSyncAt) : "Aldrig"}</dd>
                {link.lastSuccessfulSyncAt && <dd className="text-sm text-muted">{formatDateTime(link.lastSuccessfulSyncAt)}</dd>}
              </div>
            </dl>
            <p className={state.kind === "VERIFIED" ? "text-sm text-muted" : "rounded-[10px] bg-alert-soft p-3 text-sm font-medium text-alert"}>
              {state.kind === "VERIFIED" ? (state.warning ?? `Ratings opdateres automatisk. En rating, der ikke er hentet inden for ${p.settings.staleAfterDays} dage, skal synkroniseres igen, før du kan booke.`) : ratingStateMessage(state)}
            </p>
            <div className="flex flex-wrap items-start gap-3">
              {state.kind === "REVOKED" ? (
                <form action="/api/dupr/link" method="post">
                  <button className="btn btn-primary">Kobl DUPR til igen</button>
                </form>
              ) : (
                <SyncButton tone="dark" />
              )}
              <UnlinkButton />
            </div>
            {logs.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-court">Seneste synkroniseringer</summary>
                <ul className="mt-2 divide-y divide-line">
                  {logs.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3 py-2">
                      <span>{formatDateTime(l.createdAt)}</span>
                      <span className={l.result === "FAILED" || l.result === "REVOKED" ? "text-alert" : "text-muted"}>{RESULT_LABEL[l.result]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <>
            <p className="max-w-[60ch]">
              Kobl din DUPR-profil til, så vi kan hente din officielle rating. Du logger ind hos DUPR og giver tilladelse; vi får kun dit DUPR-ID, navn og din rating. Du kan ikke indtaste din rating selv.
            </p>
            <form action="/api/dupr/link" method="post">
              <button className="btn btn-primary">Kobl DUPR til</button>
            </form>
          </>
        )}
      </section>

      <section id="boern" aria-labelledby="kids-h" className="panel scroll-mt-24 space-y-4 p-5 sm:p-6">
        <h2 id="kids-h" className="text-xl font-bold">Mine børn</h2>
        <p className="max-w-[62ch] text-sm">
          Har du børn i klubben, booker du for dem herfra med dit eget login. Barnets navn står på holdets deltagerliste, og du står som forælder. Man kan være medlem fra {MIN_CHILD_AGE} år. Vi gemmer kun navn og fødselsår.
        </p>
        {kids.length > 0 && (
          <ul className="space-y-4">
            {kids.map((k) => (
              <li key={k.id} className="rounded-[12px] border border-line p-4">
                <ChildForm child={k} minYear={year - MAX_CHILD_AGE} maxYear={year - MIN_CHILD_AGE} />
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-[12px] border border-dashed border-line p-4">
          <ChildForm minYear={year - MAX_CHILD_AGE} maxYear={year - MIN_CHILD_AGE} />
        </div>
      </section>

      <section aria-labelledby="cal-h" className="panel space-y-3 p-5 sm:p-6">
        <h2 id="cal-h" className="text-xl font-bold">Kalender</h2>
        <p className="max-w-[62ch] text-sm">Abonnér på dine bookinger i din egen kalender (Google, Apple, Outlook). Nye bookinger kommer automatisk med, og afmeldte forsvinder.</p>
        <CalendarPanel />
      </section>

      <section aria-labelledby="data-h" className="panel space-y-3 p-5 sm:p-6">
        <h2 id="data-h" className="text-xl font-bold">Dine data</h2>
        <p className="max-w-[62ch] text-sm">
          Hent en kopi af alt, vi har gemt om dig: profil, DUPR-forbindelse, ratinghistorik, bookinger, fremmøde, milepæle og notifikationer. Læs mere i <Link href="/privatliv" className="link">privatlivspolitikken</Link>.
        </p>
        <a href="/api/mig/eksport" className="btn btn-secondary" download>Download mine data</a>
      </section>

      <section aria-labelledby="del-h" className="panel space-y-3 border-alert/30 p-5 sm:p-6">
        <h2 id="del-h" className="text-xl font-bold">Slet konto</h2>
        <p className="max-w-[62ch] text-sm">
          Dit navn, din e-mail, dit billede, din DUPR-forbindelse og dine ratingdata slettes med det samme. Kommende bookinger afmeldes, og pladserne gives videre. Tidligere fremmøde bevares anonymt i klubbens statistik og kan ikke føres tilbage til dig.
        </p>
        <DeleteAccountForm />
      </section>
    </div>
  );
}
