"use client";
import { useState, useTransition } from "react";
import { syncNowAction } from "@/app/actions/member";

/** Requests a fresh rating from DUPR. It can't set a rating — only re-fetch one. */
export function SyncButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncNowAction();
            setMsg({ ok: r.ok, text: r.message ?? "" });
          })
        }
        className={tone === "light" ? "btn border border-white/40 bg-white/10 text-white hover:bg-white/20" : "btn btn-secondary"}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={pending ? "animate-spin" : ""}>
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.8h-2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {pending ? "Henter fra DUPR…" : "Synkronisér nu"}
      </button>
      <p role="status" aria-live="polite" className={`text-sm ${tone === "light" ? (msg?.ok ? "text-ball" : "text-white") : msg?.ok ? "text-court" : "text-alert"}`}>
        {msg?.text ?? ""}
      </p>
    </div>
  );
}
