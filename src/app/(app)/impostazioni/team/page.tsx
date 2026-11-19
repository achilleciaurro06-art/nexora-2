import { requireContext } from "@/server/auth/session";
import { TeamSection } from "@/modules/organizzazioni/ui/team-section";

export const metadata = { title: "Impostazioni · Team" };

export default async function TeamSettingsPage() {
  return <TeamSection ctx={await requireContext()} />;
}
