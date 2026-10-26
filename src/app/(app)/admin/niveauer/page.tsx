import { PageHeader } from "@/components/app-shell";
import { listLevels, listRoster } from "@/server/admin";
import { requireAdminUser, toActor } from "@/server/current-user";
import { LevelForm, LevelImageForm, RosterPanel, StandardStructureButton } from "../controls";

export const metadata = { title: "Hold — admin" };

export default async function LevelsPage() {
  const actor = toActor(await requireAdminUser());
  const levels = await listLevels();
  const rosters = new Map(
    await Promise.all(levels.filter((l) => l.kind === "JUNIOR").map(async (l) => [l.id, await listRoster(actor, l.id)] as const)),
  );
  const nextSort = (levels.at(-1)?.sortOrder ?? 0) + 10;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Hold og tilbud"
        intro="Ratingniveauer går fra den nedre grænse op til (men ikke med) den øvre, så de aldrig overlapper. Medlemmerne flytter automatisk mellem niveauerne, når deres DUPR-rating ændrer sig."
      />
      {levels.length === 0 && (
        <section className="panel mb-6 p-5">
          <h2 className="mb-2 text-lg font-bold">Kom i gang</h2>
          <p className="mb-4 text-sm text-muted">
            Opret klubbens struktur med ét klik: Level 1–3, Kamphold, Børnehold, Social Play og DUPR-events. Du kan rette alt bagefter.
          </p>
          <StandardStructureButton />
        </section>
      )}
      <ul className="space-y-4">
        {levels.map((l) => (
          <li key={l.id} className="panel border-l-4 p-5" style={{ borderLeftColor: l.color }}>
            <LevelForm level={l} />
            <LevelImageForm levelId={l.id} imageKey={l.imageKey} color={l.color} />
            {l.kind === "JUNIOR" && <RosterPanel levelId={l.id} members={rosters.get(l.id) ?? []} />}
          </li>
        ))}
      </ul>
      <section className="panel mt-8 p-5">
        <h2 className="mb-4 text-lg font-bold">Nyt hold</h2>
        <LevelForm nextSort={nextSort} />
      </section>
    </div>
  );
}
