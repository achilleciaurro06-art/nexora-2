import { requireContextOrUser, assertPlatformAdmin } from "@/modules/amministrazione/guard";
import { setOrganizationStatusAction } from "@/modules/amministrazione/actions";
import { CodeForm } from "@/modules/amministrazione/ui/code-form";
import { loadPlatformOverview } from "@/modules/amministrazione/queries";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Amministrazione piattaforma" };

export default async function AdminPage() {
  const user = await requireContextOrUser();
  await assertPlatformAdmin(user.id);
  const { codes, orgs } = await loadPlatformOverview();
  return (
    <>
      <PageHeader title="Amministrazione piattaforma" description="Solo per amministratori NEXORA. Le azioni qui usano privilegi elevati." />
      <h2 className="mb-2 font-medium">Nuovo codice di attivazione</h2>
      <Card><CodeForm /></Card>

      <h2 className="mb-2 mt-8 font-medium">Codici</h2>
      <Table>
        <thead><tr><th>Email</th><th>Nota</th><th>Scadenza</th><th>Usi</th></tr></thead>
        <tbody>
          {codes.length === 0 && <tr><td colSpan={4} className="text-muted">Nessun codice.</td></tr>}
          {codes.map((c) => (
            <tr key={c.id}><td>{c.bound_email ?? "—"}</td><td>{c.note || "—"}</td><td>{new Date(c.expires_at).toLocaleDateString("it-IT")}</td><td>{c.used_count}/{c.max_uses}</td></tr>
          ))}
        </tbody>
      </Table>

      <h2 className="mb-2 mt-8 font-medium">Aziende</h2>
      <Table>
        <thead><tr><th>Nome</th><th>Creata il</th><th>Stato</th><th /></tr></thead>
        <tbody>
          {orgs.length === 0 && <tr><td colSpan={4} className="text-muted">Nessuna azienda.</td></tr>}
          {orgs.map((o) => (
            <tr key={o.id}>
              <td>{o.name}</td><td>{new Date(o.created_at).toLocaleDateString("it-IT")}</td>
              <td><Badge>{o.status === "active" ? "Attiva" : "Sospesa"}</Badge></td>
              <td className="text-right">
                <form action={setOrganizationStatusAction.bind(null, o.id)}>
                  <input type="hidden" name="status" value={o.status === "active" ? "suspended" : "active"} />
                  <Button size="sm" variant="outline">{o.status === "active" ? "Sospendi" : "Riattiva"}</Button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
