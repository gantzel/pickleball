import Link from "next/link";
import { formatTimeRange, pluralPlaces, ruleRangeLabel } from "@/lib/format";
import type { MemberSessionView } from "@/server/sessions";
import { BookingActions } from "./booking-actions";
import { StatusChip } from "./status-chip";

const dayFmt = new Intl.DateTimeFormat("da-DK", { day: "numeric", timeZone: "Europe/Copenhagen" });
const monFmt = new Intl.DateTimeFormat("da-DK", { month: "short", timeZone: "Europe/Copenhagen" });
const wdFmt = new Intl.DateTimeFormat("da-DK", { weekday: "short", timeZone: "Europe/Copenhagen" });

function explain(v: MemberSessionView): string | null {
  const a = v.availability;
  if (a.code === "LOCKED_LOW") return "Åbner automatisk, når din verificerede rating når grænsen.";
  if (a.code === "LOCKED_HIGH") return "Din rating er over holdets niveau — se træningerne på dit nye niveau.";
  if (a.code === "VERIFY_NEEDED") return "Kobl eller synkronisér DUPR på din profil.";
  if (a.code === "DUPR_NEEDED") return "Kobl din DUPR-profil til, så dine kampe kan registreres.";
  if (a.code === "NOT_ON_ROSTER") return "Holdet har en fast deltagerliste. Kontakt træneren.";
  if (a.code === "OFFERED") return "Accepter inden fristen, ellers går pladsen videre.";
  return null;
}

/** One fixture-list row: date block, details, status and the relevant action. */
export function SessionRow({ v, showActions = true }: { v: MemberSessionView; showActions?: boolean }) {
  const s = v.session;
  const a = v.availability;
  const actionable = ["AVAILABLE", "FULL_WAITLIST", "OFFERED", "WAITLISTED", "BOOKED"].includes(a.code);
  const note = explain(v);
  return (
    <li className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5">
      <Link href={`/traeninger/${s.id}`} className="flex min-w-0 flex-1 items-start gap-4 rounded-md">
        <div className="flex w-14 shrink-0 flex-col items-center rounded-[10px] border border-line bg-paper py-1.5 text-center">
          <span className="text-[0.72rem] font-semibold capitalize text-muted">{wdFmt.format(s.startsAt).replace(".", "")}</span>
          <span className="num text-2xl font-bold leading-none">{dayFmt.format(s.startsAt).replace(".", "")}</span>
          <span className="text-[0.72rem] capitalize text-muted">{monFmt.format(s.startsAt).replace(".", "")}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <StatusChip availability={a} />
            {v.levelName && (
              <span className="inline-flex items-center gap-1.5 text-[0.8rem] font-medium text-muted">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: v.levelColor ?? "#1f5c4a" }} />
                {v.levelName}
              </span>
            )}
          </div>
          <h3 className="truncate text-lg font-semibold">{s.title}</h3>
          <p className="text-sm text-muted">
            {formatTimeRange(s.startsAt, s.endsAt)}, {s.locationName}
          </p>
          <p className="text-sm text-muted">
            {v.rule.kind === "RATING" ? `Rating ${ruleRangeLabel(v.rule)}` : ruleRangeLabel(v.rule)}
            {a.code !== "CANCELLED" && a.code !== "PAST" && (
              <>
                {", "}
                {v.remaining > 0 ? `${pluralPlaces(v.remaining)} ledige` : v.waitlistCount > 0 ? `${v.waitlistCount} på venteliste` : "fuldt booket"}
              </>
            )}
          </p>
          {note && <p className="mt-1 text-sm text-ink/80">{note}</p>}
        </div>
      </Link>
      {showActions && actionable && (
        <div className="sm:w-auto sm:shrink-0">
          <BookingActions sessionId={s.id} code={a.code} />
        </div>
      )}
    </li>
  );
}
