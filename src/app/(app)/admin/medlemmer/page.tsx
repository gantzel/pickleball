import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { RatingStateChip } from "@/components/rating-state-chip";
import { Chip } from "@/components/status-chip";
import { formatRelative } from "@/lib/format";
import { membershipCounts, searchMembers, type MemberFilter } from "@/server/admin";
import { requireAdminUser, toActor } from "@/server/current-user";
import { endOfHalfYear } from "@/server/membership";
import { ApproveButton } from "../controls";

export const metadata = { title: "Medlemmer — admin" };

const TABS: { key: MemberFilter; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "afventer", label: "Afventer godkendelse" },
  { key: "aktive", label: "Aktive" },
  { key: "udloebet", label: "Kontingent udløbet" },
  { key: "afsluttet", label: "Afsluttet" },
];

const MEMBERSHIP_CHIP = {
  PENDING: { label: "Afventer", tone: "wait" },
  ACTIVE: { label: "Aktiv", tone: "go" },
  LAPSED: { label: "Kontingent udløbet", tone: "alert" },
  ENDED: { label: "Afsluttet", tone: "quiet" },
} as const;

const dateFmt = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function Members({ searchParams }: { searchParams: Promise<{ q?: string; vis?: string }> }) {
  const { q = "", vis } = await searchParams;
  const tab = TABS.find((t) => t.key === vis) ?? TABS[0];
  const actor = toActor(await requireAdminUser());
  const [rows, counts] = await Promise.all([searchMembers(actor, q, 200, tab.key), membershipCounts(actor)]);
  const suggested = endOfHalfYear();
  const href = (k: MemberFilter) => {
    const p = new URLSearchParams();
    if (k !== "alle") p.set("vis", k);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/admin/medlemmer?${s}` : "/admin/medlemmer";
  };
  return (
    <>
      <PageHeader title="Medlemmer" intro="Nye konti skal godkendes, før de kan booke. Godkend, når kontingentet er betalt." />
      <nav aria-label="Filtrér medlemmer" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const n = t.key === "afventer" ? counts.pending : t.key === "udloebet" ? counts.lapsed : null;
          return (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={t.key === tab.key ? "page" : undefined}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold aria-[current=page]:border-court aria-[current=page]:bg-court aria-[current=page]:text-white"
            >
              {t.label}
              {n ? <span className="num rounded-full bg-ball px-1.5 text-ink">{n}</span> : null}
            </Link>
          );
        })}
      </nav>
      <form role="search" className="mb-5 flex max-w-lg gap-2">
        {tab.key !== "alle" && <input type="hidden" name="vis" value={tab.key} />}
        <label htmlFor="q" className="sr-only">Søg efter navn, e-mail eller DUPR-ID</label>
        <input id="q" name="q" defaultValue={q} placeholder="Navn, e-mail eller DUPR-ID" className="field" />
        <button className="btn btn-secondary">Søg</button>
      </form>
      {tab.key === "afventer" && rows.length > 0 && (
        <p className="mb-3 text-sm text-muted">&quot;Godkend&quot; gør medlemmet aktivt med kontingent betalt til {dateFmt.format(new Date(`${suggested}T00:00:00Z`))}. Du kan ændre datoen på medlemmets side.</p>
      )}
      <ul className="panel divide-y divide-line">
        {rows.map((m) => {
          const chip = MEMBERSHIP_CHIP[m.membership];
          return (
            <li key={m.id} className="flex flex-col gap-2 p-3 hover:bg-paper sm:flex-row sm:items-center sm:justify-between">
              <Link href={`/admin/medlemmer/${m.id}`} className="flex min-w-0 items-center gap-3">
                <Avatar name={m.name} avatarKey={m.avatarKey} size={36} />
                <span className="min-w-0">
                  <span className="block font-semibold">{m.name} {m.role === "ADMIN" && <Chip tone="mine">Admin</Chip>}</span>
                  <span className="block truncate text-sm text-muted">{m.email}</span>
                </span>
              </Link>
              <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                {m.role !== "ADMIN" && <Chip tone={chip.tone}>{chip.label}</Chip>}
                {m.membership === "ACTIVE" && m.paidThrough && <span>betalt til {dateFmt.format(new Date(`${m.paidThrough}T00:00:00Z`))}</span>}
                {!m.emailVerified && <Chip tone="quiet">E-mail ikke bekræftet</Chip>}
                {m.membership === "PENDING" ? (
                  <>
                    <span>oprettet {formatRelative(m.createdAt)}</span>
                    <ApproveButton userId={m.id} paidThrough={suggested} />
                  </>
                ) : (
                  <>
                    <RatingStateChip state={m.ratingState} />
                    {m.link?.lastSuccessfulSyncAt && <span>synk {formatRelative(m.link.lastSuccessfulSyncAt)}</span>}
                  </>
                )}
              </span>
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-4 text-muted">{tab.key === "afventer" ? "Ingen nye medlemmer venter på godkendelse." : "Ingen medlemmer fundet."}</li>}
      </ul>
    </>
  );
}
