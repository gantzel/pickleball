"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

interface Props {
  /** Verified rating observations, oldest first (ISO dates). */
  points: { at: string; rating: number }[];
  /** Dates of attended trainings and DUPR events (ISO). */
  attended: string[];
  events: string[];
  ratingLabel: string;
  now: string;
}

const PERIODS = [
  { key: "30", label: "Seneste 30 dage", days: 30 },
  { key: "90", label: "Seneste 3 måneder", days: 90 },
  { key: "365", label: "Seneste 12 måneder", days: 365 },
  { key: "all", label: "Hele perioden", days: null },
] as const;

const DAY = 86400_000;
const fmt = (n: number) => n.toLocaleString("da-DK", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtDate = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "Europe/Copenhagen" });

function Change({ value, decimals = false }: { value: number; decimals?: boolean }) {
  const up = value > (decimals ? 0.0005 : 0);
  const down = value < (decimals ? -0.0005 : 0);
  const text = decimals ? `${value >= 0 ? "+" : "−"}${fmt(Math.abs(value))}` : `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
  return (
    <span className={`num inline-flex items-center gap-1 text-sm font-semibold ${up ? "text-court" : down ? "text-wait" : "text-muted"}`}>
      <span aria-hidden="true">{up ? "↑" : down ? "↓" : "→"}</span>
      {text}
    </span>
  );
}

/** "Din udvikling": rating curve for a chosen period with the change, plus activity counts vs. the previous period. */
export function DevelopmentCard({ points: raw, attended: att, events: ev, ratingLabel, now: nowIso }: Props) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("30");
  const now = new Date(nowIso).getTime();
  const points = useMemo(() => raw.map((p) => ({ t: new Date(p.at).getTime(), r: p.rating })), [raw]);
  const attended = useMemo(() => att.map((d) => new Date(d).getTime()), [att]);
  const events = useMemo(() => ev.map((d) => new Date(d).getTime()), [ev]);

  const days = PERIODS.find((p) => p.key === period)!.days;
  const first = points[0]?.t ?? now;
  const start = days === null ? first : now - days * DAY;
  const prevStart = days === null ? null : start - days * DAY;

  // Rating in effect at the start of the period: the last observation before it (or the first one inside it).
  const before = [...points].reverse().find((p) => p.t <= start);
  const inside = points.filter((p) => p.t > start);
  const series = [...(before ? [{ t: start, r: before.r }] : []), ...inside];
  const current = points.at(-1)?.r ?? null;
  const startValue = series[0]?.r ?? null;
  const change = current !== null && startValue !== null ? current - startValue : null;
  const highest = series.length ? Math.max(...series.map((p) => p.r)) : null;

  const count = (list: number[], from: number | null, to: number) => (from === null ? list.filter((t) => t <= to).length : list.filter((t) => t > from && t <= to).length);
  const trainings = count(attended, start, now);
  const trainingsPrev = prevStart === null ? null : count(attended, prevStart, start);
  const eventCount = count(events, start, now);
  const eventsPrev = prevStart === null ? null : count(events, prevStart, start);

  // Chart geometry
  const W = 560;
  const H = 200;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const plot = series.length ? [...series, { t: now, r: series.at(-1)!.r }] : [];
  const vals = plot.map((p) => p.r);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const spread = Math.max(hi - lo, 0.1);
  const minV = lo - spread * 0.25;
  const maxV = hi + spread * 0.25;
  const t0 = plot[0]?.t ?? start;
  const t1 = Math.max(now, t0 + DAY);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - minV) / (maxV - minV)) * (H - pad.t - pad.b);
  const line = plot.map((p, i) => `${i ? "L" : "M"} ${x(p.t).toFixed(1)} ${y(p.r).toFixed(1)}`).join(" ");
  const area = plot.length ? `${line} L ${x(t1).toFixed(1)} ${H - pad.b} L ${x(t0).toFixed(1)} ${H - pad.b} Z` : "";

  return (
    <section aria-labelledby="dev-card-h" className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="dev-card-h" className="text-xl font-bold">Din udvikling</h2>
        <label className="sr-only" htmlFor="dev-period">Periode</label>
        <select id="dev-period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="field w-auto min-h-[38px] py-1 text-sm">
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>

      {plot.length ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <figure className="m-0">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Rating ${startValue !== null ? fmt(startValue) : ""} til ${current !== null ? fmt(current) : ""} i perioden`}>
              <defs>
                <linearGradient id="dev-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#1f5c4a" stopOpacity="0.22" />
                  <stop offset="1" stopColor="#1f5c4a" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="#d3ddd8" strokeWidth="1" />
              ))}
              <path d={area} fill="url(#dev-area)" />
              <path d={line} fill="none" stroke="#1f5c4a" strokeWidth="2.5" strokeLinejoin="round" />
              {series.map((p) => (
                <circle key={p.t} cx={x(p.t)} cy={y(p.r)} r="4" fill="#1f5c4a" stroke="#fff" strokeWidth="1.5" />
              ))}
              <text x={pad.l} y={H - 4} fontSize="12" fill="#52625b">{fmtDate.format(new Date(t0))}</text>
              <text x={W - pad.r} y={H - 4} fontSize="12" fill="#52625b" textAnchor="end">I dag</text>
            </svg>
          </figure>
          <div className="flex items-baseline gap-3 sm:block sm:text-right">
            <p className="text-sm font-semibold text-court">{ratingLabel}</p>
            <p className="num text-[clamp(2.2rem,6vw,3rem)] font-extrabold leading-none">{current !== null ? fmt(current) : "–"}</p>
            {change !== null && (
              <p className="mt-1">
                <span className={`inline-block rounded-full px-2 py-0.5 ${change > 0.0005 ? "bg-court-soft" : change < -0.0005 ? "bg-wait-soft" : "bg-paper"}`}>
                  <Change value={change} decimals />
                </span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Når din DUPR-rating er verificeret, begynder vi at gemme målinger, så du kan følge din udvikling her.</p>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-[12px] border border-line p-3">
          <dt className="text-[0.8rem] text-muted sm:text-sm">Træninger</dt>
          <dd className="num text-2xl font-bold">{trainings}</dd>
          {trainingsPrev !== null && <dd><Change value={trainings - trainingsPrev} /></dd>}
        </div>
        <div className="rounded-[12px] border border-line p-3">
          <dt className="text-[0.8rem] text-muted sm:text-sm">Turneringer</dt>
          <dd className="num text-2xl font-bold">{eventCount}</dd>
          {eventsPrev !== null && <dd><Change value={eventCount - eventsPrev} /></dd>}
        </div>
        <div className="rounded-[12px] border border-line p-3">
          <dt className="text-[0.8rem] text-muted sm:text-sm">Højeste rating</dt>
          <dd className="num text-2xl font-bold">{highest !== null ? fmt(highest) : "–"}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm">
        <Link href="/udvikling" className="link">Se hele din udvikling</Link>
      </p>
    </section>
  );
}
