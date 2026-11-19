import { logoutAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Nessuna azienda" };

export default function NoOrganizationPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10 text-center">
      <p className="mb-4 text-2xl font-bold tracking-tight text-primary">NEXORA</p>
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">Nessuna azienda associata</h1>
        <p className="mb-4 text-sm text-muted">
          Il tuo account non appartiene ancora a nessuna organizzazione. Usa il codice di attivazione ricevuto oppure
          chiedi un invito a un amministratore della tua azienda.
        </p>
        <a className="mb-3 block text-sm text-primary underline" href="/attivazione">Ho un codice di attivazione</a>
        <form action={logoutAction}><Button variant="outline" className="w-full">Esci</Button></form>
      </div>
    </main>
  );
}
