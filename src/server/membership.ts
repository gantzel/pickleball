/**
 * Club membership (bylaws § 3: membership is valid once the fee is paid).
 *
 * A new account is PENDING until an admin approves it. Only ACTIVE members
 * can book, join waitlists or accept offers — for themselves and for their
 * children. An optional "paid through" date makes an active membership lapse
 * automatically when it passes. Admins can always book.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { user, type User } from "@/db/schema";
import { CLUB_TZ } from "@/lib/format";
import { DomainError } from "@/lib/errors";

export type MembershipState = "ACTIVE" | "PENDING" | "ENDED" | "LAPSED";

/** Today's date in club time, YYYY-MM-DD (comparable with paid_through). */
export const clubToday = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: CLUB_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Fees are collected per half-year (bylaws § 3): the last day of the current half. */
export function endOfHalfYear(now = new Date()) {
  const [y, m] = clubToday(now).split("-").map(Number);
  return m <= 6 ? `${y}-06-30` : `${y}-12-31`;
}

export function membershipState(u: Pick<User, "role" | "membershipStatus" | "paidThrough">, now = new Date()): MembershipState {
  if (u.role === "ADMIN") return "ACTIVE";
  if (u.membershipStatus === "PENDING") return "PENDING";
  if (u.membershipStatus === "ENDED") return "ENDED";
  if (u.paidThrough && u.paidThrough < clubToday(now)) return "LAPSED";
  return "ACTIVE";
}

export function membershipMessage(state: MembershipState): string {
  switch (state) {
    case "PENDING":
      return "Din konto afventer godkendelse fra klubben. Du kan booke, så snart dit medlemskab er godkendt.";
    case "LAPSED":
      return "Dit kontingent er udløbet. Kontakt kassereren, så du kan booke igen.";
    case "ENDED":
      return "Dit medlemskab er afsluttet. Kontakt klubben, hvis du vil være medlem igen.";
    case "ACTIVE":
      return "Aktivt medlem.";
  }
}

export async function loadMembership(tx: Tx, userId: string, now = new Date()): Promise<MembershipState> {
  const [u] = await tx
    .select({ role: user.role, membershipStatus: user.membershipStatus, paidThrough: user.paidThrough })
    .from(user)
    .where(eq(user.id, userId));
  return u ? membershipState(u, now) : "ENDED";
}

export async function assertActiveMember(tx: Tx, userId: string, now = new Date()) {
  const state = await loadMembership(tx, userId, now);
  if (state !== "ACTIVE") throw new DomainError("NOT_ELIGIBLE", membershipMessage(state));
}
