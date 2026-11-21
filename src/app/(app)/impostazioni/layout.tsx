import { SettingsNav } from "@/components/layout/settings-nav";
import { PageHeader } from "@/components/ui/card";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Impostazioni" />
      <SettingsNav />
      {children}
    </>
  );
}
