import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/current-user";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
