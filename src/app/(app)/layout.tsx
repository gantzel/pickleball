import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/current-user";
import { refreshDemoIfNeeded } from "@/server/demo";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await refreshDemoIfNeeded(); // demo deployments only: keep upcoming sessions available
  return <AppShell user={user}>{children}</AppShell>;
}
