import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { ROLE_LABEL } from "@/server/auth/permissions";
import { removeAvatarAction, updateProfileAction } from "@/modules/impostazioni/actions";
import { ActionForm, AvatarForm } from "@/modules/impostazioni/ui/forms";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · Profilo" };

export default async function ProfileSettingsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const { data: p } = await db.from("profiles").select("full_name, job_title, avatar_path").eq("id", ctx.userId).maybeSingle();
  const url = p?.avatar_path ? (await db.storage.from("avatars").createSignedUrl(p.avatar_path as string, 3600)).data?.signedUrl : null;
  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <Card>
        <ActionForm action={updateProfileAction} successMessage="Profilo salvato">
          <div className="sm:col-span-2"><Label htmlFor="full_name">Nome e cognome *</Label><Input id="full_name" name="full_name" required defaultValue={(p?.full_name as string) ?? ""} /></div>
          <div className="sm:col-span-2"><Label htmlFor="job_title">Ruolo in azienda</Label><Input id="job_title" name="job_title" defaultValue={(p?.job_title as string) ?? ""} placeholder="Es. Responsabile commerciale" /></div>
          <div><Label htmlFor="email">Email di accesso</Label><Input id="email" value={ctx.email ?? ""} readOnly disabled /></div>
          <div><Label htmlFor="role">Permessi in {ctx.org.name}</Label><Input id="role" value={ROLE_LABEL[ctx.org.role]} readOnly disabled /></div>
        </ActionForm>
        <p className="mt-4 text-xs text-muted">L&apos;email e il ruolo di accesso non si modificano da qui: il ruolo lo assegna il titolare dal Team.</p>
      </Card>
      <Card className="h-fit">
        <h2 className="mb-3 font-medium">Immagine profilo</h2>
        <div className="mb-3 flex items-center gap-3"><Avatar name={p?.full_name as string} url={url} size={64} /><span className="text-sm text-muted">{url ? "Visibile ai colleghi." : "Nessuna immagine: vengono mostrate le iniziali."}</span></div>
        <div className="space-y-3">
          <AvatarForm />
          {url && <form action={removeAvatarAction}><Button variant="ghost" size="sm">Rimuovi immagine</Button></form>}
        </div>
      </Card>
    </div>
  );
}
