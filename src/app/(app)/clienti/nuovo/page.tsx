import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PageHeader } from "@/components/ui/card";
import { CustomerForm } from "@/modules/clienti/ui/customer-form";
import { createCustomerAction } from "@/modules/clienti/actions";

export const metadata = { title: "Nuovo cliente" };

export default async function NewCustomerPage() {
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/clienti");
  return (<><PageHeader title="Nuovo cliente" /><CustomerForm action={createCustomerAction} /></>);
}
