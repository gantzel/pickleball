"use client";

import { useActionState, useState, useTransition } from "react";
import { levelImageAction, setMembershipAction, addToRosterAction, applyStandardStructureAction, rosterCandidatesAction, testSessionsAction, setRoleAction, bookingAdminAction, deleteLevelAction, removeFromRosterAction, retrySyncAction, saveLevelAction, saveSessionAction, saveSettingsAction, sessionCommandAction } from "@/app/actions/admin";
import { formatBand } from "@/lib/format";
import { ProgrammeCover } from "@/components/programme-cover";
import { FormMessage } from "@/components/form-message";
import { Chip } from "@/components/status-chip";
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

export interface LevelOption { id: string; name: string; kind: string; minRating: number | null; maxRating: number | null }

/** What a programme means for a session's access, in admin language. */
function levelAccessText(l: LevelOption | undefined) {
  if (!l) return "Ingen hold: angiv evt. egne ratinggrænser. Uden grænser er træningen åben for alle.";
  switch (l.kind) {
    case "LEVEL":
      return `Adgang følger holdets ratinggrænser (${formatBand(l.minRating, l.maxRating, true)}) og flytter automatisk med medlemmernes rating.`;
    case "JUNIOR":
      return "Adgang via holdets deltagerliste (Admin → Hold).";
    case "SOCIAL":
      return "Åben for alle medlemmer — også uden DUPR. Angiv evt. ratinggrænser for netop denne træning.";
    case "EVENT":
      return "Kræver koblet DUPR-profil. Angiv eventets egne ratingkrav nedenfor (valgfrit).";
    default:
      return "";
  }
}

