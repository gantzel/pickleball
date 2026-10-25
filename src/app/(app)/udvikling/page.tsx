import { EmptyState, PageHeader } from "@/components/app-shell";
import { RatingChart } from "@/components/rating-chart";
import { formatDate, formatMonthDay, formatRating, formatBand } from "@/lib/format";
import { requireUser, toActor } from "@/server/current-user";
import { ATTENDANCE_ACHIEVEMENTS, STREAK_ACHIEVEMENT, VERIFIED_ACHIEVEMENT } from "@/server/achievements";
import { memberProgress } from "@/server/progress";

export const metadata = { title: "Udvikling" };

export default async function ProgressPage() {
  const p = await memberProgress(toActor(await requireUser()));
  const rating = p.ratingState.kind === "VERIFIED" ? p.ratingState.rating : null;
  const earned = new Set(p.achievements.map((a) => a.code));
  const upcomingMilestones = [VERIFIED_ACHIEVEMENT, ...ATTENDANCE_ACHIEVEMENTS, STREAK_ACHIEVEMENT].filter((a) => !earned.has(a.code));

  // Merged timeline of rating changes and attended trainings.
  const timeline = [
    ...p.history.map((h, i) => ({ at: h.at, kind: "rating" as const, text: i === 0 ? `Første verificerede rating: ${formatRating(h.rating)}` : `Rating ændret til ${formatRating(h.rating)} (${h.rating >= p.history[i - 1].rating ? "+" : "−"}${formatRating(Math.abs(h.rating - p.history[i - 1].rating))})` })),
    ...p.attendedSessions.map((s) => ({ at: s.startsAt, kind: "training" as const, text: `Deltog i ${s.title}` })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 25);

  return (
    <>
      <PageHeader title="Din udvikling" intro="Kun ratings hentet fra DUPR og træninger, træneren har registreret, tæller med her." />

      <section aria-labelledby="chart-h" className="panel p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="chart-h" className="text-xl font-bold">Rating over tid</h2>
          {rating !== null && <p className="num text-2xl font-bold">{formatRating(rating)}</p>}
        </div>
        {p.history.length ? (
          <>
            <RatingChart points={p.history} levels={p.levels} attended={p.attendedSessions.map((s) => s.startsAt)} />
            {!p.historyIncludesProvider && p.trackingSince && (
              <p className="mt-3 text-sm text-muted">
                Vi har registreret din rating siden {formatDate(p.trackingSince)}, da din DUPR-profil blev koblet til. Ældre historik er ikke tilgængelig her.
              </p>
            )}
          </>
        ) : (
          <EmptyState title="Ingen målinger endnu">Når din DUPR-rating er verificeret, gemmer vi hver ændring, så kurven bygges op over tid.</EmptyState>
        )}
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="levels-h" className="panel p-5 sm:p-6">
          <h2 id="levels-h" className="text-xl font-bold">Niveauer</h2>
          <p className="mt-1 text-sm text-muted">Din verificerede DUPR-rating afgør automatisk, hvilket niveau du træner på. Stiger eller falder ratingen over en grænse, flytter din adgang med. Adgang giver ret til at booke, men ikke garanti for en plads.</p>
          <ol className="mt-4 space-y-2">
            {p.levels.map((l) => {
              const current = p.progress?.current?.id === l.id;
              const above = rating !== null && l.minRating !== null && l.minRating > rating;
              const reached = current;
              return (
                <li key={l.id} className={`flex items-center gap-3 rounded-[10px] border p-3 ${current ? "border-court bg-court-soft" : "border-line"}`}>
                  <span aria-hidden="true" className="h-8 w-1.5 rounded-full" style={{ background: l.color, opacity: reached ? 1 : 0.35 }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {l.name} {current && <span className="text-sm font-medium text-court">(dit niveau)</span>}
                    </p>
                    <p className="num text-sm text-muted">{formatBand(l.minRating, l.maxRating, true)}</p>
                  </div>
                  <span className="text-sm font-medium">{current ? "Din adgang" : above ? `+${formatRating((l.minRating ?? 0) - rating!)}` : rating !== null ? "Under dit niveau" : "Kræver rating"}</span>
                </li>
              );
            })}
            {p.levels.length === 0 && <li className="text-sm text-muted">Klubben har ikke oprettet niveauer endnu.</li>}
          </ol>
        </section>

        <section aria-labelledby="ach-h" className="panel p-5 sm:p-6">
          <h2 id="ach-h" className="text-xl font-bold">Milepæle</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-[10px] bg-paper p-3">
              <dt className="text-xs text-muted">Træninger</dt>
              <dd className="num text-2xl font-bold">{p.attendedCount}</dd>
            </div>
            <div className="rounded-[10px] bg-paper p-3">
              <dt className="text-xs text-muted">Seneste 30 dage</dt>
              <dd className="num text-2xl font-bold">{p.recentAttended}</dd>
            </div>
            <div className="rounded-[10px] bg-paper p-3">
              <dt className="text-xs text-muted">Længste stime</dt>
              <dd className="num text-2xl font-bold">{p.longestStreak} <span className="text-sm font-medium">uger</span></dd>
            </div>
          </dl>
          <ul className="mt-4 space-y-2">
            {p.achievements.map((a) => (
              <li key={a.code} className="flex items-start gap-3 rounded-[10px] bg-ball-soft p-3">
                <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-ink bg-ball" />
                <div>
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-sm text-muted">{a.description} {formatMonthDay(a.awardedAt)}.</p>
                </div>
              </li>
            ))}
            {upcomingMilestones.slice(0, 3).map((a) => (
              <li key={a.code} className="flex items-start gap-3 rounded-[10px] border border-dashed border-line p-3">
                <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-line" />
                <div>
                  <p className="font-semibold text-muted">{a.title}</p>
                  <p className="text-sm text-muted">{a.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="tl-h" className="panel mt-8 p-5 sm:p-6">
        <h2 id="tl-h" className="text-xl font-bold">Tidslinje</h2>
        {timeline.length ? (
          <ol className="mt-4 border-l-2 border-line pl-5">
            {timeline.map((t, i) => (
              <li key={i} className="relative pb-4 last:pb-0">
                <span aria-hidden="true" className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 ${t.kind === "rating" ? "border-ink bg-ball" : "border-court bg-surface"}`} />
                <p className="font-medium">{t.text}</p>
                <p className="text-sm text-muted">{formatDate(t.at)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted">Dine ratingændringer og træninger vises her.</p>
        )}
      </section>
    </>
  );
}
