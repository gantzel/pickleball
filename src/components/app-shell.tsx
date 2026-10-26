import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { notification } from "@/db/schema";
import { isDemo } from "@/lib/env";
import type { CurrentUser } from "@/server/current-user";
import { Avatar } from "./avatar";
import { Logo } from "./logo";
import { BottomNav, TopNav, type NavItem } from "./nav-links";
import { Toaster } from "./toaster";

export async function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(notification)
    .where(and(eq(notification.userId, user.id), isNull(notification.readAt)));
  const unread = Number(n);
  const items: NavItem[] = [
    { href: "/", label: "Hjem", icon: "home" },
    { href: "/traeninger", label: "Træninger", icon: "calendar" },
    { href: "/udvikling", label: "Udvikling", icon: "chart" },
    { href: "/profil", label: "Profil", icon: "user" },
  ];
  if (user.role === "ADMIN") items.push({ href: "/admin", label: "Admin", icon: "shield" });

  return (
    <div className="flex min-h-dvh flex-col pb-20 md:pb-0">
      <a href="#indhold" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Spring til indhold
      </a>
      {isDemo() && (
        <div role="note" className="bg-ball px-4 py-1.5 text-center text-sm font-semibold text-ink">
          Demo: ratings kommer fra en test-udbyder og er ikke ægte DUPR-data.
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="rounded-md" aria-label="Copenhagen Pickleball Collective, forside">
            <Logo />
          </Link>
          <TopNav items={items} />
          <div className="flex items-center gap-2">
            <Link href="/notifikationer" className="relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-court-soft" aria-label={unread ? `Notifikationer, ${unread} ulæste` : "Notifikationer"}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <path d="M6 9a5 5 0 0 1 10 0c0 4.5 2 5.5 2 5.5H4S6 13.5 6 9M9 18a2 2 0 0 0 4 0" />
              </svg>
              {unread > 0 && (
                <span className="num absolute right-1 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-court px-1 text-[0.7rem] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <Link href="/profil" className="rounded-full" aria-label="Din profil">
              <Avatar name={user.name} avatarKey={user.avatarKey} size={36} />
            </Link>
          </div>
        </div>
      </header>
      <main id="indhold" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>
      <footer className="mx-auto hidden w-full max-w-6xl px-6 pb-8 text-sm text-muted md:block">
        <Link href="/privatliv" className="link">Privatliv og data</Link>
      </footer>
      <Toaster />
      <BottomNav items={items.slice(0, 5)} />
    </div>
  );
}

export function PageHeader({ title, intro, actions }: { title: string; intro?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[clamp(1.75rem,4vw,2.5rem)] font-bold">{title}</h1>
        {intro && <div className="mt-1 max-w-[62ch] text-muted">{intro}</div>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}
