import { PageHeader } from "@/components/app-shell";
import { toLocalInput } from "@/lib/local-input";
import { listLevels } from "@/server/admin";
import { requireAdminUser } from "@/server/current-user";
import { SessionForm } from "../../controls";

export const metadata = { title: "Ny træning" };

export default async function NewSession() {
  await requireAdminUser();
  const levels = await listLevels();
  const start = new Date(Date.now() + 7 * 86400_000);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(16);
  const end = new Date(start.getTime() + 90 * 60_000);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Ny træning" />
      <div className="panel p-5 sm:p-6">
        <SessionForm isDraft values={{ startsAt: toLocalInput(start), endsAt: toLocalInput(end), capacity: 16 }} levels={levels.map((l) => ({ id: l.id, name: l.name, kind: l.kind, minRating: l.minRating, maxRating: l.maxRating }))} />
      </div>
    </div>
  );
}
