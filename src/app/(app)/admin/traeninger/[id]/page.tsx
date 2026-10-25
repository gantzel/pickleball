import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { RatingStateChip } from "@/components/rating-state-chip";
import { Chip } from "@/components/status-chip";
import { isDomainError } from "@/lib/errors";
import { formatDate, formatDateTime, formatTimeRange } from "@/lib/format";
import { toLocalInput } from "@/lib/local-input";
import { listLevels } from "@/server/admin";
import { requireAdminUser, toActor } from "@/server/current-user";
import { getSessionAdmin } from "@/server/sessions";
import { ParticipantActions, SessionCommands, SessionForm } from "../../controls";

const BOOKING_LABEL: Record<string, { label: string; tone: "go" | "wait" | "mine" | "quiet" | "alert" }> = {
  CONFIRMED: { label: "Bekræftet", tone: "go" },
  OFFERED: { label: "Plads tilbudt", tone: "mine" },
  WAITLISTED: { label: "Venteliste", tone: "wait" },
  CANCELLED: { label: "Afmeldt", tone: "quiet" },
  EXPIRED: { label: "Udløbet", tone: "quiet" },
};

export default async function AdminSession({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ oprettet?: string; kopieret?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = toActor(await requireAdminUser());
  let data;
  try {
    data = await getSessionAdmin(actor, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const levels = await listLevels();
  const { session: s, participants, levelName, access } = data;
  const started = s.startsAt <= new Date();
  const editable = s.status === "DRAFT" || s.status === "PUBLISHED";
  const groups = [
    { key: "confirmed", title: "Deltagere", list: participants.filter((p) => p.booking.status === "CONFIRMED" || p.booking.status === "OFFERED") },
    { key: "waitlist", title: "Venteliste (i rækkefølge)", list: participants.filter((p) => p.booking.status === "WAITLISTED") },
    { key: "other", title: "Afmeldt og udløbet", list: participants.filter((p) => p.booking.status === "CANCELLED" || p.booking.status === "EXPIRED") },
  ];
  const held = groups[0].list.length;

  return (
    <div className="space-y-8">
      <Link href="/admin/traeninger" className="link text-sm">Alle træninger</Link>
      {sp.oprettet && <p role="status" className="rounded-[10px] bg-court-soft p-3 font-medium text-court">Træningen er oprettet.</p>}
      {sp.kopieret && <p role="status" className="rounded-[10px] bg-court-soft p-3 font-medium text-court">Kopien er gemt som kladde. Tjek dato og tid, før du offentliggør.</p>}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2"><Chip tone={s.status === "PUBLISHED" ? "go" : s.status === "CANCELLED" ? "alert" : "quiet"}>{{ PUBLISHED: "Offentlig", DRAFT: "Kladde", CANCELLED: "Aflyst", COMPLETED: "Afsluttet" }[s.status]}</Chip></div>
          <h1 className="text-3xl font-bold">{s.title}</h1>
          <p className="mt-1 text-muted">
            {formatDate(s.startsAt)}, {formatTimeRange(s.startsAt, s.endsAt)}, {s.locationName}
          </p>
          <p className="text-muted">{levelName ? `${levelName} — ${access}` : access}{s.isDemo ? " · TEST" : ""}, <span className="num">{held}/{s.capacity}</span> pladser booket</p>
          {s.status === "CANCELLED" && s.cancelReason && <p className="mt-1 text-alert">Årsag: {s.cancelReason}</p>}
        </div>
        <SessionCommands id={s.id} status={s.status} started={started} />
      </header>

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className="mb-3 text-xl font-bold">{g.title} <span className="num text-base font-medium text-muted">({g.list.length})</span></h2>
          {g.list.length === 0 ? (
            <p className="text-sm text-muted">Ingen.</p>
          ) : (
            <ul className="panel divide-y divide-line">
              {g.list.map((p, i) => {
                const lab = BOOKING_LABEL[p.booking.status];
                return (
                  <li key={p.booking.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      {g.key === "waitlist" && <span className="num w-6 text-right font-semibold text-muted">{i + 1}.</span>}
                      <Avatar name={p.child?.name ?? p.user.name} avatarKey={p.child ? null : p.user.avatarKey} size={36} />
                      <div className="min-w-0">
                        {p.child ? (
                          <p className="font-semibold">
                            {p.child.name}{" "}
                            <span className="text-sm font-normal text-muted">
                              · forælder: <Link href={`/admin/medlemmer/${p.user.id}`} className="hover:underline">{p.user.name}</Link>
                            </span>
                          </p>
                        ) : (
                          <Link href={`/admin/medlemmer/${p.user.id}`} className="font-semibold hover:underline">{p.user.name}</Link>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {p.child ? <Chip tone="mine">Barn</Chip> : <RatingStateChip state={p.ratingState} />}
                          <Chip tone={lab.tone}>{lab.label}</Chip>
                          {p.booking.flag === "RATING_OUT_OF_RANGE" && <Chip tone="wait">Rating uden for niveau</Chip>}
                          {p.booking.status === "OFFERED" && p.booking.offerExpiresAt && <span className="text-xs text-muted">svarfrist {formatDateTime(p.booking.offerExpiresAt)}</span>}
                        </div>
                      </div>
                    </div>
                    <ParticipantActions bookingId={p.booking.id} status={p.booking.status} attendance={p.booking.attendance} canMarkAttendance={started} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {editable && (
        <section aria-labelledby="edit-h" className="panel p-5 sm:p-6">
          <h2 id="edit-h" className="mb-4 text-xl font-bold">Redigér</h2>
          <SessionForm
            isDraft={s.status === "DRAFT"}
            levels={levels.map((l) => ({ id: l.id, name: l.name, kind: l.kind, minRating: l.minRating, maxRating: l.maxRating }))}
            values={{
              id: s.id,
              title: s.title,
              description: s.description,
              focus: s.focus,
              levelId: s.levelId,
              startsAt: toLocalInput(s.startsAt),
              endsAt: toLocalInput(s.endsAt),
              locationName: s.locationName,
              address: s.address,
              mapUrl: s.mapUrl,
              minRating: s.minRating,
              maxRating: s.maxRating,
              capacity: s.capacity,
              bookingOpensAt: toLocalInput(s.bookingOpensAt),
              bookingClosesAt: toLocalInput(s.bookingClosesAt),
            }}
          />
          <p className="mt-4 text-sm text-muted">Ændres ratinggrænserne, bliver eksisterende bookinger ikke annulleret; deltagere uden for de nye grænser markeres.</p>
        </section>
      )}
    </div>
  );
}
