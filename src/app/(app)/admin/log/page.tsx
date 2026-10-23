import { PageHeader } from "@/components/app-shell";
import { formatDateTime } from "@/lib/format";
import { listAudit } from "@/server/admin";
import { requireAdminUser, toActor } from "@/server/current-user";

export const metadata = { title: "Log — admin" };

export default async function AuditPage() {
  const rows = await listAudit(toActor(await requireAdminUser()));
  return (
    <>
      <PageHeader title="Handlingslog" intro="Væsentlige handlinger foretaget af administratorer, medlemmer og systemet." />
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr><th className="px-4 py-2 font-medium">Tid</th><th className="px-4 py-2 font-medium">Hvem</th><th className="px-4 py-2 font-medium">Handling</th><th className="px-4 py-2 font-medium">Mål</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ e, actorName }) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2">{formatDateTime(e.createdAt)}</td>
                <td className="px-4 py-2">{actorName ?? "System"}</td>
                <td className="px-4 py-2 font-medium">{e.action}</td>
                <td className="px-4 py-2 text-muted">{e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8) ?? ""}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
