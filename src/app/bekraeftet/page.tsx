import Link from "next/link";
import { redirect } from "next/navigation";
import { ResendVerification } from "@/components/auth-forms";
import { Logo } from "@/components/logo";
import { getCurrentUser } from "@/server/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bekræft e-mail" };

/** Landing page for the email-verification link. On success the member is signed in and sent on. */
export default async function Confirmed({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!error && (await getCurrentUser())) redirect("/profil?velkommen=1#dupr");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col px-5 py-8">
      <Link href="/login" className="self-start rounded-md"><Logo /></Link>
      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-3xl font-bold">{error ? "Linket virker ikke" : "Bekræft din e-mail"}</h1>
        <p className="mb-6 mt-2 text-muted">
          {error
            ? "Linket er udløbet eller allerede brugt. Skriv din e-mail, så sender vi et nyt."
            : "Åbn linket i den mail, vi har sendt dig. Har du allerede bekræftet, kan du logge ind."}
        </p>
        <ResendVerification />
        <p className="mt-4 text-center text-sm"><Link href="/login" className="link">Gå til log ind</Link></p>
      </div>
    </main>
  );
}
