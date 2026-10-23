import { DomainError } from "@/lib/errors";

/** The authenticated principal on whose behalf a service call runs. */
export interface Actor {
  id: string;
  role: "MEMBER" | "ADMIN";
}

export function requireAdmin(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Du skal være logget ind.");
  if (actor.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Du har ikke adgang til denne funktion.");
}

export function requireActor(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Du skal være logget ind.");
}
