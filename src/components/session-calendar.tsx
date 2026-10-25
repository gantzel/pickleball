"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface CalendarItem {
  id: string;
  title: string;
  /** YYYY-MM-DD in club time */
  day: string;
  time: string;
  location: string;
  levelName: string | null;
  levelColor: string | null;
  status: string;
  tone: "go" | "wait" | "lock" | "alert" | "mine" | "quiet";
  isDemo: boolean;
  /** Extra line, e.g. "8/12 booket" in the admin calendar. */
  meta?: string;
}

const TONE: Record<CalendarItem["tone"], string> = {
  go: "bg-court text-white",
  wait: "bg-wait-soft text-wait",
  lock: "bg-lock-soft text-lock",
  alert: "bg-alert-soft text-alert",
  mine: "bg-ball text-ink",
  quiet: "bg-paper text-muted border border-line",
};

const WEEKDAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const monthFmt = new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric", timeZone: "UTC" });
const longDayFmt = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// All date maths on UTC midnights of club-local dates, so time zones never shift a day.
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function monthGrid(month: string) {
  const first = parse(`${month}-01`);
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const start = addDays(first, -offset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  // Drop a trailing week that is entirely in the next month.
  return days.slice(0, days[35].toISOString().slice(0, 7) === month ? 42 : 35);
}

function shiftMonth(month: string, n: number) {
  const d = parse(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return key(d).slice(0, 7);
}

export function SessionCalendar({
  items,
  today,
  hrefBase = "/traeninger/",
  minMonth,
}: {
  items: CalendarItem[];
  today: string;
  /** Where a session links to (members: /traeninger/, admins: /admin/traeninger/). */
  hrefBase?: string;
  /** Earliest month that can be shown (default: the current month). */
  minMonth?: string;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) m.set(it.day, [...(m.get(it.day) ?? []), it]);
    return m;
  }, [items]);
  const thisMonth = today.slice(0, 7);
  const earliest = minMonth ?? thisMonth;
  const firstUpcoming = items.find((i) => i.day >= today)?.day.slice(0, 7) ?? thisMonth;
  const [month, setMonth] = useState(firstUpcoming < earliest ? earliest : firstUpcoming);
  const [selected, setSelected] = useState<string>(items.find((i) => i.day.startsWith(month))?.day ?? today);
  const days = monthGrid(month);
  const lastMonth = [items.at(-1)?.day.slice(0, 7) ?? thisMonth, thisMonth].sort().at(-1)!;
  const selectedItems = byDay.get(selected) ?? [];

  const go = (n: number) => {
    const m = shiftMonth(month, n);
    setMonth(m);
    setSelected(items.find((i) => i.day.startsWith(m))?.day ?? (m === thisMonth ? today : `${m}-01`));
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold" aria-live="polite">{cap(monthFmt.format(parse(`${month}-01`)))}</h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary min-h-[40px] px-3" onClick={() => go(-1)} disabled={month <= earliest} aria-label="Forrige måned">
            ‹
          </button>
          <button type="button" className="btn btn-secondary min-h-[40px] px-3" onClick={() => go(1)} disabled={month >= lastMonth} aria-label="Næste måned">
            ›
          </button>
        </div>
      </div>

      <div className="panel overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-line bg-paper text-center text-xs font-semibold text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const k = key(d);
            const list = byDay.get(k) ?? [];
            const inMonth = k.startsWith(month);
            const isToday = k === today;
            const isSelected = k === selected;
            const label = `${longDayFmt.format(d)}, ${list.length === 0 ? "ingen træninger" : `${list.length} ${list.length === 1 ? "træning" : "træninger"}`}`;
            return (
              <div
                key={k}
                className={`min-h-[64px] border-line p-1 sm:min-h-[112px] sm:p-1.5 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-paper/60"} ${isSelected ? "bg-court-soft" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setSelected(k)}
                  aria-label={label}
                  aria-pressed={isSelected}
                  className="flex w-full flex-col items-start gap-1 rounded-md text-left"
                >
                  <span
                    className={`num inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday ? "bg-court font-bold text-white" : inMonth ? "font-semibold" : "text-muted"}`}
                  >
                    {d.getUTCDate()}
                  </span>
                  {/* Phones: one dot per session, in the programme's colour. */}
                  {list.length > 0 && (
                    <span className="flex flex-wrap gap-1 sm:hidden" aria-hidden="true">
                      {list.slice(0, 4).map((it) => (
                        <span key={it.id} className="h-2 w-2 rounded-full" style={{ background: it.levelColor ?? "#1f5c4a" }} />
                      ))}
                    </span>
                  )}
                </button>
                {/* Larger screens: the sessions themselves. */}
                <ul className="mt-1 hidden space-y-1 sm:block">
                  {list.slice(0, 3).map((it) => (
                    <li key={it.id}>
                      <Link
                        href={`${hrefBase}${it.id}`}
                        className={`block truncate rounded-[6px] border-l-4 px-1.5 py-0.5 text-[0.72rem] font-semibold leading-tight ${TONE[it.tone]}`}
                        style={{ borderLeftColor: it.levelColor ?? "#1f5c4a" }}
                        title={`${it.time} ${it.levelName ?? it.title} — ${it.status}`}
                      >
                        <span className="num">{it.time.slice(0, 5)}</span> {it.levelName ?? it.title}
                      </Link>
                    </li>
                  ))}
                  {list.length > 3 && (
                    <li>
                      <button type="button" className="text-[0.72rem] font-semibold text-court" onClick={() => setSelected(k)}>
                        +{list.length - 3} flere
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <section aria-labelledby="cal-day-h" className="mt-6">
        <h3 id="cal-day-h" className="mb-3 text-lg font-semibold">{cap(longDayFmt.format(parse(selected)))}</h3>
        {selectedItems.length === 0 ? (
          <p className="text-sm text-muted">Ingen træninger denne dag.</p>
        ) : (
          <ul className="space-y-2">
            {selectedItems.map((it) => (
              <li key={it.id}>
                <Link href={`${hrefBase}${it.id}`} className="panel flex items-center gap-3 p-3 hover:border-court">
                  <span aria-hidden="true" className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: it.levelColor ?? "#1f5c4a" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{it.title}</span>
                    <span className="block text-sm text-muted">
                      <span className="num">{it.time}</span>, {it.location}
                      {it.levelName ? ` · ${it.levelName}` : ""}
                      {it.meta ? ` · ${it.meta}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2.5 py-1 text-[0.75rem] font-semibold leading-none ${TONE[it.tone]}`}>{it.status}</span>
                    {it.isDemo && <span className="rounded-full bg-alert-soft px-2 py-0.5 text-[0.7rem] font-semibold text-alert">TEST</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
