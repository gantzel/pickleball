import Link from "next/link";
import { formatRating, formatRelative } from "@/lib/format";
import { ratingStateMessage, type RatingState } from "@/server/eligibility";
import { SyncButton } from "./sync-button";

export interface ProfileHeroProps {
  name: string;
  avatarKey: string | null;
  subtitle: string;
  state: RatingState;
  ratingType: "DOUBLES" | "SINGLES";
  delta30: number | null;
  clubRank: { rank: number; total: number } | null;
  events: number;
  holdName: string | null;
  trainings: number;
  recent30: number;
  linked: boolean;
  integrationActive: boolean;
  isMock: boolean;
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatRating(Math.abs(n))}`;

export function DeltaBadge({ value, dark = false }: { value: number; dark?: boolean }) {
  const up = value > 0.0005;
  const down = value < -0.0005;
  const tone = up ? (dark ? "bg-[#2e7d57] text-white" : "bg-court-soft text-court") : down ? (dark ? "bg-white/15 text-white" : "bg-wait-soft text-wait") : dark ? "bg-white/15 text-white" : "bg-paper text-muted";
  return (
    <span className={`num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${tone}`}>
      <span aria-hidden="true">{up ? "↑" : down ? "↓" : "→"}</span>
      {signed(value)}
    </span>
  );
}

/** Dark profile card: who you are, your verified DUPR rating, club rank and activity. Only real data. */
export function ProfileHero(p: ProfileHeroProps) {
  const verified = p.state.kind === "VERIFIED";
  const rating = verified ? (p.state as Extract<RatingState, { kind: "VERIFIED" }>).rating : null;
  const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  return (
    <section aria-labelledby="hero-name" className="relative overflow-hidden rounded-[20px] bg-[#123329] text-white">
      {/* Photo on the right (larger screens), fading into the card */}
      {p.avatarKey ? (
        <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-[42%] md:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/avatars/${p.avatarKey}`} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#123329] via-[#123329]/50 to-transparent" />
        </div>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 400 300" className="absolute -right-10 top-0 hidden h-full w-[45%] opacity-25 md:block" preserveAspectRatio="xMidYMid slice">
          <g stroke="#fff" strokeWidth="3" fill="none" transform="rotate(-10 200 150)">
            <rect x="60" y="40" width="300" height="220" />
            <line x1="210" y1="30" x2="210" y2="270" strokeWidth="5" />
            <line x1="160" y1="40" x2="160" y2="260" />
            <line x1="260" y1="40" x2="260" y2="260" />
          </g>
          <circle cx="300" cy="90" r="16" fill="#dce84a" />
        </svg>
      )}

      <div className="relative grid gap-6 p-5 sm:p-8 md:max-w-[64%]">
        <div className="flex items-center gap-4">
          {/* The avatar is the way to change the photo. */}
          <Link
            href="/profil#billede"
            aria-label={p.avatarKey ? "Skift profilbillede" : "Tilføj profilbillede"}
            title={p.avatarKey ? "Skift profilbillede" : "Tilføj profilbillede"}
            className="group relative shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ball"
          >
            {p.avatarKey ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/avatars/${p.avatarKey}`} alt="" className="h-16 w-16 rounded-full border-2 border-white/80 object-cover transition group-hover:opacity-85 sm:h-20 sm:w-20" />
            ) : (
              <span aria-hidden="true" className="inline-flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/60 bg-white/10 text-2xl font-bold transition group-hover:bg-white/20 sm:h-20 sm:w-20">
                {initials}
              </span>
            )}
            <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#123329] bg-ball text-ink">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M2 5.5h2.5L6 3.5h4l1.5 2H14V13H2z" />
                <circle cx="8" cy="9" r="2.3" />
              </svg>
            </span>
          </Link>
          <div className="min-w-0">
            <h2 id="hero-name" className="truncate text-[clamp(1.4rem,4vw,2rem)] font-bold leading-tight">{p.name}</h2>
            <p className="text-[0.95rem] text-white/75">{p.subtitle}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-[auto_1px_auto_auto] sm:items-end">
          <div className="col-span-2 sm:col-span-1">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/70">
              DUPR {p.ratingType === "DOUBLES" ? "double" : "single"}
              {p.isMock && <span className="rounded-full bg-ball px-2 py-0.5 text-[0.7rem] normal-case tracking-normal text-ink">Demo</span>}
            </p>
            {rating !== null ? (
              <>
                <p className="num mt-1 flex flex-wrap items-baseline gap-3">
                  <span className="text-[clamp(2.8rem,9vw,4rem)] font-extrabold leading-none tracking-tight">{formatRating(rating)}</span>
                  {p.delta30 !== null && <DeltaBadge value={p.delta30} dark />}
                </p>
                <p className="mt-1 text-sm text-white/70">
                  {p.delta30 !== null ? "Seneste 30 dage · " : ""}synkroniseret {formatRelative((p.state as Extract<RatingState, { kind: "VERIFIED" }>).syncedAt)}
                </p>
              </>
            ) : (
              <p className="mt-2 max-w-[38ch] text-white/85">{ratingStateMessage(p.state)}</p>
            )}
          </div>
          <span aria-hidden="true" className="hidden h-16 w-px bg-white/20 sm:block" />
          <div>
            <p className="text-sm text-white/70">Rang i klubben</p>
            <p className="num mt-1 text-3xl font-bold">{p.clubRank ? `#${p.clubRank.rank}` : "–"}</p>
            <p className="text-sm text-white/60">{p.clubRank ? `af ${p.clubRank.total} med rating` : "kræver verificeret rating"}</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white/70">Dit hold</p>
            <p className="mt-1 break-words text-2xl font-bold leading-tight">{p.holdName ?? "–"}</p>
            <p className="text-sm text-white/60">{p.holdName ? "følger din rating" : "kræver verificeret rating"}</p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { label: "Træninger", value: p.trainings },
            { label: "Seneste 30 dage", value: p.recent30 },
            { label: "Turneringer", value: p.events, hint: "DUPR-events" },
          ].map((t) => (
            <div key={t.label} className="rounded-[12px] border border-white/15 bg-white/5 p-3">
              <dt className="text-[0.8rem] text-white/70 sm:text-sm">{t.label}</dt>
              <dd className="num mt-0.5 text-2xl font-bold">{t.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          {p.linked && p.integrationActive && p.state.kind !== "REVOKED" ? (
            <SyncButton />
          ) : p.integrationActive ? (
            <Link href="/profil#dupr" className="btn bg-ball text-ink hover:bg-white">
              {p.state.kind === "REVOKED" ? "Kobl DUPR til igen" : "Kobl DUPR til"}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
