import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { Card, PageHeader } from "@/components/ui/card";
import { CustomerForm } from "@/modules/clienti/ui/customer-form";
import { createCustomerAction } from "@/modules/clienti/actions";
import { createClient } from "@/server/supabase/server";
import { getSector, listFieldDefs, listPriceLists } from "@/modules/settore/queries";

export const metadata = { title: "Nuovo cliente" };

export default async function NewCustomerPage() {
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/clienti");
  const db = await createClient();
  const [fields, lists, { terms }] = await Promise.all([listFieldDefs(db, ctx.org.organizationId, "customer", true), listPriceLists(db, ctx.org.organizationId), getSector(db, ctx.org.organizationId)]);
  return (<><PageHeader title={`Nuovo ${terms.customer_singular.toLowerCase()}`} /><Card className="max-w-3xl p-6"><CustomerForm action={createCustomerAction} fields={fields} priceLists={lists.filter((l) => l.active)} /></Card></>);
}
