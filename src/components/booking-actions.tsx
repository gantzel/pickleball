"use client";

import { useState, useTransition } from "react";
import { bookingAction, type BookingAction } from "@/app/actions/member";
import type { ActionResult } from "@/lib/errors";
import { toast } from "./toaster";

type Code = "AVAILABLE" | "FULL_WAITLIST" | "OFFERED" | "WAITLISTED" | "BOOKED" | string;

/** Booking controls. The server re-checks every rule; this only picks which buttons to show. */
export function BookingActions({ sessionId, code, compact = false, full = false, childId = null, childName }: { sessionId: string; code: Code; compact?: boolean; full?: boolean; childId?: string | null; childName?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = (a: BookingAction) =>
    start(async () => {
      setConfirming(false);
      const r = await bookingAction(sessionId, a, childId);
      setResult(r.ok ? null : r);
      if (r.message) toast(r.ok, r.message);
    });

  const size = full ? "btn w-full" : compact ? "btn" : "btn w-full sm:w-auto";
  let controls: React.ReactNode = null;

  if (code === "AVAILABLE") {
    controls = (
      <button className={`${size} btn-primary`} disabled={pending} onClick={() => run("book")}>
        {pending ? "Booker…" : childName ? `Book plads til ${childName}` : "Book plads"}
      </button>
    );
  } else if (code === "FULL_WAITLIST") {
    controls = (
      <button className={`${size} btn-secondary`} disabled={pending} onClick={() => run("waitlist")}>
        {pending ? "Skriver op…" : childName ? `Skriv ${childName} på ventelisten` : "Skriv mig på ventelisten"}
      </button>
    );
  } else if (code === "OFFERED") {
    controls = (
      <div className="flex flex-wrap gap-2">
        <button className={`${size} btn-primary`} disabled={pending} onClick={() => run("accept")}>
          Tag pladsen
        </button>
        <button className={`${size} btn-ghost`} disabled={pending} onClick={() => run("cancel")}>
          Afslå
        </button>
      </div>
    );
  } else if (code === "BOOKED" || code === "WAITLISTED") {
    const label = code === "BOOKED" ? "Afmeld" : "Forlad ventelisten";
    controls = confirming ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{code === "BOOKED" ? (childName ? `Afmeld ${childName}s plads?` : "Afmeld din plads?") : "Forlad ventelisten?"}</span>
        <button className="btn btn-danger" disabled={pending} onClick={() => run("cancel")}>
          {pending ? "Afmelder…" : `Ja, ${label.toLowerCase()}`}
        </button>
        <button className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Fortryd
        </button>
      </div>
    ) : (
      <button className={`${size} btn-secondary`} onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className={`flex flex-col items-stretch gap-1 ${full ? "" : "sm:items-end"}`}>
      {controls}
      <p role="status" aria-live="polite" className={`text-sm font-medium ${result?.ok ? "text-court" : "text-alert"}`}>
        {result?.message ?? ""}
      </p>
    </div>
  );
}
