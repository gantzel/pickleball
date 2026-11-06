"use client";

import { useEffect, useRef, useState } from "react";

type Status = "waiting" | "saving" | "error";

/** Pulls the fields we need out of DUPR's postMessage, whether it arrives as an object or a JSON string. */
function readMessage(data: unknown): { userToken: string; refreshToken: string; duprId: string } | null {
  let d: unknown = data;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const inner = (o.data && typeof o.data === "object" ? o.data : o) as Record<string, unknown>;
  const { userToken, refreshToken, duprId } = inner;
  if (typeof userToken !== "string" || typeof refreshToken !== "string") return null;
  return { userToken, refreshToken, duprId: typeof duprId === "string" ? duprId : String(duprId ?? "") };
}

export function DuprSsoFrame({ src, origin, state }: { src: string; origin: string; state: string }) {
  const [status, setStatus] = useState<Status>("waiting");
  const done = useRef(false);

  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.origin !== origin || done.current) return; // only DUPR's own page may answer
      const msg = readMessage(e.data);
      if (!msg) return;
      done.current = true;
      setStatus("saving");
      try {
        const res = await fetch("/api/dupr/callback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state, ...msg }),
        });
        const body = (await res.json().catch(() => ({}))) as { redirect?: string };
        window.location.assign(body.redirect ?? "/profil?dupr_error=INTERNAL#dupr");
      } catch {
        setStatus("error");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, state]);

  if (status === "saving") {
    return <p role="status" className="panel p-6 font-medium">Forbinder din DUPR-profil …</p>;
  }
  if (status === "error") {
    return (
      <p role="alert" className="rounded-[10px] bg-alert-soft p-4 font-medium text-alert">
        Noget gik galt. <a href="/profil#dupr" className="link">Prøv igen fra din profil</a>.
      </p>
    );
  }
  return (
    <iframe
      src={src}
      title="Log ind med DUPR"
      allow="payment"
      className="h-[720px] w-full rounded-[16px] border border-line bg-white"
    />
  );
}
