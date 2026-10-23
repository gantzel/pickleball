import { Suspense } from "react";
import { ForgotForm } from "@/components/auth-forms";

export const metadata = { title: "Glemt adgangskode" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-bold">Glemt adgangskode</h1>
      <p className="mb-6 mt-2 text-muted">Skriv din e-mail, så sender vi et link.</p>
      <div className="mt-6">
        <Suspense>
          <ForgotForm />
        </Suspense>
      </div>
    </>
  );
}
