import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { RatingStateChip } from "@/components/rating-state-chip";
import { isDomainError } from "@/lib/errors";
import { formatDateTime, formatRating } from "@/lib/format";
import { getMemberAdmin } from "@/server/admin";
import { requireAdminUser, toActor } from "@/server/current-user";
import { endOfHalfYear, membershipMessage } from "@/server/membership";
import { MembershipControl, RetryButton, RoleControl } from "../../controls";

export default async function Member({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAdminUser();
  let m;
  try {
    m = await getMemberAdmin(toActor(me), id);
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const l = m.link;
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/admin/medlemmer" className="link text-sm">Alle medlemmer</Link>
      <header className="flex items-center gap-4">
        <Avatar name={m.user.name} avatarKey={m.user.avatarKey} size={64} />
        <div>
          <h1 className="text-3xl font-bold">{m.user.name}</h1>
          <p className="text-muted">{m.user.email}{m.user.role === "ADMIN" ? ", administrator" : ""}</p>
        </div>
      </header>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4"><dt className="text-sm text-muted">Rating til adgang</dt><dd className="mt-1"><RatingStateChip state={m.ratingState} /></dd></div>
        <div className="panel p-4"><dt className="text-sm text-muted">Træninger deltaget</dt><dd className="num text-2xl font-bold">{m.attended}</dd></div>
        <div className="panel p-4"><dt className="text-sm text-muted">Aktive bookinger</dt><dd className="num text-2xl font-bold">{m.activeBookings}</dd></div>
      </dl>
      <section className="panel p-5" aria-labelledby="ms-h">
        <h2 id="ms-h" className="text-xl font-bold">Medlemskab</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          {m.user.role === "ADMIN" ? "Administratorer kan altid booke." : membershipMessage(m.membership)}
          {!m.user.emailVerified && " E-mailadressen er ikke bekræftet endnu."}
        </p>
        <MembershipControl userId={m.user.id} status={m.user.membershipStatus} paidThrough={m.user.paidThrough} suggestedPaidThrough={endOfHalfYear()} />
      </section>
      <section className="panel p-5">
        <h2 className="text-xl font-bold">DUPR</h2>
        {l ? (
          <>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">DUPR-ID</dt><dd className="num">{l.externalId} ({l.provider === "MOCK" ? "mock" : "DUPR"})</dd></div>
              <div><dt className="text-muted">Status</dt><dd>{{ ACTIVE: "Aktiv", ERROR: "Fejl ved seneste synk", REVOKED: "Tilbagekaldt" }[l.status]}</dd></div>
              <div><dt className="text-muted">Double / single</dt><dd className="num">{formatRating(l.doublesRating)} / {formatRating(l.singlesRating)}</dd></div>
              <div><dt className="text-muted">Senest synkroniseret</dt><dd>{l.lastSuccessfulSyncAt ? formatDateTime(l.lastSuccessfulSyncAt) : "Aldrig"}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-muted">Ratings kan kun hentes fra DUPR. De kan ikke redigeres her.</p>
            <div className="mt-3"><RetryButton linkId={l.id} /></div>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">Medlemmet har ikke koblet en DUPR-profil til.</p>
        )}
      </section>
      <section className="panel p-5">
        <h2 className="text-xl font-bold">Rolle</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          {m.user.role === "ADMIN" ? "Administrator: kan se alle medlemmer, ratings og deltagerlister og ændre træninger og regler." : "Medlem: kan kun se og ændre sine egne data."}
        </p>
        <RoleControl userId={m.user.id} role={m.user.role} isSelf={m.user.id === me.id} />
      </section>
      <section className="panel p-5">
        <h2 className="text-xl font-bold">Synkroniseringslog</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {m.logs.map((g) => (
            <li key={g.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{formatDateTime(g.createdAt)}, {g.trigger.toLowerCase()}</span>
              <span className={g.result === "FAILED" || g.result === "REVOKED" ? "text-alert" : "text-muted"}>
                {g.result}{g.newDoubles !== null && g.previousDoubles !== g.newDoubles ? ` ${formatRating(g.previousDoubles)} til ${formatRating(g.newDoubles)}` : ""}
              </span>
            </li>
          ))}
          {m.logs.length === 0 && <li className="py-2 text-muted">Ingen synkroniseringer.</li>}
        </ul>
      </section>
    </div>
  );
}
