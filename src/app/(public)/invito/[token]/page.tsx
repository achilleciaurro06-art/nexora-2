import { InvitationForm } from "@/modules/auth/ui/forms";

export const metadata = { title: "Invito" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Accetta l&apos;invito</h1>
      <p className="mb-4 text-sm text-muted">Imposta nome e password per entrare nell&apos;organizzazione.</p>
      <InvitationForm token={token} />
    </>
  );
}
