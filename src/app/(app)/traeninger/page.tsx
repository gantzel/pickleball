import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SessionRow } from "@/components/session-row";
import { formatDate } from "@/lib/format";
import { requireUser, toActor } from "@/server/current-user";
import type { MemberSessionView } from "@/server/sessions";
import { listUpcomingForMember } from "@/server/sessions";

export const metadata = { title: "Træninger" };

const FILTERS = [
  { key: "alle", label: "Alle", test: () => true },
  { key: "kan-bookes", label: "Kan bookes", test: (v: MemberSessionView) => ["AVAILABLE", "FULL_WAITLIST", "OFFERED"].includes(v.availability.code) },
  { key: "mine", label: "Mine", test: (v: MemberSessionView) => ["BOOKED", "WAITLISTED", "OFFERED"].includes(v.availability.code) },
  { key: "laast", label: "Låst", test: (v: MemberSessionView) => ["LOCKED_LOW", "LOCKED_HIGH", "VERIFY_NEEDED"].includes(v.availability.code) },
] as const;

const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ vis?: string }> }) {
  const { vis } = await searchParams;
  const active = FILTERS.find((f) => f.key === vis) ?? FILTERS[0];
  const all = await listUpcomingForMember(toActor(await requireUser()));
  const views = all.filter(active.test);

  const groups = new Map<string, MemberSessionView[]>();
  for (const v of views) {
    const k = dayKey.format(v.session.startsAt);
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }

  return (
    <>
      <PageHeader title="Træninger" intro="Alle kommende træninger. Status viser, om din verificerede rating giver adgang, og om der er plads." />
      <nav aria-label="Filtrér træninger" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const n = all.filter(f.test).length;
          return (
            <Link
              key={f.key}
              href={f.key === "alle" ? "/traeninger" : `/traeninger?vis=${f.key}`}
              aria-current={f.key === active.key ? "page" : undefined}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold aria-[current=page]:border-court aria-[current=page]:bg-court aria-[current=page]:text-white"
            >
              {f.label}
              <span className="num opacity-70">{n}</span>
            </Link>
          );
        })}
      </nav>
      {views.length === 0 ? (
        <EmptyState title="Ingen træninger her">
          {active.key === "mine" ? "Du har ingen kommende bookinger." : active.key === "kan-bookes" ? "Der er ingen åbne træninger på dit niveau lige nu." : "Der er ikke lagt træninger ud endnu."}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([k, list]) => (
            <section key={k} aria-labelledby={`d-${k}`}>
              <h2 id={`d-${k}`} className="mb-3 text-lg font-semibold">{formatDate(list[0].session.startsAt)}</h2>
              <ul className="space-y-3">
                {list.map((v) => (
                  <SessionRow key={v.session.id} v={v} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
