import Link from "next/link";
import { EmptyState } from "@/components/app-shell";
import { MyProgrammes } from "@/components/my-programmes";
import { DevelopmentCard } from "@/components/development-card";
import { ProfileHero } from "@/components/profile-hero";
import { SessionCard } from "@/components/session-card";
import { SessionRow } from "@/components/session-row";
import { Chip } from "@/components/status-chip";
import { formatDateTime, formatShortDate, formatTime } from "@/lib/format";
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

  const now = new Date();
  const offered = views.filter((v) => v.availability.code === "OFFERED");
  const mine = views.filter((v) => ["BOOKED", "WAITLISTED"].includes(v.availability.code));
  // "Træninger på dit niveau": what the member can book, sessions on their rating programme first.
  const forYou = views
    .filter((v) => ["AVAILABLE", "FULL_WAITLIST"].includes(v.availability.code))
    .sort((a, b) => Number(b.rule.kind === "RATING") - Number(a.rule.kind === "RATING") || a.session.startsAt.getTime() - b.session.startsAt.getTime())
    .slice(0, 3);
  const rating = progress.ratingState.kind === "VERIFIED" ? progress.ratingState.rating : null;
  const past = history.filter((h) => h.s.startsAt < now).slice(0, 5);
  // Change over the last 30 days: current rating minus the one in effect 30 days ago (or the first one since).
  const cutoff = now.getTime() - 30 * 86400_000;
  const atCutoff = [...progress.history].reverse().find((h) => h.at.getTime() <= cutoff) ?? progress.history[0];
  const delta30 = rating !== null && atCutoff && progress.history.length > 1 ? rating - atCutoff.rating : null;
  const memberSince = new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric", timeZone: "Europe/Copenhagen" }).format(user.createdAt ?? now);

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Hjem</h1>

      <ProfileHero
        name={user.name}
        avatarKey={user.avatarKey}
        subtitle={`Medlem af Pickleball København siden ${memberSince}`}
        state={progress.ratingState}
        ratingType={progress.settings.ratingType}
        delta30={delta30}
        clubRank={progress.clubRank}
        events={progress.eventDates.length}
        holdName={progress.progress?.current?.name ?? null}
        trainings={progress.attendedCount}
        recent30={progress.recentAttended}
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

      <section aria-labelledby="foryou-h" className="panel p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="foryou-h" className="text-xl font-bold">Træninger på dit niveau</h2>
            <p className="text-sm text-muted">Træninger, du kan booke nu — på dine hold.</p>
          </div>
          <Link href="/traeninger?vis=kan-bookes" className="link inline-flex items-center gap-1 text-sm font-semibold">
            Se alle <span aria-hidden="true">→</span>
          </Link>
        </div>
        {forYou.length ? (
          // Phones: a swipeable row; larger screens: a grid.
          <ul className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 [&>li]:w-[82%] [&>li]:shrink-0 [&>li]:snap-start sm:[&>li]:w-auto">
            {forYou.map((v) => (
              <SessionCard key={v.session.id} v={v} />
            ))}
          </ul>
        ) : (
          <EmptyState title={rating === null ? "Ingen træninger kan bookes endnu" : "Ingen ledige træninger lige nu"}>
            {rating === null ? "Kobl din DUPR-profil til, så åbner de hold, der passer til din rating. Social Play kan altid bookes." : "Nye træninger dukker op her, så snart de er lagt ud."}
          </EmptyState>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-8">
          <DevelopmentCard
            points={progress.history.map((h) => ({ at: h.at.toISOString(), rating: h.rating }))}
            attended={progress.attendedDates.map((d) => d.toISOString())}
            events={progress.eventDates.map((d) => d.toISOString())}
            ratingLabel={`DUPR ${progress.settings.ratingType === "DOUBLES" ? "double" : "single"}`}
            now={now.toISOString()}
          />

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
        </div>

        <aside className="space-y-8">
          <section aria-labelledby="mine-hold-h" className="panel p-5">
            <h2 id="mine-hold-h" className="text-lg font-bold">Dine hold</h2>
            <MyProgrammes items={progress.myProgrammes} verified={progress.ratingState.kind === "VERIFIED"} compact />
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
                    <Chip tone={b.attendance === "ATTENDED" ? "go" : "quiet"}>
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
