import "server-only";
import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Permission, Role } from "@/server/auth/permissions";

/**
 * Contesto di esecuzione di uno strumento. `db` è il client DELL'UTENTE (RLS attiva): anche uno strumento difettoso
 * non può leggere dati di altre organizzazioni o caselle non autorizzate. Le query filtrano comunque per organizzazione.
 */
export type ToolCtx = { db: SupabaseClient; orgId: string; userId: string; role: Role; now: Date; today: string };
export type Source = { label: string; href?: string };
export type ToolOutput = { data: unknown; sources?: Source[] };

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  /** Parametri in forma leggibile, mostrati al modello. */
  args: string;
  permission: Permission;
  schema: S;
  run(ctx: ToolCtx, args: z.output<S>): Promise<ToolOutput>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>;
export const defineTool = <S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> => t;
