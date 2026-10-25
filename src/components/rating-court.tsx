import Link from "next/link";
import { formatRating, formatRelative } from "@/lib/format";
import { ratingStateMessage, type RatingState } from "@/server/eligibility";
import type { MyProgramme } from "./my-programmes";
import { SyncButton } from "./sync-button";

/**
 * The member's verified rating drawn on a court (white lines on court green),
 * with the programmes ("hold") the member can book right now.
 */
export function RatingCourt({
  state,
  programmes,
  ratingType,
  linked,
  integrationActive,
  isMock,
}: {
  state: RatingState;
  programmes: MyProgramme[];
  ratingType: "DOUBLES" | "SINGLES";
  linked: boolean;
  integrationActive: boolean;
  isMock: boolean;
}) {
  const verified = state.kind === "VERIFIED";
  const rating = verified ? state.rating : null;
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

      {programmes.length > 0 && <ProgrammeChips programmes={programmes} />}
    </section>
  );
}

function ProgrammeChips({ programmes }: { programmes: MyProgramme[] }) {
  return (
    <div className="relative border-t-2 border-white/25 px-6 pb-6 pt-5 sm:px-8">
      <h3 className="mb-3 text-[0.95rem] font-semibold">Dine hold</h3>
      <ul className="flex flex-wrap gap-2">
        {programmes.map((p) => (
          <li key={p.id} className="inline-flex items-center gap-2 rounded-full border-2 border-white/60 bg-white/10 px-3 py-1.5 text-sm font-semibold">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
