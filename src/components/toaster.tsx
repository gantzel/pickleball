"use client";
import { useEffect, useState } from "react";

type Toast = { id: number; ok: boolean; text: string };

/** Page-level feedback that survives the list item it came from disappearing. */
export function toast(ok: boolean, text: string) {
  window.dispatchEvent(new CustomEvent("pbk:toast", { detail: { ok, text } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const { ok, text } = (e as CustomEvent<{ ok: boolean; text: string }>).detail;
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-2), { id, ok, text }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 6000);
    };
    window.addEventListener("pbk:toast", on);
    return () => window.removeEventListener("pbk:toast", on);
  }, []);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {items.map((t) => (
        <p key={t.id} className={`pointer-events-auto rounded-[12px] px-4 py-3 text-sm font-semibold shadow-[0_6px_20px_rgba(19,34,28,.18)] ${t.ok ? "bg-ink text-white" : "bg-alert text-white"}`}>
          {t.text}
        </p>
      ))}
    </div>
  );
}
