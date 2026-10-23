import Link from "next/link";
import { markReadAction } from "@/app/actions/member";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import { formatRelative } from "@/lib/format";
import { requireUser, toActor } from "@/server/current-user";
import { listNotifications } from "@/server/members";

export const metadata = { title: "Notifikationer" };

export default async function NotificationsPage() {
  const items = await listNotifications(toActor(await requireUser()), 50);
  const unread = items.some((n) => !n.readAt);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifikationer"
        actions={
          unread ? (
            <form action={markReadAction}>
              <SubmitButton className="btn btn-secondary" pendingLabel="Markerer…">Markér alle som læst</SubmitButton>
            </form>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Ingen notifikationer">Vi giver besked her om bookinger, ventelister og ændringer i din rating.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`panel p-4 ${n.readAt ? "" : "border-l-4 border-l-court"}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">
                  {n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}
                  {!n.readAt && <span className="sr-only"> (ulæst)</span>}
                </p>
                <time className="shrink-0 text-sm text-muted" dateTime={n.createdAt.toISOString()}>{formatRelative(n.createdAt)}</time>
              </div>
              <p className="mt-1 text-[0.95rem] text-ink/85">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