export function SessionForm({ values, levels, isDraft }: { values: SessionFormValues; levels: LevelOption[]; isDraft: boolean }) {
  const [state, action] = useActionState(saveSessionAction, null);
  const [min, setMin] = useState(values.minRating?.toString() ?? "");
  const [max, setMax] = useState(values.maxRating?.toString() ?? "");
  const [levelId, setLevelId] = useState(values.levelId ?? "");
  const selectedLevel = levels.find((l) => l.id === levelId);
  const ownLimits = !selectedLevel || selectedLevel.kind === "SOCIAL" || selectedLevel.kind === "EVENT";
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
          <label htmlFor="f-levelId" className="label">Hold</label>
          <select
            id="f-levelId"
            name="levelId"
            className="field"
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
            aria-describedby="h-level"
          >
            <option value="">Intet hold</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <p id="h-level" className="hint">{levelAccessText(selectedLevel)}</p>
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
        {ownLimits ? (
          <>
            <div>
              <label htmlFor="f-minRating" className="label">Min. rating</label>
              <input id="f-minRating" name="minRating" type="number" step="0.001" min="1" max="8.5" inputMode="decimal" className="field" value={min} onChange={(e) => setMin(e.target.value)} aria-describedby="h-range" />
            </div>
            <div>
              <label htmlFor="f-maxRating" className="label">Maks. rating</label>
              <input id="f-maxRating" name="maxRating" type="number" step="0.001" min="1" max="8.5" inputMode="decimal" className="field" value={max} onChange={(e) => setMax(e.target.value)} aria-describedby="h-range" />
            </div>
          </>
        ) : (
          <p className="sm:col-span-2 self-end rounded-[10px] bg-surface-2 p-3 text-sm text-muted">{levelAccessText(selectedLevel)}</p>
        )}
        {field("capacity", "Pladser", { type: "number", min: 1, max: 500, defaultValue: v.capacity ?? 16, required: true })}
        {ownLimits && <p id="h-range" className="hint sm:col-span-3">Begge grænser er inklusive og kræver en verificeret DUPR-rating. Lad felterne stå tomme for ingen ratingkrav.</p>}
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

const KIND_LABELS: Record<string, string> = {
  LEVEL: "Ratingniveau (DUPR)",
  JUNIOR: "Deltagerliste (f.eks. børnehold)",
  SOCIAL: "Åbent for alle",
  EVENT: "DUPR-event",
};

export interface LevelValues {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  minRating: number | null;
  maxRating: number | null;
  allowUnrated: boolean;
  color: string;
  sortOrder: number;
}

export function LevelForm({ level, nextSort = 0 }: { level?: LevelValues; nextSort?: number }) {
  const [state, action] = useActionState(saveLevelAction, null);
  const [pending, start] = useTransition();
  const [delState, setDelState] = useState<ActionResult | null>(null);
  const [kind, setKind] = useState(level?.kind ?? "LEVEL");
  const k = level?.id ?? "new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end">
      {level && <input type="hidden" name="id" value={level.id} />}
      <input type="hidden" name="sortOrder" value={level?.sortOrder ?? nextSort} />
      <div>
        <label className="label" htmlFor={`ln-${k}`}>Navn</label>
        <input id={`ln-${k}`} name="name" defaultValue={level?.name} required maxLength={60} className="field" />
      </div>
      <div>
        <label className="label" htmlFor={`lk-${k}`}>Adgang</label>
        <select id={`lk-${k}`} name="kind" className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`lc-${k}`}>Farve</label>
        <input id={`lc-${k}`} name="color" type="color" defaultValue={level?.color ?? "#2f6b4f"} className="h-11 w-16 cursor-pointer rounded-[10px] border border-line bg-surface p-1" />
      </div>
      {kind === "LEVEL" && (
        <div className="grid gap-3 sm:col-span-3 sm:grid-cols-[1fr_1fr_1.4fr] sm:items-end">
          <div>
            <label className="label" htmlFor={`lmin-${k}`}>Fra rating (inkl.)</label>
            <input id={`lmin-${k}`} name="minRating" type="number" step="0.001" min="1" max="8.5" defaultValue={level?.minRating ?? ""} placeholder="Ingen bundgrænse" className="field" />
          </div>
          <div>
            <label className="label" htmlFor={`lmax-${k}`}>Til under</label>
            <input id={`lmax-${k}`} name="maxRating" type="number" step="0.001" min="1" max="8.5" defaultValue={level?.maxRating ?? ""} placeholder="Ingen topgrænse" className="field" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="allowUnrated" defaultChecked={level?.allowUnrated ?? false} className="h-5 w-5" />
            Nye spillere uden DUPR-rating må booke
          </label>
        </div>
      )}
      <div className="sm:col-span-3">
        <label className="label" htmlFor={`ld-${k}`}>Beskrivelse</label>
        <input id={`ld-${k}`} name="description" defaultValue={level?.description ?? ""} maxLength={300} className="field" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <SubmitButton>{level ? "Gem hold" : "Opret hold"}</SubmitButton>
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

export function StandardStructureButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => setState(await applyStandardStructureAction()))}>
        Opret klubbens hold
      </button>
      <FormMessage state={state} />
    </div>
  );
}

export interface RosterEntry {
  userId: string;
  childId: string | null;
  name: string;
  isChild: boolean;
  parentName: string | null;
  email: string;
}

