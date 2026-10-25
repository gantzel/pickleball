import type { Availability } from "@/server/eligibility";
import { formatRating, formatShortDate, formatTime } from "@/lib/format";

type Tone = "go" | "wait" | "lock" | "alert" | "mine" | "quiet";

const TONES: Record<Tone, string> = {
  go: "bg-court text-white",
  wait: "bg-wait-soft text-wait",
  lock: "bg-lock-soft text-lock",
  alert: "bg-alert-soft text-alert",
  mine: "bg-ball text-ink",
  quiet: "bg-paper text-muted border border-line",
};

export function availabilityLabel(a: Availability): { label: string; tone: Tone } {
  switch (a.code) {
    case "AVAILABLE":
      return { label: "Kan bookes", tone: "go" };
    case "FULL_WAITLIST":
      return { label: "Fuld, venteliste åben", tone: "wait" };
    case "LOCKED_LOW":
      return { label: `Kræver ${formatRating(a.min)}`, tone: "lock" };
    case "LOCKED_HIGH":
      return { label: a.exclusive ? `For ratings under ${formatRating(a.max)}` : `For ratings op til ${formatRating(a.max)}`, tone: "lock" };
    case "NOT_ON_ROSTER":
      return { label: "Kun holdets deltagere", tone: "lock" };
    case "DUPR_NEEDED":
      return { label: "Kræver DUPR-profil", tone: "alert" };
    case "NOT_FOR_CHILDREN":
      return { label: "Ikke for børn", tone: "lock" };
    case "VERIFY_NEEDED":
      return { label: "Rating skal verificeres", tone: "alert" };
    case "BOOKED":
      return { label: a.flagged ? "Booket, uden for niveau" : "Booket", tone: "mine" };
    case "OFFERED":
      return { label: "Plads tilbudt til dig", tone: "mine" };
    case "WAITLISTED":
      return { label: `Venteliste nr. ${a.position}`, tone: "wait" };
    case "NOT_OPEN":
      return { label: `Åbner ${formatShortDate(a.opensAt).toLowerCase()} ${formatTime(a.opensAt)}`, tone: "quiet" };
    case "CLOSED":
      return { label: "Booking lukket", tone: "quiet" };
    case "CANCELLED":
      return { label: "Aflyst", tone: "alert" };
    case "PAST":
      return { label: "Afholdt", tone: "quiet" };
  }
}

export function StatusChip({ availability }: { availability: Availability }) {
  const { label, tone } = availabilityLabel(availability);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.8rem] font-semibold leading-none ${TONES[tone]}`}>
      {tone === "lock" && (
        <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true">
          <rect x="1" y="5" width="9" height="6.5" rx="1.5" fill="currentColor" />
          <path d="M3 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      {label}
    </span>
  );
}

export function Chip({ children, tone = "quiet" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[0.8rem] font-semibold leading-none ${TONES[tone]}`}>{children}</span>;
}
