"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

function danish(err: AuthError): string {
  if (!err) return "Noget gik galt. Prøv igen.";
  if (err.status === 429) return "For mange forsøg. Vent et øjeblik og prøv igen.";
  switch (err.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Forkert e-mail eller adgangskode.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Der findes allerede en konto med den e-mail.";
    case "PASSWORD_TOO_SHORT":
      return "Adgangskoden skal være mindst 10 tegn.";
    case "PASSWORD_TOO_LONG":
      return "Adgangskoden er for lang.";
    case "INVALID_EMAIL":
      return "Skriv en gyldig e-mailadresse.";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "Linket er udløbet eller ugyldigt. Bed om et nyt.";
    case "EMAIL_NOT_VERIFIED":
      return "Du skal bekræfte din e-mail, før du kan logge ind. Vi har sendt et nyt link.";
    default:
      return "Noget gik galt. Prøv igen.";
  }
}

function ErrorText({ text }: { text: string | null }) {
  return (
    <p role="alert" className="min-h-[1.25rem] text-sm font-medium text-alert">
      {text ?? ""}
    </p>
  );
}

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        const { error } = await authClient.signIn.email({ email: String(f.get("email")), password: String(f.get("password")), callbackURL: "/bekraeftet" });
        setPending(false);
        if (error) return setError(danish(error));
        router.replace(safeNext(sp.get("next")));
        router.refresh();
      }}
    >
      {sp.get("slettet") && <p role="status" className="rounded-[10px] bg-court-soft p-3 text-sm font-medium text-court">Din konto er slettet.</p>}
      {sp.get("nulstillet") && <p role="status" className="rounded-[10px] bg-court-soft p-3 text-sm font-medium text-court">Din adgangskode er ændret. Log ind med den nye.</p>}
      <div>
        <label htmlFor="email" className="label">E-mail</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field" />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="label">Adgangskode</label>
          <Link href="/glemt-adgangskode" className="link text-sm">Glemt?</Link>
        </div>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="field" />
      </div>
      <ErrorText text={error} />
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Logger ind…" : "Log ind"}</button>
      <p className="text-center text-sm">
        Ny i klubben? <Link href="/opret" className="link">Opret en konto</Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (sentTo) return <CheckEmail email={sentTo} />;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const password = String(f.get("password"));
        if (password !== String(f.get("password2"))) return setError("Adgangskoderne er ikke ens.");
        setPending(true);
        setError(null);
        const email = String(f.get("email")).trim();
        const { error } = await authClient.signUp.email({ name: String(f.get("name")).trim(), email, password, callbackURL: "/bekraeftet" });
        setPending(false);
        if (error) return setError(danish(error));
        setSentTo(email);
      }}
    >
      <div>
        <label htmlFor="name" className="label">Navn</label>
        <input id="name" name="name" required minLength={2} maxLength={60} autoComplete="name" className="field" />
      </div>
      <div>
        <label htmlFor="email" className="label">E-mail</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Adgangskode</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="field" aria-describedby="pw-hint" />
        <p id="pw-hint" className="hint">Mindst 10 tegn.</p>
      </div>
      <div>
        <label htmlFor="password2" className="label">Gentag adgangskode</label>
        <input id="password2" name="password2" type="password" required minLength={10} autoComplete="new-password" className="field" />
      </div>
      <ErrorText text={error} />
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Opretter…" : "Opret konto"}</button>
      <p className="text-sm text-muted">
        Læs hvordan vi behandler dine data i <Link href="/privatliv" className="link">privatlivspolitikken</Link>.
      </p>
      <p className="text-center text-sm">
        Har du allerede en konto? <Link href="/login" className="link">Log ind</Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (sent) {
    return <p role="status" className="rounded-[10px] bg-court-soft p-4 font-medium text-court">Hvis der findes en konto med den e-mail, har vi sendt et link til at vælge en ny adgangskode. Linket virker i 1 time.</p>;
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        const { error } = await authClient.requestPasswordReset({ email: String(f.get("email")), redirectTo: "/nulstil-adgangskode" });
        setPending(false);
        if (error && error.status === 429) return setError(danish(error));
        setSent(true); // Same answer whether or not the account exists.
      }}
    >
      <div>
        <label htmlFor="email" className="label">E-mail</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field" />
      </div>
      <ErrorText text={error} />
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Sender…" : "Send link"}</button>
      <p className="text-center text-sm"><Link href="/login" className="link">Tilbage til log ind</Link></p>
    </form>
  );
}

export function ResetForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token");
  const [error, setError] = useState<string | null>(sp.get("error") ? danish({ code: "INVALID_TOKEN" }) : null);
  const [pending, setPending] = useState(false);
  if (!token) return <p className="text-alert">Linket mangler eller er ugyldigt. <Link href="/glemt-adgangskode" className="link">Bed om et nyt</Link>.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const pw = String(f.get("password"));
        if (pw !== String(f.get("password2"))) return setError("Adgangskoderne er ikke ens.");
        setPending(true);
        const { error } = await authClient.resetPassword({ newPassword: pw, token });
        setPending(false);
        if (error) return setError(danish(error));
        router.replace("/login?nulstillet=1");
      }}
    >
      <div>
        <label htmlFor="password" className="label">Ny adgangskode</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="field" />
        <p className="hint">Mindst 10 tegn. Du bliver logget ud alle andre steder.</p>
      </div>
      <div>
        <label htmlFor="password2" className="label">Gentag ny adgangskode</label>
        <input id="password2" name="password2" type="password" required minLength={10} autoComplete="new-password" className="field" />
      </div>
      <ErrorText text={error} />
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Gemmer…" : "Gem ny adgangskode"}</button>
    </form>
  );
}

/** Shown after sign-up: the account works once the emailed link is clicked. */
export function CheckEmail({ email }: { email: string }) {
  return (
    <div className="space-y-4">
      <div role="status" className="rounded-[12px] bg-court-soft p-4">
        <p className="font-semibold text-court">Tjek din e-mail</p>
        <p className="mt-1 text-sm">
          Vi har sendt et link til <strong>{email}</strong>. Klik på det for at aktivere din konto. Linket virker i 24 timer.
        </p>
      </div>
      <p className="text-sm text-muted">Kan du ikke finde mailen? Tjek spam, eller send et nyt link.</p>
      <ResendVerification defaultEmail={email} />
    </div>
  );
}

export function ResendVerification({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const email = String(new FormData(e.currentTarget).get("email"));
        setPending(true);
        const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/bekraeftet" });
        setPending(false);
        if (error?.status === 429) return setState({ ok: false, text: danish(error) });
        // Same answer whether or not the account exists.
        setState({ ok: true, text: "Hvis der findes en ubekræftet konto med den e-mail, har vi sendt et nyt link." });
      }}
    >
      <div>
        <label htmlFor="resend-email" className="label">E-mail</label>
        <input id="resend-email" name="email" type="email" required defaultValue={defaultEmail} autoComplete="email" className="field" />
      </div>
      <button className="btn btn-secondary w-full" disabled={pending}>{pending ? "Sender…" : "Send nyt link"}</button>
      <p role="status" className={`min-h-[1.25rem] text-sm font-medium ${state?.ok ? "text-court" : "text-alert"}`}>{state?.text ?? ""}</p>
    </form>
  );
}
