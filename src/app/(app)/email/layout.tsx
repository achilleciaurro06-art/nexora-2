import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { unreadCount } from "@/modules/email/queries";
import { PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { EmailNav } from "@/components/layout/email-nav";

export const metadata = { title: "Email" };

export default async function EmailLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const unread = await unreadCount(await createClient(), ctx.org.organizationId);
  return (
    <>
      <PageHeader title="Email" description="Le comunicazioni con i clienti, collegate alle schede, ai preventivi e alle attività."
        actions={can(ctx.org.role, "data:write") ? <Link href="/email/nuova" className={buttonVariants()}>Scrivi</Link> : null} />
      <EmailNav unread={unread} />
      {children}
    </>
  );
}
