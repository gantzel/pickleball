/** Danish, Copenhagen-local formatting helpers (safe for server and client). */

export const CLUB_TZ = "Europe/Copenhagen";

const dateFmt = new Intl.DateTimeFormat("da-DK", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: CLUB_TZ,
});
const shortDateFmt = new Intl.DateTimeFormat("da-DK", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: CLUB_TZ,
});
const timeFmt = new Intl.DateTimeFormat("da-DK", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: CLUB_TZ,
});
const dateTimeFmt = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: CLUB_TZ,
});
const monthDayFmt = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  timeZone: CLUB_TZ,
});

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const formatDate = (d: Date) => cap(dateFmt.format(d));
export const formatShortDate = (d: Date) => cap(shortDateFmt.format(d));
export const formatTime = (d: Date) => timeFmt.format(d);
export const formatDateTime = (d: Date) => dateTimeFmt.format(d);
export const formatMonthDay = (d: Date) => monthDayFmt.format(d);
export const formatTimeRange = (a: Date, b: Date) => `${formatTime(a)}–${formatTime(b)}`;

/** DUPR ratings are shown with three decimals, Danish decimal comma. */
export function formatRating(r: number | null | undefined): string {
  if (r === null || r === undefined || Number.isNaN(r)) return "–";
  return r.toLocaleString("da-DK", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function formatRatingRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatRating(min)}–${formatRating(max)}`;
  if (min !== null) return `${formatRating(min)}+`;
  if (max !== null) return `op til ${formatRating(max)}`;
  return "Alle niveauer";
}

/** Label for a rating band; `maxExclusive` bands (levels) read "3,000 – under 3,500". */
export function formatBand(min: number | null, max: number | null, maxExclusive: boolean): string {
  if (!maxExclusive) return formatRatingRange(min, max);
  if (min !== null && max !== null) return `${formatRating(min)} – under ${formatRating(max)}`;
  if (min !== null) return `${formatRating(min)}+`;
  if (max !== null) return `under ${formatRating(max)}`;
  return "Alle niveauer";
}

type RuleLike =
  | { kind: "OPEN" | "ROSTER" | "DUPR_LINKED" }
  | { kind: "RATING"; min: number | null; max: number | null; maxExclusive: boolean };

/** Short Danish description of who may book. */
export function ruleRangeLabel(rule: RuleLike): string {
  switch (rule.kind) {
    case "OPEN":
      return "Åben for alle";
    case "ROSTER":
      return "Holdets deltagere";
    case "DUPR_LINKED":
      return "Kræver DUPR-profil";
    case "RATING":
      return formatBand(rule.min, rule.max, rule.maxExclusive);
  }
}

const rtf = new Intl.RelativeTimeFormat("da-DK", { numeric: "auto" });

export function formatRelative(d: Date, now = new Date()): string {
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  return formatDateTime(d);
}

export function pluralPlaces(n: number) {
  return n === 1 ? "1 plads" : `${n} pladser`;
}
