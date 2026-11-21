import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { saveTemplateAction } from "@/modules/settore/actions";
import { TemplateForm } from "@/modules/settore/ui/template-form";
import { parseOrgSettings } from "@/modules/impostazioni/settings";

export const metadata = { title: "Nuovo modello di preventivo" };

export default async function NewTemplatePage() {
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/catalogo/modelli");
  const { data: org } = await (await createClient()).from("organizations").select("settings").eq("id", ctx.org.organizationId).maybeSingle();
  return <TemplateForm action={saveTemplateAction.bind(null, null)} defaultVat={String(parseOrgSettings(org?.settings).quotes.default_vat_rate)} />;
}
