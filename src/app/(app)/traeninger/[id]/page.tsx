import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingActions } from "@/components/booking-actions";
import { Chip, StatusChip } from "@/components/status-chip";
import { isDomainError } from "@/lib/errors";
import { formatBand, formatDate, formatDateTime, formatRating, formatTimeRange, pluralPlaces, ruleRangeLabel } from "@/lib/format";
import { requireUser, toActor } from "@/server/current-user";
import { getSessionForMember } from "@/server/sessions";
import { getSettings } from "@/server/settings";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = toActor(await requireUser());
  let v;
  try {
    v = await getSessionForMember(actor, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const settings = await getSettings();
  const s = v.session;
  const a = v.availability;
  const fill = Math.min(100, (v.held / s.capacity) * 100);

  const explanation: Record<string, string> = {
    AVAILABLE: v.rule.kind === "RATING" ? "Din verificerede rating opfylder kravet, og der er ledige pladser." : "Du kan tilmelde dig, og der er ledige pladser.",
    FULL_WAITLIST: "Du opfylder kravet, men træningen er fuld. Skriv dig på ventelisten, så tilbyder vi dig en plads, hvis en bliver ledig.",
    LOCKED_LOW: a.code === "LOCKED_LOW" ? `Træningen kræver mindst ${formatRating(a.min)}. Din rating er ${formatRating(a.rating)}, så du mangler ${formatRating(a.min - a.rating)}.` : "",
    LOCKED_HIGH: a.code === "LOCKED_HIGH" ? `Træningen er for ratings ${formatBand(a.min, a.max, a.exclusive)}. Din rating er ${formatRating(a.rating)}, så din adgang er flyttet til et højere niveau.` : "",
    NOT_ON_ROSTER: "Holdet har en fast deltagerliste efter alder og færdigheder. Kontakt træneren, hvis du (eller dit barn) skal på holdet.",
    DUPR_NEEDED: "Kampene registreres i DUPR, så du skal have koblet din DUPR-profil til for at tilmelde dig.",
    VERIFY_NEEDED: "Du skal have en verificeret og opdateret DUPR-rating for at booke. Kobl eller synkronisér DUPR på din profil.",
    BOOKED: a.code === "BOOKED" && a.flagged ? "Du er booket. Din rating ligger nu uden for træningens niveau; din plads er bevaret, og træneren er orienteret." : "Du er booket. Vi ses på banen!",
    OFFERED: a.code === "OFFERED" ? `En plads er blevet ledig til dig. Accepter senest ${formatDateTime(a.expiresAt)}, ellers går den videre.` : "",
    WAITLISTED: a.code === "WAITLISTED" ? `Du er nr. ${a.position} på ventelisten. Vi giver besked, hvis der bliver en plads til dig.` : "",
    NOT_OPEN: a.code === "NOT_OPEN" ? `Bookingen åbner ${formatDateTime(a.opensAt)}.` : "",
    CLOSED: "Bookingen er lukket.",
    CANCELLED: s.cancelReason ? `Træningen er aflyst. Årsag: ${s.cancelReason}` : "Træningen er aflyst.",
    PAST: "Træningen er afholdt.",
  };

  return (
    <article className="mx-auto max-w-3xl">
      <Link href="/traeninger" className="link text-sm">Tilbage til træninger</Link>
      <header className="mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusChip availability={a} />
          {s.isDemo && <Chip tone="alert">TEST</Chip>}
          {v.levelName && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: v.levelColor ?? "#1f5c4a" }} />
              {v.levelName}
            </span>
          )}
        </div>
        <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-bold">{s.title}</h1>
        {s.focus && <p className="mt-1 text-lg text-muted">Fokus: {s.focus}</p>}
      </header>

      <section className="panel mt-6 p-5 sm:p-6" aria-label="Booking">
        <p className="max-w-[60ch]">{explanation[a.code]}</p>
        <div className="mt-4">
          <BookingActions sessionId={s.id} code={a.code} />
          {(a.code === "BOOKED" || a.code === "OFFERED" || a.code === "WAITLISTED") && (
            <a href={`/api/traeninger/${s.id}/kalender`} className="link mt-3 inline-block text-sm" download>
              Tilføj til kalender
            </a>
          )}
        </div>
        {a.code !== "CANCELLED" && a.code !== "PAST" && (
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-sm">
              <span>{v.remaining > 0 ? `${pluralPlaces(v.remaining)} ledige af ${s.capacity}` : `Fuld (${s.capacity} pladser)`}</span>
              {v.waitlistCount > 0 && <span className="text-muted">{v.waitlistCount} på venteliste</span>}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-court-soft" role="progressbar" aria-label="Pladser booket" aria-valuemin={0} aria-valuemax={s.capacity} aria-valuenow={v.held}>
              <div className="h-full rounded-full bg-court" style={{ width: `${fill}%` }} />
            </div>
          </div>
        )}
      </section>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="panel p-4">
          <dt className="text-sm text-muted">Tidspunkt</dt>
          <dd className="font-semibold">{formatDate(s.startsAt)}</dd>
          <dd>kl. {formatTimeRange(s.startsAt, s.endsAt)}</dd>
        </div>
        <div className="panel p-4">
          <dt className="text-sm text-muted">Sted</dt>
          <dd className="font-semibold">{s.locationName}</dd>
          {s.address && <dd>{s.address}</dd>}
          {s.mapUrl && (
            <dd>
              <a href={s.mapUrl} className="link text-sm" target="_blank" rel="noopener noreferrer">Åbn kort</a>
            </dd>
          )}
        </div>
        <div className="panel p-4">
          <dt className="text-sm text-muted">{v.rule.kind === "RATING" ? `Ratingkrav (${settings.ratingType === "DOUBLES" ? "double" : "single"})` : "Adgang"}</dt>
          <dd className="num text-lg font-semibold">{ruleRangeLabel(v.rule)}</dd>
        </div>
        <div className="panel p-4">
          <dt className="text-sm text-muted">Booking</dt>
          <dd>{s.bookingOpensAt ? `Åbner ${formatDateTime(s.bookingOpensAt)}` : "Åben nu"}</dd>
          <dd>Lukker {formatDateTime(s.bookingClosesAt ?? s.startsAt)}</dd>
          <dd className="text-sm text-muted">Afmelding senest {settings.cancellationCutoffHours} timer før start.</dd>
        </div>
      </dl>

      {s.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-xl font-bold">Om træningen</h2>
          <p className="max-w-[65ch] whitespace-pre-line">{s.description}</p>
        </section>
      )}
    </article>
  );
}
