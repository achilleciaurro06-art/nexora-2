import Link from "next/link";
import { LoginForm } from "@/modules/auth/ui/forms";

export const metadata = { title: "Accesso" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Accedi</h1>
      <p className="mb-6 text-sm text-muted">Bentornato: entra nel tuo spazio di lavoro.</p>
      <LoginForm />
      <p className="mt-4 text-center text-sm text-muted">
        Hai un codice di attivazione? <Link className="text-primary underline" href="/attivazione">Attiva la tua azienda</Link>
      </p>
    </>
  );
}
