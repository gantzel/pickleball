"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/errors";
import { addToRoster, applyStandardStructure, deleteLevel, removeFromRoster, saveLevel, setMemberRole, updateSettings } from "@/server/admin";
import { adminCancelBooking, adminSetAttendance } from "@/server/bookings";
import { requireAdminUser, toActor } from "@/server/current-user";
import { adminRetrySync } from "@/server/dupr/sync";
import { cancelSession, completeSession, createSession, duplicateSession, publishSession, updateSession } from "@/server/sessions";

const SESSION_FIELDS = [
  "title", "description", "focus", "levelId", "startsAt", "endsAt", "locationName", "address", "mapUrl",
  "minRating", "maxRating", "capacity", "bookingOpensAt", "bookingClosesAt",
] as const;

const formToObject = (form: FormData, fields: readonly string[]) =>
  Object.fromEntries(fields.map((f) => [f, String(form.get(f) ?? "")]));

const refreshAdmin = () => revalidatePath("/", "layout");

export async function saveSessionAction(_prev: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = toActor(await requireAdminUser());
  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent") ?? "save");
  const input = formToObject(form, SESSION_FIELDS);
  const res = await toActionResult(async () => {
    if (id) {
      const { flagged } = await updateSession(actor, id, input);
      return { id, flagged };
    }
    const s = await createSession(actor, input);
    if (intent === "publish") await publishSession(actor, s.id);
    return { id: s.id, flagged: 0 };
  });
  refreshAdmin();
  if (res.ok && !id) redirect(`/admin/traeninger/${res.data!.id}?oprettet=1`);
  if (res.ok) {
    const f = (res.data as { flagged: number }).flagged;
    return { ok: true, data: { id }, message: f ? `Gemt. ${f} booking(er) ligger nu uden for niveauet og er markeret.` : "Ændringerne er gemt." };
  }
  return res as ActionResult<{ id: string }>;
}

export async function sessionCommandAction(id: string, command: "publish" | "duplicate" | "complete" | "cancel", reason?: string): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  let goTo: string | null = null;
  const res = await toActionResult(async () => {
    if (command === "publish") await publishSession(actor, id);
    if (command === "complete") await completeSession(actor, id);
    if (command === "cancel") await cancelSession(actor, id, reason ?? "");
    if (command === "duplicate") goTo = `/admin/traeninger/${(await duplicateSession(actor, id)).id}?kopieret=1`;
  }, { publish: "Træningen er offentliggjort.", complete: "Træningen er afsluttet.", cancel: "Træningen er aflyst, og deltagerne har fået besked.", duplicate: "Kopieret." }[command]);
  refreshAdmin();
  if (res.ok && goTo) redirect(goTo);
  return res;
}

export async function bookingAdminAction(bookingId: string, command: "cancel" | "ATTENDED" | "NO_SHOW" | "UNKNOWN"): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const res = await toActionResult(async () => {
    if (command === "cancel") await adminCancelBooking(actor, bookingId);
    else await adminSetAttendance(actor, bookingId, command);
  }, command === "cancel" ? "Bookingen er annulleret." : "Fremmøde registreret.");
  refreshAdmin();
  return res;
}

export async function saveLevelAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const id = String(form.get("id") ?? "") || null;
  const res = await toActionResult(() => saveLevel(actor, id, formToObject(form, ["name", "description", "kind", "minRating", "maxRating", "allowUnrated", "color", "sortOrder"])), "Holdet er gemt.");
  refreshAdmin();
  return res as ActionResult;
}

export async function deleteLevelAction(id: string): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const res = await toActionResult(() => deleteLevel(actor, id), "Holdet er slettet.");
  refreshAdmin();
  return res;
}

export async function applyStandardStructureAction(): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const res = await toActionResult(() => applyStandardStructure(actor), "Klubbens hold er oprettet.");
  refreshAdmin();
  return res as ActionResult;
}

export async function addToRosterAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const levelId = String(form.get("levelId") ?? "");
  const email = String(form.get("email") ?? "");
  const res = await toActionResult(async () => (await addToRoster(actor, levelId, email)).name, "Medlemmet er tilføjet holdet.");
  refreshAdmin();
  return res as ActionResult;
}

export async function removeFromRosterAction(levelId: string, userId: string): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const res = await toActionResult(() => removeFromRoster(actor, levelId, userId), "Medlemmet er fjernet fra holdet.");
  refreshAdmin();
  return res;
}

export async function saveSettingsAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const res = await toActionResult(
    () => updateSettings(actor, formToObject(form, ["ratingType", "staleAfterDays", "syncIntervalHours", "offerWindowHours", "cancellationCutoffHours", "ratingDropPolicy"])),
    "Indstillingerne er gemt.",
  );
  refreshAdmin();
  return res;
}

export async function retrySyncAction(linkId: string): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const res = await toActionResult(async () => {
    const r = await adminRetrySync(actor, linkId);
    return r.result;
  });
  refreshAdmin();
  if (res.ok) return { ok: true, message: `Synkronisering: ${res.data}` };
  return res as ActionResult;
}

export async function setRoleAction(userId: string, role: "MEMBER" | "ADMIN"): Promise<ActionResult> {
  const actor = toActor(await requireAdminUser());
  const res = await toActionResult(() => setMemberRole(actor, userId, role), role === "ADMIN" ? "Medlemmet er nu administrator." : "Admin-adgangen er fjernet.");
  refreshAdmin();
  return res;
}
