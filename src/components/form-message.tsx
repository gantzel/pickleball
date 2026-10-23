import type { ActionResult } from "@/lib/errors";

/** Polite live region for action feedback. */
export function FormMessage({ state }: { state: ActionResult<unknown> | null | undefined }) {
  return (
    <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm font-medium ${state?.ok ? "text-court" : "text-alert"}`}>
      {state?.message ?? ""}
    </p>
  );
}
