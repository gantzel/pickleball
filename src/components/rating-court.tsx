import Link from "next/link";
import type { TrainingLevel } from "@/db/schema";
import { formatRating, formatRelative, formatBand } from "@/lib/format";
import { levelProgress, ratingStateMessage, type RatingState } from "@/server/eligibility";
import { SyncButton } from "./sync-button";

/**
 * The member's verified rating drawn on a court: white court lines on court
 * green, and the club's levels laid out as zones on a strip, with a ball at
 * the member's rating and a line at the next threshold.
 */
export function RatingCourt({
  state,
  levels,
  ratingType,
  linked,
  integrationActive,
  isMock,
}: {
  state: RatingState;
  levels: TrainingLevel[];
  ratingType: "DOUBLES" | "SINGLES";
  linked: boolean;
  integrationActive: boolean;
  isMock: boolean;
}) {
  const verified = state.kind === "VERIFIED";
  const rating = verified ? state.rating : null;
  const prog = rating !== null ? levelProgress(rating, levels) : null;
  const typeLabel = ratingType === "DOUBLES" ? "double" : "single";

  return (
    <section aria-labelledby="rating-heading" className="relative overflow-hidden rounded-[18px] bg-court text-white">
      <div className="relative">
      {/* Half a court on the right: boundary, net and kitchen line. The level strip's top border closes it. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 bottom-0 top-3 rounded-t-[6px] border-2 border-b-0 border-white/20">
        <div className="absolute inset-y-0 left-[64%] border-l-2 border-white/20" />
        <div className="absolute inset-y-0 left-[82%] border-l-2 border-white/12" />
        <div className="absolute left-[82%] right-0 top-1/2 border-t-2 border-white/12" />
      </div>
      <div className="relative grid gap-6 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <h2 id="rating-heading" className="text-base font-semibold text-white/85">
            Din DUPR-rating, {typeLabel}
            {isMock && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-ball px-2 py-0.5 align-middle text-xs font-bold text-ink">Demo, ikke ægte DUPR</span>}
          </h2>
          <p className="num mt-1 text-[clamp(3.5rem,11vw,6rem)] font-extrabold leading-[0.95] tracking-tight" aria-live="polite">
            {rating !== null ? formatRating(rating) : state.kind === "STALE" && state.rating !== null ? <span className="text-white/45">{formatRating(state.rating)}</span> : <span className="block pt-3 text-[clamp(1.75rem,5vw,2.5rem)] font-bold text-white/80">Ikke verificeret</span>}
          </p>
          <p className="mt-2 max-w-[46ch] text-[0.95rem] text-white/85">
            {verified ? (
              <>
                Verificeret. Synkroniseret {formatRelative(state.syncedAt)}.
                {state.warning && <span className="mt-1 block text-ball">{state.warning}</span>}
              </>
            ) : (
              ratingStateMessage(state)
            )}
            {!verified && "syncedAt" in state && state.syncedAt && <span className="block text-white/70">Senest hentet {formatRelative(state.syncedAt)}.</span>}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2">
          {linked && integrationActive && state.kind !== "REVOKED" ? (
            <SyncButton />
          ) : integrationActive ? (
            <Link href="/profil#dupr" className="btn bg-ball text-ink hover:bg-white">
              {state.kind === "REVOKED" ? "Kobl DUPR til igen" : "Kobl DUPR til"}
            </Link>
          ) : null}
        </div>
      </div>
      </div>

      {levels.length > 0 && <LevelStrip levels={levels} rating={rating} nextId={prog?.next?.id ?? null} gap={prog?.gap ?? null} />}
    </section>
  );
}

function LevelStrip({ levels, rating, nextId, gap }: { levels: TrainingLevel[]; rating: number | null; nextId: string | null; gap: number | null }) {
  // A level without a floor (e.g. "under 3.0") is drawn 0.75 wide.
  const floorOf = (l: TrainingLevel) => l.minRating ?? (l.maxRating ?? 0) - 0.75;
  const lo = Math.min(...levels.map(floorOf));
  const hiLevel = levels[levels.length - 1];
  const hi = Math.max(hiLevel.maxRating ?? floorOf(hiLevel) + 0.75, ...levels.map((l) => l.maxRating ?? floorOf(l)));
  const isCurrent = (l: TrainingLevel) =>
    rating !== null && (l.minRating === null || rating >= l.minRating) && (l.maxRating === null || rating < l.maxRating);
  const pct = (r: number) => Math.min(100, Math.max(0, ((r - lo) / (hi - lo)) * 100));
  const next = levels.find((l) => l.id === nextId) ?? null;

  return (
    <div className="relative border-t-2 border-white/25 px-6 pb-6 pt-5 sm:px-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-[0.95rem]">
        <h3 className="font-semibold">Niveauer i klubben</h3>
        {rating !== null && next && gap !== null && (
          <p className="text-white/90">
            <span className="num font-bold text-ball">+{formatRating(gap)}</span> til {next.name} ({formatRating(next.minRating)})
          </p>
        )}
        {rating !== null && !next && <p className="text-white/90">Du er på klubbens højeste niveau.</p>}
      </div>
      <div className="relative">
        <ol className="flex h-11 overflow-hidden rounded-[8px] border-2 border-white/70" aria-label="Niveauer og ratinggrænser">
          {levels.map((l, i) => {
            const end = l.maxRating ?? hi;
            const current = isCurrent(l);
            return (
              <li
                key={l.id}
                className={`relative flex min-w-0 items-center px-2 text-[0.78rem] font-semibold sm:text-sm ${i > 0 ? "border-l-2 border-white/70" : ""} ${current ? "bg-white/25" : "bg-black/10 text-white/65"}`}
                style={{ width: `${pct(end) - pct(floorOf(l))}%` }}
              >
                <span className="truncate">{l.name}</span>
                <span className="sr-only">
                  , {formatBand(l.minRating, l.maxRating, true)}
                  {current ? ", dit niveau" : ""}
                </span>
              </li>
            );
          })}
        </ol>
        {next && (
          <div aria-hidden="true" className="absolute -bottom-1 -top-1 border-l-2 border-dashed border-ball" style={{ left: `${pct(floorOf(next))}%` }} />
        )}
        {rating !== null && (
          <div
            aria-hidden="true"
            className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-ball shadow-[0_2px_0_rgba(0,0,0,.25)]"
            style={{ left: `${pct(rating)}%` }}
          >
            <span className="absolute left-[7px] top-[5px] h-1 w-1 rounded-full bg-ink/70" />
            <span className="absolute right-[6px] top-[9px] h-1 w-1 rounded-full bg-ink/70" />
            <span className="absolute bottom-[5px] left-[9px] h-1 w-1 rounded-full bg-ink/70" />
          </div>
        )}
      </div>
      <p className="num mt-1.5 text-xs text-white/70" aria-hidden="true">{formatRating(lo)}</p>
      <p className="mt-3 text-sm text-white/75">En højere rating åbner for flere træninger, men giver ikke plads på en fuld træning.</p>
    </div>
  );
}
