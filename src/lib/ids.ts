import { z } from "zod";

/** Gli id nelle Server Actions arrivano dal client: vanno sempre validati prima dell'uso. */
export const uuid = z.uuid();
export function isUuid(v: unknown): v is string {
  return uuid.safeParse(v).success;
}
