"use client";

import { useActionState, useState, useTransition } from "react";
import { bookingAdminAction, deleteLevelAction, retrySyncAction, saveLevelAction, saveSessionAction, saveSettingsAction, sessionCommandAction } from "@/app/actions/admin";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import type { ActionResult } from "@/lib/errors";

export interface SessionFormValues {
  id?: string;
  title?: string;
  description?: string | null;
  focus?: string | null;
  levelId?: string | null;
  startsAt?: string;
  endsAt?: string;
  locationName?: string;
  address?: string | null;
  mapUrl?: string | null;
  minRating?: number | null;
  maxRating?: number | null;
  capacity?: number;
  bookingOpensAt?: string;
  bookingClosesAt?: string;
}

export function SessionForm({ values, levels, isDraft }: { values: SessionFormValues; levels: { id: string; name: string; minRating: number; maxRating: number | null }[]; isDraft: boolean }) {
  const [state, action] = useActionState(saveSessionAction, null);
  const [min, setMin] = useState(values.minRating?.toString() ?? "");
  const [max, setMax] = useState(values.maxRating?.toString() ?? "");
  const [levelId, setLevelId] = useState(values.levelId ?? "");
  const v = values;
  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string }) => {
    const { hint, ...rest } = props;
    return (
      <div>
        <label htmlFor={`f-${name}`} className="label">{label}</label>
        <input id={`f-${name}`} name={name} className="field" aria-describedby={hint ? `h-${name}` : undefined} {...rest} />
        {hint && <p id={`h-${name}`} className="hint">{hint}</p>}
      </div>
    );
  };
  return (
    <form action={action} className="space-y-6">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-lg font-bold">Indhold</legend>
        <div className="sm:col-span-2">{field("title", "Titel", { defaultValue: v.title, required: true, maxLength: 120 })}</div>
        {field("focus", "Træningsfokus", { defaultValue: v.focus ?? "", maxLength: 200, hint: "F.eks. dinks, tredjeslag, serv og retur" })}
        <div>
          <label htmlFor="f-levelId" className="label">Niveau</label>
          <select
            id="f-levelId"
            name="levelId"
            className="field"
            value={levelId}
            onChange={(e) => {
              setLevelId(e.target.value);
              const l = levels.find((x) => x.id === e.target.value);
              if (l) {
                setMin(String(l.minRating));
                setMax(l.maxRating !== null ? String(Math.round((l.maxRating - 0.001) * 1000) / 1000) : "");
              }
            }}
          >
            <option value="">Intet niveau</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <p className="hint">Vælg et niveau for at udfylde ratinggrænserne.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="f-description" className="label">Beskrivelse</label>
          <textarea id="f-description" name="description" defaultValue={v.description ?? ""} rows={4} maxLength={2000} className="field" />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-lg font-bold">Tid og sted</legend>
        {field("startsAt", "Start (dansk tid)", { type: "datetime-local", defaultValue: v.startsAt, required: true })}
        {field("endsAt", "Slut (dansk tid)", { type: "datetime-local", defaultValue: v.endsAt, required: true })}
        {field("locationName", "Sted", { defaultValue: v.locationName, required: true, maxLength: 120 })}
        {field("address", "Adresse", { defaultValue: v.address ?? "", maxLength: 200 })}
        <div className="sm:col-span-2">{field("mapUrl", "Kortlink (valgfrit)", { type: "url", defaultValue: v.mapUrl ?? "", placeholder: "https://", maxLength: 500 })}</div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-lg font-bold">Adgang og pladser</legend>
        <div>
          <label htmlFor="f-minRating" className="label">Min. rating</label>
          <input id="f-minRating" name="minRating" type="number" step="0.001" min="1" max="8.5" inputMode="decimal" className="field" value={min} onChange={(e) => setMin(e.target.value)} aria-describedby="h-range" />
        </div>
        <div>
          <label htmlFor="f-maxRating" className="label">Maks. rating</label>
          <input id="f-maxRating" name="maxRating" type="number" step="0.001" min="1" max="8.5" inputMode="decimal" className="field" value={max} onChange={(e) => setMax(e.target.value)} aria-describedby="h-range" />
        </div>
        {field("capacity", "Pladser", { type: "number", min: 1, max: 500, defaultValue: v.capacity ?? 16, required: true })}
        <p id="h-range" className="hint sm:col-span-3">Begge grænser er inklusive. Lad et felt stå tomt for ingen grænse.</p>
        {field("bookingOpensAt", "Booking åbner (valgfrit)", { type: "datetime-local", defaultValue: v.bookingOpensAt })}
        {field("bookingClosesAt", "Booking lukker (valgfrit)", { type: "datetime-local", defaultValue: v.bookingClosesAt, hint: "Standard: ved start" })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {v.id ? (
          <SubmitButton>Gem ændringer</SubmitButton>
        ) : (
          <>
            <SubmitButton name="intent" value="publish">Opret og offentliggør</SubmitButton>
            <SubmitButton className="btn btn-secondary" name="intent" value="draft">Gem som kladde</SubmitButton>
          </>
        )}
        {isDraft && v.id && <span className="text-sm text-muted">Kladden er ikke synlig for medlemmer endnu.</span>}
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function SessionCommands({ id, status, started }: { id: string; status: string; started: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const run = (c: "publish" | "duplicate" | "complete" | "cancel") => start(async () => setState(await sessionCommandAction(id, c, reason)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && <button className="btn btn-primary" disabled={pending} onClick={() => run("publish")}>Offentliggør</button>}
        <button className="btn btn-secondary" disabled={pending} onClick={() => run("duplicate")}>Kopiér til næste uge</button>
        {status === "PUBLISHED" && started && <button className="btn btn-secondary" disabled={pending} onClick={() => run("complete")}>Markér som afsluttet</button>}
        {(status === "PUBLISHED" || status === "DRAFT") && !cancelling && <button className="btn btn-ghost text-alert" onClick={() => setCancelling(true)}>Aflys træning</button>}
      </div>
      {cancelling && (
        <div className="rounded-[12px] border border-alert/30 bg-alert-soft p-4">
          <label htmlFor="cancel-reason" className="label">Årsag (sendes til deltagerne)</label>
          <input id="cancel-reason" className="field" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-3 flex gap-2">
            <button className="btn btn-danger" disabled={pending} onClick={() => run("cancel")}>{pending ? "Aflyser…" : "Aflys og giv besked"}</button>
            <button className="btn btn-ghost" onClick={() => setCancelling(false)}>Fortryd</button>
          </div>
        </div>
      )}
      <FormMessage state={state} />
    </div>
  );
}

export function ParticipantActions({ bookingId, status, attendance, canMarkAttendance }: { bookingId: string; status: string; attendance: string; canMarkAttendance: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = (c: "cancel" | "ATTENDED" | "NO_SHOW" | "UNKNOWN") => start(async () => setState(await bookingAdminAction(bookingId, c)));
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "CONFIRMED" && canMarkAttendance && (
        <div role="group" aria-label="Fremmøde" className="inline-flex overflow-hidden rounded-[8px] border border-line">
          {[
            ["ATTENDED", "Mødt"],
            ["NO_SHOW", "Udeblev"],
          ].map(([val, label]) => (
            <button
              key={val}
              aria-pressed={attendance === val}
              disabled={pending}
              onClick={() => run(attendance === val ? "UNKNOWN" : (val as "ATTENDED" | "NO_SHOW"))}
              className="min-h-[36px] px-3 text-sm font-medium aria-pressed:bg-court aria-pressed:text-white"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {["CONFIRMED", "WAITLISTED", "OFFERED"].includes(status) && !canMarkAttendance &&
        (confirm ? (
          <>
            <button className="btn btn-danger min-h-[36px] text-sm" disabled={pending} onClick={() => run("cancel")}>Annullér</button>
            <button className="btn btn-ghost min-h-[36px] text-sm" onClick={() => setConfirm(false)}>Fortryd</button>
          </>
        ) : (
          <button className="btn btn-ghost min-h-[36px] text-sm" onClick={() => setConfirm(true)}>Annullér booking</button>
        ))}
      {state && !state.ok && <span role="alert" className="w-full text-right text-xs text-alert">{state.message}</span>}
    </div>
  );
}

export function LevelForm({ level }: { level?: { id: string; name: string; description: string | null; minRating: number; maxRating: number | null; color: string; sortOrder: number } }) {
  const [state, action] = useActionState(saveLevelAction, null);
  const [pending, start] = useTransition();
  const [delState, setDelState] = useState<ActionResult | null>(null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1.4fr_0.8fr_0.8fr_auto] sm:items-end">
      {level && <input type="hidden" name="id" value={level.id} />}
      <input type="hidden" name="sortOrder" value={level?.sortOrder ?? 0} />
      <div>
        <label className="label" htmlFor={`ln-${level?.id ?? "new"}`}>Navn</label>
        <input id={`ln-${level?.id ?? "new"}`} name="name" defaultValue={level?.name} required maxLength={60} className="field" />
      </div>
      <div>
        <label className="label" htmlFor={`lmin-${level?.id ?? "new"}`}>Fra rating</label>
        <input id={`lmin-${level?.id ?? "new"}`} name="minRating" type="number" step="0.001" min="1" max="8.5" defaultValue={level?.minRating} required className="field" />
      </div>
      <div>
        <label className="label" htmlFor={`lmax-${level?.id ?? "new"}`}>Til under</label>
        <input id={`lmax-${level?.id ?? "new"}`} name="maxRating" type="number" step="0.001" min="1" max="8.5" defaultValue={level?.maxRating ?? ""} className="field" />
      </div>
      <div>
        <label className="label" htmlFor={`lc-${level?.id ?? "new"}`}>Farve</label>
        <input id={`lc-${level?.id ?? "new"}`} name="color" type="color" defaultValue={level?.color ?? "#2f6b4f"} className="h-11 w-16 cursor-pointer rounded-[10px] border border-line bg-surface p-1" />
      </div>
      <div className="sm:col-span-4">
        <label className="label" htmlFor={`ld-${level?.id ?? "new"}`}>Beskrivelse</label>
        <input id={`ld-${level?.id ?? "new"}`} name="description" defaultValue={level?.description ?? ""} maxLength={300} className="field" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
        <SubmitButton>{level ? "Gem niveau" : "Opret niveau"}</SubmitButton>
        {level && (
          <button type="button" className="btn btn-ghost text-alert" disabled={pending} onClick={() => start(async () => setDelState(await deleteLevelAction(level.id)))}>
            Slet
          </button>
        )}
        <FormMessage state={state ?? delState} />
      </div>
    </form>
  );
}

export function SettingsForm({ s }: { s: { ratingType: string; staleAfterDays: number; syncIntervalHours: number; offerWindowHours: number; cancellationCutoffHours: number; ratingDropPolicy: string } }) {
  const [state, action] = useActionState(saveSettingsAction, null);
  const num = (name: keyof typeof s, label: string, hint: string, min: number, max: number) => (
    <div>
      <label htmlFor={`s-${name}`} className="label">{label}</label>
      <input id={`s-${name}`} name={name} type="number" min={min} max={max} required defaultValue={s[name] as number} className="field max-w-[10rem]" aria-describedby={`sh-${name}`} />
      <p id={`sh-${name}`} className="hint">{hint}</p>
    </div>
  );
  return (
    <form action={action} className="space-y-8">
      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-bold">Rating</legend>
        <div>
          <label htmlFor="s-ratingType" className="label">Rating der bruges til adgang</label>
          <select id="s-ratingType" name="ratingType" defaultValue={s.ratingType} className="field max-w-xs">
            <option value="DOUBLES">Double-rating</option>
            <option value="SINGLES">Single-rating</option>
          </select>
        </div>
        {num("staleAfterDays", "Rating forældes efter (dage)", "En rating, der ikke er hentet fra DUPR inden for denne periode, kan ikke bruges til at booke.", 1, 90)}
        {num("syncIntervalHours", "Automatisk synkronisering (timer)", "Hvor ofte hver rating hentes igen. Webhooks fra DUPR opdaterer straks, når de er aktive.", 1, 168)}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-bold">Booking og venteliste</legend>
        {num("offerWindowHours", "Svarfrist på ledig plads (timer)", "Den første på ventelisten, der opfylder kravet, får pladsen tilbudt i så lang tid. Fristen afkortes, hvis bookingen lukker før.", 1, 72)}
        {num("cancellationCutoffHours", "Afmeldingsfrist (timer før start)", "Herefter kan medlemmer ikke afmelde sig selv.", 0, 72)}
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-lg font-bold">Når en rating falder under en booket træning</legend>
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-[10px] border border-line p-3">
            <input type="radio" name="ratingDropPolicy" value="KEEP_AND_FLAG" defaultChecked={s.ratingDropPolicy === "KEEP_AND_FLAG"} className="mt-1 h-5 w-5 accent-[#1f5c4a]" />
            <span><span className="font-semibold">Behold pladsen og markér den</span><span className="block text-sm text-muted">Medlemmet beholder pladsen og får besked. Administratorer ser markeringen og kan vurdere sagen.</span></span>
          </label>
          <label className="flex items-start gap-3 rounded-[10px] border border-line p-3">
            <input type="radio" name="ratingDropPolicy" value="RELEASE_AND_NOTIFY" defaultChecked={s.ratingDropPolicy === "RELEASE_AND_NOTIFY"} className="mt-1 h-5 w-5 accent-[#1f5c4a]" />
            <span><span className="font-semibold">Giv pladsen videre</span><span className="block text-sm text-muted">Bookingen frigives til ventelisten, og medlemmet får besked med begrundelse.</span></span>
          </label>
        </div>
      </fieldset>
      <div className="flex items-center gap-4">
        <SubmitButton>Gem regler</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function RetryButton({ linkId }: { linkId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button className="btn btn-secondary min-h-[36px] text-sm" disabled={pending} onClick={() => start(async () => setState(await retrySyncAction(linkId)))}>
        {pending ? "Prøver…" : "Prøv igen"}
      </button>
      {state && <span role="status" className={`text-xs ${state.ok ? "text-court" : "text-alert"}`}>{state.message}</span>}
    </span>
  );
}
