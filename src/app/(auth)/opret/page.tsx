import { Suspense } from "react";
import { SignUpForm } from "@/components/auth-forms";

export const metadata = { title: "Opret konto" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-bold">Opret konto</h1>
      <p className="mb-6 mt-2 text-muted">Bagefter kobler du din DUPR-profil til, så vi kan se, hvilke træninger du kan booke.</p>
      <div className="mt-6">
        <Suspense>
          <SignUpForm />
        </Suspense>
      </div>
    </>
  );
}
