"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/errors";
import { acceptOffer, bookSession, cancelBooking, joinWaitlist } from "@/server/bookings";
import { requireUser, toActor } from "@/server/current-user";
import { unlink } from "@/server/dupr/link";
import { manualSync } from "@/server/dupr/sync";
import { deleteAccount, markNotificationsRead, removeAvatar, updateAvatar, updateProfile } from "@/server/members";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const refresh = (sessionId?: string) => {
  revalidatePath("/", "layout");
  if (sessionId) revalidatePath(`/traeninger/${sessionId}`);
};

export type BookingAction = "book" | "waitlist" | "accept" | "cancel";

export async function bookingAction(sessionId: string, action: BookingAction): Promise<ActionResult> {
  const actor = toActor(await requireUser());
  const messages: Record<BookingAction, string> = {
    book: "Du er booket.",
    waitlist: "Du er skrevet på ventelisten.",
    accept: "Pladsen er din.",
    cancel: "Din tilmelding er afmeldt.",
  };
  const res = await toActionResult(async () => {
    if (typeof sessionId !== "string" || sessionId.length > 64) throw new Error("bad id");
    if (action === "book") await bookSession(actor, sessionId);
    else if (action === "waitlist") await joinWaitlist(actor, sessionId);
    else if (action === "accept") await acceptOffer(actor, sessionId);
    else if (action === "cancel") await cancelBooking(actor, sessionId);
    else throw new Error("bad action");
  }, messages[action]);
  refresh(sessionId);
  return res;
}

export async function syncNowAction(): Promise<ActionResult<{ result: string }>> {
  const actor = toActor(await requireUser());
  const res = await toActionResult(async () => {
    const r = await manualSync(actor);
    return { result: r.result };
  });
  refresh();
  if (res.ok) {
    const map: Record<string, string> = {
      SUCCESS: "Din rating er opdateret fra DUPR.",
      NO_CHANGE: "Synkroniseret. Din rating er uændret.",
      NO_RATING: "Synkroniseret, men DUPR har endnu ingen rating for dig.",
      FAILED: "DUPR svarede ikke. Vi prøver igen automatisk.",
      RATE_LIMITED: "DUPR er travl lige nu. Vi prøver igen om lidt.",
      REVOKED: "Adgangen til din DUPR-profil er tilbagekaldt. Kobl den til igen.",
      UNAVAILABLE: "DUPR-forbindelsen er ikke aktiv lige nu.",
    };
    const ok = ["SUCCESS", "NO_CHANGE", "NO_RATING"].includes(res.data!.result);
    return ok ? { ok: true, data: res.data, message: map[res.data!.result] } : { ok: false, code: "INTEGRATION_UNAVAILABLE", message: map[res.data!.result] };
  }
  return res;
}

export async function unlinkDuprAction(): Promise<ActionResult> {
  const actor = toActor(await requireUser());
  const res = await toActionResult(() => unlink(actor), "DUPR-profilen er koblet fra.");
  refresh();
  return res;
}

export async function updateProfileAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = toActor(await requireUser());
  const res = await toActionResult(
    () => updateProfile(actor, { name: String(form.get("name") ?? ""), emailNotifications: form.get("emailNotifications") === "on" }),
    "Profilen er gemt.",
  );
  refresh();
  return res;
}

export async function uploadAvatarAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = toActor(await requireUser());
  const res = await toActionResult(async () => {
    const file = form.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      const { DomainError } = await import("@/lib/errors");
      throw new DomainError("VALIDATION", "Vælg et billede først.");
    }
    if (file.size > 5 * 1024 * 1024) {
      const { DomainError } = await import("@/lib/errors");
      throw new DomainError("VALIDATION", "Billedet må højst være 5 MB.");
    }
    await updateAvatar(actor, { bytes: Buffer.from(await file.arrayBuffer()), declaredType: file.type });
  }, "Profilbilledet er opdateret.");
  refresh();
  return res;
}

export async function removeAvatarAction(): Promise<ActionResult> {
  const actor = toActor(await requireUser());
  const res = await toActionResult(() => removeAvatar(actor), "Profilbilledet er fjernet.");
  refresh();
  return res;
}

export async function markReadAction() {
  const actor = toActor(await requireUser());
  await markNotificationsRead(actor);
  refresh();
}

export async function deleteAccountAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const u = await requireUser();
  const password = String(form.get("password") ?? "");
  if (String(form.get("confirm") ?? "") !== "SLET") {
    return { ok: false, code: "VALIDATION", message: "Skriv SLET for at bekræfte." };
  }
  // Re-authenticate with the current password before an irreversible action.
  try {
    await auth.api.verifyPassword({ body: { password }, headers: await headers() });
  } catch {
    return { ok: false, code: "VALIDATION", message: "Adgangskoden er forkert." };
  }
  const res = await toActionResult(() => deleteAccount(toActor(u)));
  if (!res.ok) return res;
  redirect("/login?slettet=1");
}
