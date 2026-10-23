import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Log ind" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-bold">Log ind</h1>
      <p className="mb-6 mt-2 text-muted">Book træninger, der passer til din DUPR-rating.</p>
      <div className="mt-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </>
  );
}
