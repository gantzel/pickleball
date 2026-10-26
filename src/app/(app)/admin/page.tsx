import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Chip } from "@/components/status-chip";
import { formatShortDate, formatTime } from "@/lib/format";
import { requireAdminUser, toActor } from "@/server/current-user";
import { integrationStatus } from "@/server/dupr/provider";
import { membershipCounts } from "@/server/admin";
import { adminMetrics, listSessionsAdmin } from "@/server/sessions";

export const metadata = { title: "Admin" };

export default async function AdminHome() {
  const actor = toActor(await requireAdminUser());
  const [m, upcoming, members] = await Promise.all([adminMetrics(actor), listSessionsAdmin(actor, { scope: "upcoming" }), membershipCounts(actor)]);
  const integ = integrationStatus();
  const fill = m.capacity ? Math.round(((m.confirmed + m.offered) / m.capacity) * 100) : 0;
  const stats = [
    { label: "Træninger de næste 14 dage", value: m.upcomingSessions },
    { label: "Pladser booket", value: `${m.confirmed} / ${m.capacity}`, sub: `${fill}% fyldt` },
    { label: "På venteliste", value: m.waitlisted, sub: m.offered ? `${m.offered} tilbud afventer svar` : undefined },
    { label: "Markerede bookinger", value: m.flagged, sub: "Rating uden for niveau", href: m.flagged ? "/admin/traeninger?visning=liste" : undefined },
    { label: "Medlemmer", value: m.members, sub: members.pending ? `${members.pending} afventer godkendelse` : members.lapsed ? `${members.lapsed} med udløbet kontingent` : "Ingen afventer godkendelse", href: members.pending ? "/admin/medlemmer?vis=afventer" : members.lapsed ? "/admin/medlemmer?vis=udloebet" : "/admin/medlemmer" },
    { label: "DUPR-forbindelser", value: m.linksActive, sub: m.linksError || m.linksRevoked ? `${m.linksError} med fejl, ${m.linksRevoked} tilbagekaldt` : "Ingen fejl", href: "/admin/synk" },
  ];
  return (
    <>
      <PageHeader title="Overblik" actions={<Link href="/admin/traeninger/ny" className="btn btn-primary">Ny træning</Link>} />
      {!integ.active ? (
        <p role="alert" className="mb-6 rounded-[12px] bg-alert-soft p-4 text-sm font-medium text-alert">DUPR-integrationen er ikke aktiv. Medlemmer kan ikke få verificeret deres rating. Se README for, hvad der kræves.</p>
      ) : integ.isMock ? (
        <p className="mb-6 rounded-[12px] bg-ball-soft p-4 text-sm font-medium">Kører med test-udbyderen (mock). Ratings er ikke ægte DUPR-data.</p>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => {
          const body = (
            <>
              <dt className="text-sm text-muted">{s.label}</dt>
              <dd className="num mt-1 text-3xl font-bold">{s.value}</dd>
              {s.sub && <dd className="text-sm text-muted">{s.sub}</dd>}
            </>
          );
          return <div key={s.label} className="panel p-4">{s.href ? <Link href={s.href} className="block">{body}</Link> : body}</div>;
        })}
      </dl>
      <section className="mt-10">
        <h2 className="mb-3 text-xl font-bold">Kommende træninger</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Træning</th>
                <th className="px-4 py-3 font-medium">Tid</th>
                <th className="px-4 py-3 font-medium">Booket</th>
                <th className="px-4 py-3 font-medium">Venteliste</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {upcoming.slice(0, 12).map((r) => (
                <tr key={r.session.id}>
                  <td className="px-4 py-3"><Link href={`/admin/traeninger/${r.session.id}`} className="font-semibold hover:underline">{r.session.title}</Link></td>
                  <td className="px-4 py-3">{formatShortDate(r.session.startsAt)} {formatTime(r.session.startsAt)}</td>
                  <td className="num px-4 py-3">{r.confirmed + r.offered} / {r.session.capacity}</td>
                  <td className="num px-4 py-3">{r.waitlisted}</td>
                  <td className="px-4 py-3">
                    {r.session.status === "CANCELLED" ? <Chip tone="alert">Aflyst</Chip> : r.flagged ? <Chip tone="wait">{r.flagged} markeret</Chip> : <Chip tone="go">Offentlig</Chip>}
                  </td>
                </tr>
              ))}
              {upcoming.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Ingen kommende træninger. <Link href="/admin/traeninger/ny" className="link">Opret den første</Link>.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
