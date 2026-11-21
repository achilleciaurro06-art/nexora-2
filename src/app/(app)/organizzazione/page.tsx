import { redirect } from "next/navigation";

/** La gestione del team vive ora in Impostazioni → Team. */
export default function OrganizationRedirect() {
  redirect("/impostazioni/team");
}
