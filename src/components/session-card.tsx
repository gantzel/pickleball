import Link from "next/link";
import { formatShortDate, formatTimeRange, pluralPlaces, ruleRangeLabel } from "@/lib/format";
import type { MemberSessionView } from "@/server/sessions";
import { BookingActions } from "./booking-actions";
import { ProgrammeCover } from "./programme-cover";
import { StatusChip } from "./status-chip";

/** Picture card for a session: cover, access badge, time, places and the booking button. */
export function SessionCard({ v }: { v: MemberSessionView }) {
  const s = v.session;
  const a = v.availability;
  const badge = v.rule.kind === "RATING" ? `DUPR ${ruleRangeLabel(v.rule)}` : ruleRangeLabel(v.rule);
  return (
    <li className="panel flex flex-col overflow-hidden p-0">
      <Link href={`/traeninger/${s.id}`} className="relative block" tabIndex={-1} aria-hidden="true">
        <ProgrammeCover imageKey={v.levelImageKey} color={v.levelColor} />
        <span className="num absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1 text-[0.8rem] font-semibold text-ink shadow-sm">{badge}</span>
        {s.isDemo && <span className="absolute right-3 top-3 rounded-full bg-alert-soft px-2 py-0.5 text-[0.7rem] font-semibold text-alert">TEST</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <Link href={`/traeninger/${s.id}`} className="text-lg font-bold leading-snug hover:underline">{s.title}</Link>
        <p className="text-sm text-muted">
          {v.levelName ? `${v.levelName} · ` : ""}
          {s.locationName}
        </p>
        <p className="flex items-center gap-2 text-sm">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-muted">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {formatShortDate(s.startsAt)} {formatTimeRange(s.startsAt, s.endsAt)}
        </p>
        <p className="flex items-center gap-2 text-sm">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-muted">
            <circle cx="8" cy="5.5" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2.5 14c.6-2.8 2.8-4.3 5.5-4.3s4.9 1.5 5.5 4.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {v.remaining > 0 ? `${pluralPlaces(v.remaining)} tilbage` : `Fuld${v.waitlistCount ? `, ${v.waitlistCount} på venteliste` : ""}`}
        </p>
        <div className="mt-auto pt-3">
          {["AVAILABLE", "FULL_WAITLIST", "OFFERED", "WAITLISTED", "BOOKED"].includes(a.code) ? (
            <BookingActions sessionId={s.id} code={a.code} full />
          ) : (
            <StatusChip availability={a} />
          )}
        </div>
      </div>
    </li>
  );
}
