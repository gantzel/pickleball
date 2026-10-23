import { asc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createMockPlayerAction, saveMockPlayerAction, sendMockWebhookAction } from "@/app/actions/dev";
import { Logo } from "@/components/logo";
import { db } from "@/db";
import { duprLink, mockDuprPlayer } from "@/db/schema";
import { devToolsAllowed } from "@/lib/env";
import { requireUser } from "@/server/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock-DUPR (udvikling)" };

/**
 * DEVELOPMENT/DEMO ONLY stand-in for DUPR's login/consent screen plus
 * controls for simulating rating changes and failures. 404 in production.
 */
export default async function MockDupr({ searchParams }: { searchParams: Promise<{ state?: string; redirect_uri?: string }> }) {
  if (!devToolsAllowed()) notFound();
  await requireUser();
  const { state } = await searchParams;
  const players = await db.select().from(mockDuprPlayer).orderBy(asc(mockDuprPlayer.name));
  const linked = new Set((await db.select({ id: duprLink.externalId }).from(duprLink)).map((l) => l.id));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 rounded-[12px] border-2 border-dashed border-wait bg-wait-soft p-4 text-sm font-semibold text-wait">
        Dette er en test-udbyder, der efterligner DUPR under udvikling. Intet her er ægte DUPR-data, og siden findes ikke i produktion.
      </div>
      <Logo />

      {state ? (
        <section className="panel mt-6 p-6">
          <h1 className="text-2xl font-bold">Log ind hos Mock-DUPR</h1>
          <p className="mt-2 text-muted">Vælg den testspiller, du vil &quot;være&quot;. I den rigtige integration logger medlemmet ind hos DUPR og giver tilladelse.</p>
          <form action="/api/dupr/callback" method="get" className="mt-5 space-y-3">
            <input type="hidden" name="state" value={state} />
            <fieldset className="space-y-2">
              <legend className="label">Testspiller</legend>
              {players.map((p, i) => (
                <label key={p.id} className="flex items-center gap-3 rounded-[10px] border border-line p-3">
                  <input type="radio" name="code" value={p.id} defaultChecked={i === 0} required className="h-5 w-5 accent-[#1f5c4a]" />
                  <span className="flex-1">{p.name} <span className="num text-sm text-muted">({p.id}, double {p.doublesRating ?? "ingen"})</span></span>
                  {linked.has(p.id) && <span className="text-xs text-muted">allerede koblet</span>}
                </label>
              ))}
            </fieldset>
            <div className="flex gap-3">
              <button className="btn btn-primary">Tillad adgang</button>
              <a href={`/api/dupr/callback?state=${encodeURIComponent(state)}&error=access_denied`} className="btn btn-ghost">Afbryd</a>
            </div>
          </form>
        </section>
      ) : (
        <p className="mt-6"><Link href="/profil" className="link">Tilbage til profil</Link></p>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-bold">Simulér DUPR</h2>
        <p className="mt-1 text-sm text-muted">Ændr en testspillers rating eller fejltilstand, og send derefter en webhook, så platformen henter den nye værdi.</p>
        <ul className="mt-4 space-y-3">
          {players.map((p) => (
            <li key={p.id} className="panel p-4">
              <form action={saveMockPlayerAction} className="grid gap-3 sm:grid-cols-[1.2fr_0.7fr_0.7fr_1fr_auto] sm:items-end">
                <input type="hidden" name="id" value={p.id} />
                <div><p className="font-semibold">{p.name}</p><p className="num text-xs text-muted">{p.id}</p></div>
                <div><label className="label text-xs" htmlFor={`d-${p.id}`}>Double</label><input id={`d-${p.id}`} name="doublesRating" type="number" step="0.001" min="1" max="8.5" defaultValue={p.doublesRating ?? ""} className="field" /></div>
                <div><label className="label text-xs" htmlFor={`s-${p.id}`}>Single</label><input id={`s-${p.id}`} name="singlesRating" type="number" step="0.001" min="1" max="8.5" defaultValue={p.singlesRating ?? ""} className="field" /></div>
                <div>
                  <label className="label text-xs" htmlFor={`f-${p.id}`}>Svar fra DUPR</label>
                  <select id={`f-${p.id}`} name="failMode" defaultValue={p.failMode} className="field">
                    <option value="NONE">Normalt</option>
                    <option value="ERROR">Serverfejl</option>
                    <option value="RATE_LIMIT">Rate limit</option>
                    <option value="REVOKED">Adgang tilbagekaldt</option>
                    <option value="NO_RATING">Ingen rating</option>
                  </select>
                </div>
                <button className="btn btn-secondary">Gem</button>
              </form>
              <form action={sendMockWebhookAction} className="mt-2">
                <input type="hidden" name="id" value={p.id} />
                <button className="btn btn-ghost text-sm">Send rating-webhook</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createMockPlayerAction} className="panel mt-4 flex flex-wrap items-end gap-3 p-4">
          <div><label className="label" htmlFor="np-name">Ny testspiller</label><input id="np-name" name="name" placeholder="Navn" className="field" /></div>
          <div><label className="label" htmlFor="np-r">Double</label><input id="np-r" name="doublesRating" type="number" step="0.001" defaultValue="3.000" className="field w-28" /></div>
          <button className="btn btn-secondary">Opret</button>
        </form>
      </section>
    </main>
  );
}
