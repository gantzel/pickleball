import Link from "next/link";
import { EmptyState } from "@/components/app-shell";
import { MyProgrammes } from "@/components/my-programmes";
import { RatingChart } from "@/components/rating-chart";
import { RatingCourt } from "@/components/rating-court";
import { SessionRow } from "@/components/session-row";
import { Chip } from "@/components/status-chip";
import { formatDateTime, formatRating, formatShortDate, formatTime } from "@/lib/format";
import { requireUser, toActor } from "@/server/current-user";
import { integrationStatus } from "@/server/dupr/provider";
import { memberProgress } from "@/server/progress";
import { listUpcomingForMember, memberBookingHistory } from "@/server/sessions";

export const metadata = { title: "Hjem" };

export default async function Dashboard() {
  const user = await requireUser();
  const actor = toActor(user);
  const [views, progress, history] = await Promise.all([listUpcomingForMember(actor), memberProgress(actor), memberBookingHistory(actor, 8)]);
  const integ = integrationStatus();

  const offered = views.filter((v) => v.availability.code === "OFFERED");
  const mine = views.filter((v) => ["BOOKED", "WAITLISTED"].includes(v.availability.code));
  const bookable = views.filter((v) => v.availability.code === "AVAILABLE");
  const full = views.filter((v) => v.availability.code === "FULL_WAITLIST");
  const rating = progress.ratingState.kind === "VERIFIED" ? progress.ratingState.rating : null;
  const firstName = user.name.split(" ")[0];
  const past = history.filter((h) => h.s.startsAt < new Date()).slice(0, 5);

  return (
    <div className="space-y-8">
      <h1 className="text-[clamp(1.75rem,4vw,2.5rem)] font-bold">Hej, {firstName}</h1>

      <RatingCourt
        state={progress.ratingState}
        programmes={progress.myProgrammes}
        ratingType={progress.settings.ratingType}
        linked={!!progress.link}
        integrationActive={!!integ.active}
        isMock={integ.isMock}
      />

      {!integ.active && (
        <p className="rounded-[12px] border border-line bg-surface p-4 text-sm">
          Forbindelsen til DUPR er ikke aktiveret endnu, så ingen ratings kan verificeres, og rating-begrænsede træninger kan ikke bookes. Klubben arbejder på det.
        </p>
      )}

      {offered.length > 0 && (
        <section aria-labelledby="offer-h" className="rounded-[16px] border-2 border-ball bg-ball-soft p-4 sm:p-5">
          <h2 id="offer-h" className="mb-3 text-xl font-bold">Der er en plads til dig</h2>
          <ul className="space-y-3">
            {offered.map((v) => (
              <SessionRow key={v.session.id} v={v} />
            ))}
          </ul>
          {offered.map((v) =>
            v.availability.code === "OFFERED" ? (
              <p key={v.session.id} className="mt-2 text-sm">
                Accepter {v.session.title} senest {formatDateTime(v.availability.expiresAt)}.
              </p>
            ) : null,
          )}
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-8">
          <section aria-labelledby="bookable-h">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="bookable-h" className="text-xl font-bold">Kan bookes nu</h2>
              <Link href="/traeninger" className="link text-sm">Alle træninger</Link>
            </div>
            {bookable.length ? (
              <ul className="space-y-3">
                {bookable.slice(0, 5).map((v) => (
                  <SessionRow key={v.session.id} v={v} />
                ))}
              </ul>
            ) : (
              <EmptyState title={rating === null ? "Ingen træninger kan bookes endnu" : "Ingen ledige træninger på dit niveau lige nu"}>
                {rating === null ? "Du skal have en verificeret DUPR-rating for at booke." : "Nye træninger dukker op her, så snart de er lagt ud."}
              </EmptyState>
            )}
          </section>

          <section aria-labelledby="mine-h">
            <h2 id="mine-h" className="mb-3 text-xl font-bold">Dine bookinger</h2>
            {mine.length ? (
              <ul className="space-y-3">
                {mine.map((v) => (
                  <SessionRow key={v.session.id} v={v} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Du har ingen kommende bookinger" />
            )}
          </section>

          {full.length > 0 && (
            <section aria-labelledby="full-h">
              <h2 id="full-h" className="mb-1 text-xl font-bold">Fulde træninger med venteliste</h2>
              <p className="mb-3 text-sm text-muted">Bliver der en plads, tilbydes den til den første på ventelisten, der opfylder ratingkravet.</p>
              <ul className="space-y-3">
                {full.slice(0, 4).map((v) => (
                  <SessionRow key={v.session.id} v={v} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-8">
          <section aria-labelledby="mine-hold-h" className="panel p-5">
            <h2 id="mine-hold-h" className="text-lg font-bold">Dine hold</h2>
            <MyProgrammes items={progress.myProgrammes} verified={progress.ratingState.kind === "VERIFIED"} compact />
          </section>

          <section aria-labelledby="dev-h" className="panel p-5">
            <div className="flex items-baseline justify-between">
              <h2 id="dev-h" className="text-lg font-bold">Din udvikling</h2>
              <Link href="/udvikling" className="link text-sm">Se mere</Link>
            </div>
            {progress.history.length >= 2 ? (
              <div className="mt-3">
                <RatingChart points={progress.history} attended={progress.attendedSessions.map((s) => s.startsAt)} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">{progress.history.length === 1 ? `Første verificerede måling: ${formatRating(progress.history[0].rating)}. Kurven vises, når din rating ændrer sig.` : "Når din rating er verificeret, begynder vi at gemme målinger, så du kan følge din udvikling."}</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-[10px] bg-paper p-3">
                <dt className="text-muted">Træninger i alt</dt>
                <dd className="num text-2xl font-bold">{progress.attendedCount}</dd>
              </div>
              <div className="rounded-[10px] bg-paper p-3">
                <dt className="text-muted">Seneste 30 dage</dt>
                <dd className="num text-2xl font-bold">{progress.recentAttended}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="hist-h" className="panel p-5">
            <h2 id="hist-h" className="text-lg font-bold">Seneste aktivitet</h2>
            {past.length ? (
              <ul className="mt-3 space-y-2.5 text-sm">
                {past.map(({ b, s }) => (
                  <li key={b.id} className="flex items-start justify-between gap-3">
                    <Link href={`/traeninger/${s.id}`} className="min-w-0 hover:underline">
                      <span className="block truncate font-medium">{s.title}</span>
                      <span className="text-muted">
                        {formatShortDate(s.startsAt)} kl. {formatTime(s.startsAt)}
                      </span>
                    </Link>
                    <Chip tone={b.attendance === "ATTENDED" ? "go" : b.status === "CANCELLED" ? "quiet" : "quiet"}>
                      {b.attendance === "ATTENDED" ? "Deltog" : b.attendance === "NO_SHOW" ? "Udeblev" : b.status === "CANCELLED" ? "Afmeldt" : b.status === "EXPIRED" ? "Udløbet" : "Booket"}
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Din træningshistorik vises her.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
