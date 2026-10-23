import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getCurrentUser } from "@/server/current-user";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside aria-hidden="true" className="relative hidden overflow-hidden bg-court lg:block">
        {/* A full court seen from above: boundary, net and kitchen lines. */}
        <div className="absolute inset-12 rounded-[4px] border-[3px] border-white/35">
          <div className="absolute inset-x-0 top-1/2 border-t-[3px] border-white/60" />
          <div className="absolute inset-x-0 top-[34%] border-t-[3px] border-white/25" />
          <div className="absolute inset-x-0 top-[66%] border-t-[3px] border-white/25" />
          <div className="absolute bottom-0 left-1/2 top-[66%] border-l-[3px] border-white/25" />
          <div className="absolute left-1/2 top-0 h-[34%] border-l-[3px] border-white/25" />
          <div className="absolute left-[62%] top-[22%] h-7 w-7 rounded-full border-2 border-ink bg-ball" />
        </div>
        <p className="absolute bottom-16 left-16 right-16 max-w-md font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-white">
          Træn med spillere på dit niveau. Din DUPR-rating viser vejen.
        </p>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/login" className="self-start rounded-md"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <Link href="/privatliv" className="link self-start text-sm">Privatliv og data</Link>
      </main>
    </div>
  );
}
