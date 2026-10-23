import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { RatingStateChip } from "@/components/rating-state-chip";
import { Chip } from "@/components/status-chip";
import { formatRelative } from "@/lib/format";
import { searchMembers } from "@/server/admin";
import { requireAdminUser, toActor } from "@/server/current-user";

export const metadata = { title: "Medlemmer — admin" };

export default async function Members({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const rows = await searchMembers(toActor(await requireAdminUser()), q);
  return (
    <>
      <PageHeader title="Medlemmer" />
      <form role="search" className="mb-5 flex max-w-lg gap-2">
        <label htmlFor="q" className="sr-only">Søg efter navn, e-mail eller DUPR-ID</label>
        <input id="q" name="q" defaultValue={q} placeholder="Navn, e-mail eller DUPR-ID" className="field" />
        <button className="btn btn-secondary">Søg</button>
      </form>
      <ul className="panel divide-y divide-line">
        {rows.map((m) => (
          <li key={m.id}>
            <Link href={`/admin/medlemmer/${m.id}`} className="flex flex-col gap-2 p-3 hover:bg-paper sm:flex-row sm:items-center sm:justify-between">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={m.name} avatarKey={m.avatarKey} size={36} />
                <span className="min-w-0">
                  <span className="block font-semibold">{m.name} {m.role === "ADMIN" && <Chip tone="mine">Admin</Chip>}</span>
                  <span className="block truncate text-sm text-muted">{m.email}</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <RatingStateChip state={m.ratingState} />
                {m.link?.lastSuccessfulSyncAt && <span>synk {formatRelative(m.link.lastSuccessfulSyncAt)}</span>}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="p-4 text-muted">Ingen medlemmer fundet.</li>}
      </ul>
    </>
  );
}
