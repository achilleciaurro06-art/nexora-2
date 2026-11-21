import { PageHeader } from "@/components/ui/card";
import { CatalogNav } from "@/components/layout/catalog-nav";

export const metadata = { title: "Catalogo" };

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Catalogo" description="Prodotti, servizi, listini e modelli per preparare i preventivi più in fretta." />
      <CatalogNav />
      {children}
    </>
  );
}
