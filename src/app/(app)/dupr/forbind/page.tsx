import Link from "next/link";
import { redirect } from "next/navigation";
import { activeProvider } from "@/server/dupr/provider";
import { DuprSsoFrame } from "./sso-frame";

export const dynamic = "force-dynamic";

/** Hosts DUPR's own login page in a frame; DUPR hands the result back to this window. */
export default async function ConnectDuprPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const embed = activeProvider()?.ssoEmbed?.();
  if (!state || !embed) redirect("/profil?dupr_error=INTEGRATION_UNAVAILABLE#dupr");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Kobl DUPR til</h1>
        <p className="mt-1 text-muted">
          Log ind med din DUPR-konto herunder, og giv tilladelse. Vi får dit DUPR-ID, dit navn og din rating, aldrig din adgangskode.
        </p>
      </div>
      <DuprSsoFrame src={embed.url} origin={embed.origin} state={state} />
      <p className="text-sm text-muted">
        Har du ikke en DUPR-konto? Opret den gratis hos DUPR, og kom tilbage hertil. <Link href="/profil#dupr" className="link">Tilbage til profilen</Link>
      </p>
    </div>
  );
}
