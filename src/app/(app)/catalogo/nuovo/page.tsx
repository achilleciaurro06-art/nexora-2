import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { saveProductAction } from "@/modules/settore/actions";
import { ProductFields } from "@/modules/settore/ui/product-fields";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Nuovo prodotto o servizio" };

export default async function NewProductPage() {
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/catalogo");
  return <Card><ActionForm action={saveProductAction.bind(null, null)} submitLabel="Crea"><ProductFields /></ActionForm></Card>;
}
