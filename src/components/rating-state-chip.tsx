import { formatRating } from "@/lib/format";
import type { RatingState } from "@/server/eligibility";
import { Chip } from "./status-chip";

export function RatingStateChip({ state }: { state: RatingState }) {
  switch (state.kind) {
    case "VERIFIED":
      return <Chip tone={state.warning ? "wait" : "go"}><span className="num">{formatRating(state.rating)}</span></Chip>;
    case "STALE":
      return <Chip tone="alert">Forældet{state.rating !== null ? ` (${formatRating(state.rating)})` : ""}</Chip>;
    case "NOT_LINKED":
      return <Chip>Ikke koblet</Chip>;
    case "REVOKED":
      return <Chip tone="alert">Tilbagekaldt</Chip>;
    case "NO_RATING":
      return <Chip tone="lock">Ingen rating</Chip>;
    case "INTEGRATION_UNAVAILABLE":
      return <Chip tone="lock">Ikke verificerbar</Chip>;
  }
}
