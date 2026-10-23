import { PageHeader } from "@/components/app-shell";
import { requireAdminUser } from "@/server/current-user";
import { getSettings } from "@/server/settings";
import { SettingsForm } from "../controls";

export const metadata = { title: "Regler — admin" };

export default async function SettingsPage() {
  await requireAdminUser();
  const s = await getSettings();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Regler" intro="Reglerne gælder for alle træninger og vises for medlemmerne, hvor de er relevante. Ændringer logges." />
      <div className="panel p-5 sm:p-6"><SettingsForm s={s} /></div>
    </div>
  );
}
