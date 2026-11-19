import Link from "next/link";
import { ActivationForm } from "@/modules/auth/ui/forms";

export const metadata = { title: "Attivazione azienda" };

export default function ActivationPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Attiva la tua azienda</h1>
      <p className="mb-4 text-sm text-muted">La registrazione è riservata: serve un codice di attivazione.</p>
      <ActivationForm />
      <p className="mt-4 text-center text-sm text-muted">Hai già un account? <Link className="text-primary underline" href="/login">Accedi</Link></p>
    </>
  );
}
