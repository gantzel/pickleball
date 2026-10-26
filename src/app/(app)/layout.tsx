import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/current-user";
import { refreshDemoIfNeeded } from "@/server/demo";
import { membershipMessage, membershipState } from "@/server/membership";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await refreshDemoIfNeeded(); // demo deployments only: keep upcoming sessions available
  const membership = membershipState(user);
  return (
    <AppShell user={user}>
      {membership !== "ACTIVE" && (
        <p role="status" className="mb-6 rounded-[12px] border border-wait/30 bg-wait-soft p-4 text-[0.95rem] font-medium text-wait">
          {membershipMessage(membership)}
        </p>
      )}
      {children}
    </AppShell>
  );
}
