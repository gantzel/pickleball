"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { duprLink, mockDuprPlayer } from "@/db/schema";
import { devToolsAllowed, env } from "@/lib/env";
import { requireUser } from "@/server/current-user";
import { signMockWebhook } from "@/server/dupr/mock";
import { syncLink } from "@/server/dupr/sync";

/** DEV/DEMO ONLY. Every action here 404s in production unless DEMO_MODE=true. */
async function guard() {
  if (!devToolsAllowed()) notFound();
  await requireUser();
}

const PlayerInput = z.object({
  id: z.string().regex(/^MOCK-[A-Z0-9-]{2,24}$/),
  doublesRating: z.union([z.literal(""), z.coerce.number().min(1).max(8.5)]).transform((v) => (v === "" ? null : v)),
  singlesRating: z.union([z.literal(""), z.coerce.number().min(1).max(8.5)]).transform((v) => (v === "" ? null : v)),
  failMode: z.enum(["NONE", "ERROR", "RATE_LIMIT", "REVOKED", "NO_RATING"]),
});

export async function saveMockPlayerAction(form: FormData) {
  await guard();
  const p = PlayerInput.parse(Object.fromEntries(form));
  await db.update(mockDuprPlayer).set(p).where(eq(mockDuprPlayer.id, p.id));
  revalidatePath("/dev/mock-dupr");
}

export async function createMockPlayerAction(form: FormData) {
  await guard();
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || "Testspiller";
  const id = `MOCK-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const r = z.coerce.number().min(1).max(8.5).catch(3.0).parse(form.get("doublesRating"));
  await db.insert(mockDuprPlayer).values({ id, name, doublesRating: r, singlesRating: Math.max(1, Math.round((r - 0.2) * 1000) / 1000) });
  revalidatePath("/dev/mock-dupr");
}

/** Simulates DUPR notifying us of a rating change — through the real webhook endpoint when a secret is set. */
export async function sendMockWebhookAction(form: FormData) {
  await guard();
  const id = String(form.get("id"));
  const secret = env().DUPR_WEBHOOK_SECRET;
  if (secret) {
    const body = JSON.stringify({ id: `mock-${Date.now()}`, topic: "RATING", duprIds: [id] });
    await fetch(new URL("/api/dupr/webhook", env().APP_URL), {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-signature": signMockWebhook(body, secret) },
      body,
    });
  } else {
    const links = await db.select({ id: duprLink.id }).from(duprLink).where(eq(duprLink.externalId, id));
    for (const l of links) await syncLink(l.id, "WEBHOOK");
  }
  revalidatePath("/", "layout");
}
