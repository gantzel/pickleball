"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "calendar" | "chart" | "user" | "shield";
}

const ICONS: Record<NavItem["icon"], React.ReactNode> = {
  home: <path d="M3 10.5 11 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H4a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="15" height="14" rx="2" />
      <path d="M3.5 9.5h15M8 3v4M14 3v4" />
    </>
  ),
  chart: <path d="M4 18h14M5 15l4-4 3 3 5-6" />,
  user: (
    <>
      <circle cx="11" cy="8" r="3.5" />
      <path d="M4.5 19c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" />
    </>
  ),
  shield: <path d="M11 3.5 4.5 6v5c0 4 2.8 6.9 6.5 8 3.7-1.1 6.5-4 6.5-8V6z" />,
};

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function TopNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Hovedmenu" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={isActive(path, i.href) ? "page" : undefined}
              className="rounded-[8px] px-3 py-2 text-[0.95rem] font-medium text-muted hover:bg-court-soft hover:text-ink aria-[current=page]:bg-court-soft aria-[current=page]:text-court"
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Hovedmenu" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map((i) => (
          <li key={i.href} className="flex-1">
            <Link
              href={i.href}
              aria-current={isActive(path, i.href) ? "page" : undefined}
              className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[0.72rem] font-medium text-muted aria-[current=page]:text-court"
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICONS[i.icon]}
              </svg>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
