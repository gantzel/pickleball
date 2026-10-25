import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Chip } from "@/components/status-chip";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireAdminUser, toActor } from "@/server/current-user";
import { countTestSessions } from "@/server/admin";
import { listSessionsAdmin } from "@/server/sessions";
import { TestSessionsPanel } from "../controls";

export const metadata = { title: "Træninger — admin" };

const TABS = [
  { key: "upcoming", label: "Kommende" },
  { key: "drafts", label: "Kladder" },
  { key: "past", label: "Tidligere" },
] as const;

const STATUS: Record<string, { label: string; tone: "go" | "alert" | "quiet" | "wait" }> = {
  PUBLISHED: { label: "Offentlig", tone: "go" },
  DRAFT: { label: "Kladde", tone: "quiet" },
  CANCELLED: { label: "Aflyst", tone: "alert" },
  COMPLETED: { label: "Afsluttet", tone: "quiet" },
};

export default async function AdminSessions({ searchParams }: { searchParams: Promise<{ vis?: string }> }) {
  const { vis } = await searchParams;
  const tab = TABS.find((t) => t.key === vis) ?? TABS[0];
  const rows = await listSessionsAdmin(toActor(await requireAdminUser()), { scope: tab.key });
  const testCount = await countTestSessions();
  return (
    <>
      <PageHeader title="Træninger" actions={<Link href="/admin/traeninger/ny" className="btn btn-primary">Ny træning</Link>} />
      <TestSessionsPanel count={testCount} />
      <nav aria-label="Vis" className="mb-5 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/traeninger?vis=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined} className="inline-flex min-h-[40px] items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold aria-[current=page]:border-court aria-[current=page]:bg-court aria-[current=page]:text-white">
            {t.label}
          </Link>
        ))}
      </nav>
      <ul className="space-y-2">
        {rows.map((r) => {
          const st = STATUS[r.session.status];
          return (
            <li key={r.session.id}>
              <Link href={`/admin/traeninger/${r.session.id}`} className="panel flex flex-col gap-2 p-4 hover:border-court sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{r.session.title}</p>
                  <p className="text-sm text-muted">
                    {formatShortDate(r.session.startsAt)}, {formatTimeRange(r.session.startsAt, r.session.endsAt)}, {r.session.locationName}, {r.levelName ? `${r.levelName} (${r.access})` : r.access}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="num">{r.confirmed + r.offered}/{r.session.capacity}</span>
                  {r.waitlisted > 0 && <Chip tone="wait">{r.waitlisted} venter</Chip>}
                  {r.flagged > 0 && <Chip tone="wait">{r.flagged} markeret</Chip>}
                  <Chip tone={st.tone}>{st.label}</Chip>
                </div>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-muted">Ingen træninger her.</li>}
      </ul>
    </>
  );
}
