import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { SessionCalendar, type CalendarItem } from "@/components/session-calendar";
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

const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });

export default async function AdminSessions({ searchParams }: { searchParams: Promise<{ vis?: string; visning?: string }> }) {
  const { vis, visning } = await searchParams;
  // Calendar is the default view; the list has its own URL.
  const calendar = visning !== "liste";
  const tab = TABS.find((t) => t.key === vis) ?? TABS[0];
  const actor = toActor(await requireAdminUser());
  const rows = await listSessionsAdmin(actor, { scope: calendar ? "calendar" : tab.key });
  const testCount = await countTestSessions();
  const today = dayKey.format(new Date());

  // Admin calendar: every session (drafts and cancelled too), linking to the admin page.
  const items: CalendarItem[] = rows.map((r) => {
    const st = STATUS[r.session.status];
    const held = r.confirmed + r.offered;
    return {
      id: r.session.id,
      title: r.session.title,
      day: dayKey.format(r.session.startsAt),
      time: formatTimeRange(r.session.startsAt, r.session.endsAt),
      location: r.session.locationName,
      levelName: r.levelName,
      levelColor: r.levelColor,
      status: r.session.status === "PUBLISHED" && held >= r.session.capacity ? "Fuld" : st.label,
      tone: r.session.status === "PUBLISHED" && held >= r.session.capacity ? "wait" : st.tone,
      isDemo: r.session.isDemo,
      meta: `${held}/${r.session.capacity} booket${r.waitlisted ? `, ${r.waitlisted} venter` : ""}`,
    };
  });
  const firstMonth = items[0]?.day.slice(0, 7);

  const viewToggle = (
    <div role="group" aria-label="Visning" className="inline-flex self-start rounded-full border border-line bg-surface p-1">
      {[
        { label: "Liste", href: "/admin/traeninger?visning=liste", on: !calendar },
        { label: "Kalender", href: "/admin/traeninger", on: calendar },
      ].map((o) => (
        <Link
          key={o.label}
          href={o.href}
          aria-current={o.on ? "page" : undefined}
          className="inline-flex min-h-[36px] items-center rounded-full px-4 text-sm font-semibold text-muted aria-[current=page]:bg-court aria-[current=page]:text-white"
        >
          {o.label}
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Træninger"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {viewToggle}
            <Link href="/admin/traeninger/ny" className="btn btn-primary">Ny træning</Link>
          </div>
        }
      />
      <TestSessionsPanel count={testCount} />
      {calendar ? (
        <SessionCalendar items={items} today={today} hrefBase="/admin/traeninger/" minMonth={firstMonth && firstMonth < today.slice(0, 7) ? firstMonth : undefined} />
      ) : (
      <>
      <nav aria-label="Vis" className="mb-5 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/traeninger?visning=liste&vis=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined} className="inline-flex min-h-[40px] items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold aria-[current=page]:border-court aria-[current=page]:bg-court aria-[current=page]:text-white">
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
      )}
    </>
  );
}
