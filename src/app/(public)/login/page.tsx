import Link from "next/link";
import { LoginForm } from "@/modules/auth/ui/forms";

export const metadata = { title: "Accesso" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Accedi</h1>
      <LoginForm />
      <p className="mt-4 text-center text-sm text-muted">
        Hai un codice di attivazione? <Link className="text-primary underline" href="/attivazione">Attiva la tua azienda</Link>
      </p>
    </>
  );
}
