import { formatInTimeZone } from "date-fns-tz";
import { CLUB_TZ } from "./format";

/** Date → value for <input type="datetime-local"> in Copenhagen time. */
export const toLocalInput = (d: Date | null | undefined) => (d ? formatInTimeZone(d, CLUB_TZ, "yyyy-MM-dd'T'HH:mm") : "");
