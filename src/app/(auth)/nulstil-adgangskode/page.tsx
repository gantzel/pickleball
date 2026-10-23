import { Suspense } from "react";
import { ResetForm } from "@/components/auth-forms";

export const metadata = { title: "Vælg ny adgangskode" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-bold">Vælg ny adgangskode</h1>
      
      <div className="mt-6">
        <Suspense>
          <ResetForm />
        </Suspense>
      </div>
    </>
  );
}
