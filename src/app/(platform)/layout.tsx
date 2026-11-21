import Link from "next/link";
import { logoutAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between gap-3 text-sm">
        <Link className="text-primary underline" href="/dashboard">← Torna all&apos;app</Link>
        <form action={logoutAction}><Button variant="outline" size="sm" data-testid="admin-logout">Esci</Button></form>
      </div>
      {children}
    </div>
  );
}
