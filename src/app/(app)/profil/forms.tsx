"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { deleteAccountAction, removeAvatarAction, unlinkDuprAction, updateProfileAction, uploadAvatarAction } from "@/app/actions/member";
import { Avatar } from "@/components/avatar";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import type { ActionResult } from "@/lib/errors";

export function ProfileForm({ name, emailNotifications }: { name: string; emailNotifications: boolean }) {
  const [state, action] = useActionState(updateProfileAction, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="label">Visningsnavn</label>
        <input id="name" name="name" defaultValue={name} required minLength={2} maxLength={60} autoComplete="name" className="field" />
        <p className="hint">Vises for trænere og administratorer.</p>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="emailNotifications" defaultChecked={emailNotifications} className="mt-1 h-5 w-5 accent-[#1f5c4a]" />
        <span>
          <span className="font-medium">Send mig e-mails</span>
          <span className="block text-sm text-muted">Om bookinger, ledige pladser på ventelisten og ændringer i din rating.</span>
        </span>
      </label>
      <div className="flex items-center gap-4">
        <SubmitButton>Gem profil</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function AvatarForm({ name, avatarKey }: { name: string; avatarKey: string | null }) {
  const [state, action] = useActionState(uploadAvatarAction, null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeState, setRemoveState] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" width={88} height={88} className="h-[88px] w-[88px] rounded-full object-cover" />
      ) : (
        <Avatar name={name} avatarKey={avatarKey} size={88} />
      )}
      <form action={action} className="flex-1 space-y-2">
        <label htmlFor="avatar" className="label">Profilbillede</label>
        <input
          ref={input}
          id="avatar"
          name="avatar"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm file:mr-3 file:min-h-[40px] file:rounded-[10px] file:border file:border-line file:bg-surface file:px-3 file:font-semibold"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
        <p className="hint">JPG, PNG eller WebP, højst 5 MB. Billedet beskæres til et kvadrat, og metadata som GPS-position fjernes.</p>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Uploader…">Upload billede</SubmitButton>
          {avatarKey && (
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => start(async () => setRemoveState(await removeAvatarAction()))}>
              Fjern billede
            </button>
          )}
        </div>
        <FormMessage state={state ?? removeState} />
      </form>
    </div>
  );
}

export function UnlinkButton() {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  return confirm ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Uden DUPR kan du ikke booke rating-begrænsede træninger.</span>
      <button className="btn btn-danger" disabled={pending} onClick={() => start(async () => setState(await unlinkDuprAction()))}>
        Kobl fra
      </button>
      <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Fortryd</button>
      <FormMessage state={state} />
    </div>
  ) : (
    <button className="btn btn-ghost" onClick={() => setConfirm(true)}>Kobl DUPR fra</button>
  );
}

export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccountAction, null);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="del-pw" className="label">Din adgangskode</label>
        <input id="del-pw" name="password" type="password" required autoComplete="current-password" className="field max-w-sm" />
      </div>
      <div>
        <label htmlFor="del-confirm" className="label">Skriv SLET for at bekræfte</label>
        <input id="del-confirm" name="confirm" required autoComplete="off" className="field max-w-sm" />
      </div>
      <SubmitButton className="btn btn-danger" pendingLabel="Sletter…">Slet min konto permanent</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