export function RosterPanel({ levelId, members }: { levelId: string; members: RosterEntry[] }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<{ member: { id: string; name: string; email: string }; children: { id: string; name: string; birthYear: number }[] } | null>(null);
  const onList = (userId: string, childId: string | null) => members.some((m) => m.userId === userId && m.childId === childId);
  const find = () =>
    start(async () => {
      const r = await rosterCandidatesAction(email);
      setFound(r.ok && r.data ? r.data : null);
      setState(r.ok ? null : r);
    });
  const add = (childId: string | null) =>
    start(async () => {
      const r = await addToRosterAction(levelId, found!.member.email, childId);
      setState(r);
    });
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="mb-2 font-semibold">Deltagerliste ({members.length})</h3>
      {members.length > 0 ? (
        <ul className="mb-3 divide-y divide-line">
          {members.map((m) => (
            <li key={`${m.userId}-${m.childId ?? ""}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.name}</span>
                {m.isChild && <Chip tone="mine">Barn</Chip>}
                <span className="text-muted">{m.isChild ? `forælder: ${m.parentName} · ${m.email}` : m.email}</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost min-h-[36px] text-sm"
                disabled={pending}
                onClick={() => start(async () => setState(await removeFromRosterAction(levelId, m.userId, m.childId)))}
              >
                Fjern
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted">Ingen deltagere endnu. Kun dem på listen kan tilmeldes holdets træninger.</p>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <div className="min-w-[16rem] flex-1">
          <label className="label" htmlFor={`re-${levelId}`}>Tilføj — medlemmets eller forælderens e-mail</label>
          <input id={`re-${levelId}`} type="email" required className="field" value={email} onChange={(e) => { setEmail(e.target.value); setFound(null); }} />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>Find</button>
      </form>
      {found && (
        <ul className="mt-3 space-y-2">
          {[{ id: null as string | null, name: found.member.name, label: "Medlemmet selv" }, ...found.children.map((c) => ({ id: c.id as string | null, name: c.name, label: `Barn, født ${c.birthYear}` }))].map((c) => (
            <li key={c.id ?? "self"} className="flex items-center justify-between gap-3 rounded-[10px] border border-line p-2.5 text-sm">
              <span>
                <span className="font-medium">{c.name}</span> <span className="text-muted">· {c.label}</span>
              </span>
              {onList(found.member.id, c.id) ? (
                <span className="text-muted">På listen</span>
              ) : (
                <button type="button" className="btn btn-primary min-h-[36px] text-sm" disabled={pending} onClick={() => add(c.id)}>Tilføj</button>
              )}
            </li>
          ))}
          {found.children.length === 0 && <li className="text-sm text-muted">Medlemmet har ingen børn på sin profil. Forælderen tilføjer selv sine børn under Profil → Mine børn.</li>}
        </ul>
      )}
      <FormMessage state={state} />
    </div>
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

export function RoleControl({ userId, role, isSelf }: { userId: string; role: "MEMBER" | "ADMIN"; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (isSelf) return <p className="text-sm text-muted">Du kan ikke ændre din egen rolle.</p>;
  const next = role === "ADMIN" ? "MEMBER" : "ADMIN";
  return (
    <div className="space-y-2">
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{next === "ADMIN" ? "Giv adgang til alle medlemsdata og admin-funktioner?" : "Fjern adgangen til admin-området?"}</span>
          <button className={`btn ${next === "ADMIN" ? "btn-primary" : "btn-danger"}`} disabled={pending} onClick={() => start(async () => { setState(await setRoleAction(userId, next)); setConfirm(false); })}>
            {next === "ADMIN" ? "Ja, gør til admin" : "Ja, fjern admin"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Fortryd</button>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setConfirm(true)}>{role === "ADMIN" ? "Fjern admin-adgang" : "Gør til administrator"}</button>
      )}
      <FormMessage state={state} />
    </div>
  );
}

export function TestSessionsPanel({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = (c: "create" | "delete") =>
    start(async () => {
      setState(await testSessionsAction(c));
      setConfirm(false);
    });
  return (
    <section className="panel mb-6 border-dashed p-5">
      <h2 className="text-lg font-bold">Testtræninger</h2>
      <p className="mt-1 max-w-[62ch] text-sm text-muted">
        Opret testtræninger på alle hold de næste tre uger for at afprøve platformen. De er mærket TEST, kan bookes som rigtige træninger og slettes alle med ét klik — også deres bookinger. Rigtige træninger røres ikke.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {count === 0 ? (
          <button className="btn btn-primary" disabled={pending} onClick={() => run("create")}>Opret testtræninger</button>
        ) : confirm ? (
          <>
            <span className="text-sm">Slet {count} testtræninger og deres bookinger?</span>
            <button className="btn btn-ghost text-alert" disabled={pending} onClick={() => run("delete")}>Ja, slet</button>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Annullér</button>
          </>
        ) : (
          <>
            <span className="text-sm">{count} testtræninger findes.</span>
            <button className="btn btn-secondary" disabled={pending} onClick={() => setConfirm(true)}>Slet alle testtræninger</button>
          </>
        )}
        <FormMessage state={state} />
      </div>
    </section>
  );
}

export function ApproveButton({ userId, paidThrough }: { userId: string; paidThrough: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  if (state?.ok) return <span className="text-sm font-medium text-court">Godkendt</span>;
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="btn btn-primary min-h-[36px] text-sm"
        disabled={pending}
        onClick={() => start(async () => setState(await setMembershipAction(userId, "ACTIVE", paidThrough)))}
      >
        Godkend
      </button>
      {state && !state.ok && <span className="text-xs text-alert">{state.message}</span>}
    </span>
  );
}

export function MembershipControl({ userId, status, paidThrough, suggestedPaidThrough }: { userId: string; status: "PENDING" | "ACTIVE" | "ENDED"; paidThrough: string | null; suggestedPaidThrough: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult<unknown> | null>(null);
  const [st, setSt] = useState(status);
  const [paid, setPaid] = useState(paidThrough ?? (status === "PENDING" ? suggestedPaidThrough : ""));
  const upcoming = state?.ok && typeof state.data === "number" ? state.data : 0;
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setState(await setMembershipAction(userId, st, paid)));
      }}
    >
      <div>
        <label htmlFor="ms-status" className="label">Status</label>
        <select id="ms-status" className="field" value={st} onChange={(e) => setSt(e.target.value as typeof st)}>
          <option value="PENDING">Afventer godkendelse</option>
          <option value="ACTIVE">Aktivt medlem</option>
          <option value="ENDED">Afsluttet</option>
        </select>
      </div>
      <div>
        <label htmlFor="ms-paid" className="label">Kontingent betalt til (valgfrit)</label>
        <input id="ms-paid" type="date" className="field" value={paid} onChange={(e) => setPaid(e.target.value)} aria-describedby="ms-paid-h" />
      </div>
      <button className="btn btn-primary" disabled={pending}>Gem</button>
      <p id="ms-paid-h" className="hint sm:col-span-3">
        Efter datoen kan medlemmet ikke booke, før du forlænger. Lad feltet stå tomt, hvis I ikke vil styre det her.
      </p>
      <div className="sm:col-span-3">
        <FormMessage state={state as ActionResult | null} />
        {st === "ENDED" && upcoming > 0 && (
          <p className="mt-1 text-sm text-wait">Medlemmet har stadig {upcoming} aktive tilmeldinger. De er ikke afmeldt — annullér dem på de enkelte træninger, hvis det er nødvendigt.</p>
        )}
      </div>
    </form>
  );
}

export function LevelImageForm({ levelId, imageKey, color }: { levelId: string; imageKey: string | null; color: string }) {
  const [state, action] = useActionState(levelImageAction, null);
  return (
    <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[200px_1fr] sm:items-center">
      <div className="overflow-hidden rounded-[10px] border border-line">
        <ProgrammeCover imageKey={imageKey} color={color} />
      </div>
      <form action={action} className="space-y-2">
        <input type="hidden" name="levelId" value={levelId} />
        <label htmlFor={`li-${levelId}`} className="label">Billede til træningskort</label>
        <input id={`li-${levelId}`} name="image" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm" />
        <p className="hint">Vises øverst på holdets træninger. Beskæres til 16:9. Brug kun billeder, klubben har ret til at bruge — og spørg folk på billedet.</p>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className="btn btn-secondary">Upload billede</SubmitButton>
          {imageKey && (
            <button type="submit" name="remove" value="1" className="btn btn-ghost text-alert">Fjern billede</button>
          )}
          <FormMessage state={state} />
        </div>
      </form>
    </div>
  );
}
