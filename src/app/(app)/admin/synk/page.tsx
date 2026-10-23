import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Chip } from "@/components/status-chip";
import { formatDateTime, formatRating } from "@/lib/format";
import { listSyncProblems } from "@/server/admin";
import { requireAdminUser, toActor } from "@/server/current-user";
import { integrationStatus } from "@/server/dupr/provider";
import { RetryButton } from "../controls";

export const metadata = { title: "DUPR-synk — admin" };

export default async function SyncPage() {
  const data = await listSyncProblems(toActor(await requireAdminUser()));
  const integ = integrationStatus();
  return (
    <>
      <PageHeader title="DUPR-synkronisering" intro="Ratings hentes automatisk. Her ser du forbindelser med problemer og alle seneste forsøg." />
      <section className="panel mb-8 p-5">
        <h2 className="text-lg font-bold">Integration</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">Konfigureret udbyder</dt><dd className="font-semibold">{integ.configured}</dd></div>
          <div><dt className="text-muted">Aktiv</dt><dd className="font-semibold">{integ.active ? integ.label : "Ingen"}</dd></div>
          <div><dt className="text-muted">Officiel DUPR-integration</dt><dd className="font-semibold">{integ.liveReady ? "Klar" : "Ikke aktiveret (afventer partneradgang)"}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-muted">Fejlede forsøg i det seneste døgn: <span className="num font-semibold text-ink">{data.failed24h}</span></p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-bold">Forbindelser med problemer</h2>
        <ul className="panel divide-y divide-line">
          {data.links.map(({ link, name }) => (
            <li key={link.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Link href={`/admin/medlemmer/${link.userId}`} className="font-semibold hover:underline">{name}</Link>
                <p className="text-sm text-muted">
                  {link.status === "REVOKED" ? "Adgang tilbagekaldt; medlemmet skal koble til igen." : `${link.consecutiveFailures} fejl i træk.`} Senest forsøgt {link.lastSyncAttemptAt ? formatDateTime(link.lastSyncAttemptAt) : "aldrig"}.
                </p>
              </div>
              {link.status === "ERROR" ? <RetryButton linkId={link.id} /> : <Chip tone="alert">Tilbagekaldt</Chip>}
            </li>
          ))}
          {data.links.length === 0 && <li className="p-4 text-muted">Ingen problemer lige nu.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Seneste forsøg</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr><th className="px-4 py-2 font-medium">Tid</th><th className="px-4 py-2 font-medium">Medlem</th><th className="px-4 py-2 font-medium">Udløser</th><th className="px-4 py-2 font-medium">Resultat</th><th className="px-4 py-2 font-medium">Double</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.logs.map(({ log, name }) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-4 py-2">{formatDateTime(log.createdAt)}</td>
                  <td className="px-4 py-2">{name ?? "–"}</td>
                  <td className="px-4 py-2">{log.trigger}</td>
                  <td className={`px-4 py-2 ${["FAILED", "REVOKED", "RATE_LIMITED"].includes(log.result) ? "text-alert" : ""}`}>{log.result}</td>
                  <td className="num px-4 py-2">{log.newDoubles !== null ? formatRating(log.newDoubles) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
