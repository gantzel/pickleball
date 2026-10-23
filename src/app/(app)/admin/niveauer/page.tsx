import { PageHeader } from "@/components/app-shell";
import { listLevels } from "@/server/admin";
import { requireAdminUser } from "@/server/current-user";
import { LevelForm } from "../controls";

export const metadata = { title: "Niveauer — admin" };

export default async function LevelsPage() {
  await requireAdminUser();
  const levels = await listLevels();
  return (
    <div className="max-w-4xl">
      <PageHeader title="Træningsniveauer" intro="Niveauer går fra minimum op til (men ikke med) maksimum, så de ikke overlapper. Det højeste niveau har intet maksimum." />
      <ul className="space-y-4">
        {levels.map((l) => (
          <li key={l.id} className="panel border-l-4 p-5" style={{ borderLeftColor: l.color }}>
            <LevelForm level={l} />
          </li>
        ))}
      </ul>
      <section className="panel mt-8 p-5">
        <h2 className="mb-4 text-lg font-bold">Nyt niveau</h2>
        <LevelForm />
      </section>
    </div>
  );
}
