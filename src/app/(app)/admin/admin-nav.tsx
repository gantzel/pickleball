"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Overblik" },
  { href: "/admin/traeninger", label: "Træninger" },
  { href: "/admin/medlemmer", label: "Medlemmer" },
  { href: "/admin/synk", label: "DUPR-synk" },
  { href: "/admin/niveauer", label: "Niveauer" },
  { href: "/admin/indstillinger", label: "Regler" },
  { href: "/admin/log", label: "Log" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Administration" className="-mx-4 mb-8 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {ITEMS.map((i) => {
          const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className="inline-flex min-h-[44px] items-center whitespace-nowrap border-b-[3px] border-transparent px-3 text-[0.95rem] font-medium text-muted hover:text-ink aria-[current=page]:border-court aria-[current=page]:text-court"
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
