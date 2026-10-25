import Link from "next/link";

export interface MyProgramme {
  id: string;
  name: string;
  color: string;
  description: string | null;
  access: string;
}

/** The programmes a member can book right now. Deliberately no ladder or "next level". */
export function MyProgrammes({ items, verified, compact = false }: { items: MyProgramme[]; verified: boolean; compact?: boolean }) {
  return (
    <>
      {items.length > 0 ? (
        <ul className={compact ? "mt-3 divide-y divide-line" : "mt-4 space-y-2"}>
          {items.map((p) => (
            <li key={p.id} className={compact ? "flex items-center justify-between gap-3 py-2.5" : "flex items-center gap-3 rounded-[10px] border border-line p-3"}>
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className={compact ? "h-3 w-3 shrink-0 rounded-full" : "h-8 w-1.5 shrink-0 rounded-full"} style={{ background: p.color }} />
                <span className="min-w-0">
                  <span className="block font-semibold">{p.name}</span>
                  {!compact && p.description && <span className="block text-sm text-muted">{p.description}</span>}
                </span>
              </span>
              <span className="num shrink-0 text-right text-sm text-muted">{p.access}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">Klubben har ikke oprettet hold endnu.</p>
      )}
      {!verified && (
        <p className="mt-3 text-sm text-muted">
          <Link href="/profil#dupr" className="link">Kobl din DUPR-profil til</Link>, så åbner de hold, der passer til din rating, automatisk.
        </p>
      )}
    </>
  );
}
