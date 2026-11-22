import { Logo, LogoMark } from "@/components/brand/logo";
import { DigitalTexture } from "@/components/brand/digital-texture";

/** Accesso, attivazione e inviti: composizione immersiva (≈55% visuale / ≈45% form) con transizione sfumata, senza linea divisoria. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[55fr_45fr]">
      {/* mobile: branding ridotto in alto, nessuna animazione */}
      <div className="flex h-20 items-center gap-3 bg-carbon px-5 lg:hidden"><Logo size={26} /></div>

      {/* desktop: area visuale */}
      <section aria-hidden className="nx-surface-dark relative hidden overflow-hidden lg:block">
        <DigitalTexture intensity="high" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_30%,rgba(23,71,232,0.28),transparent_70%)]" />
        <div className="relative z-10 flex h-full min-h-dvh flex-col justify-between p-12 xl:p-16">
          <Logo size={34} />
          <div className="max-w-md">
            <LogoMark size={132} sheen priority className="nx-mark-in mb-8" />
            <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight text-white xl:text-5xl">Il gestionale che lavora con te.</h2>
            <p className="mt-5 text-base leading-relaxed text-slate-300">Clienti, preventivi e attività in un unico posto, con un assistente AI che conosce la tua azienda e prepara il lavoro: tu confermi.</p>
          </div>
          <p className="text-xs text-slate-500">NEXORA · Gestionale per le PMI italiane</p>
        </div>
        {/* sfumatura verso l'area di accesso: nessun bordo netto */}
        <div className="absolute inset-y-0 right-0 w-40 bg-gradient-to-r from-transparent to-background" />
      </section>

      <section className="flex min-h-[calc(100dvh-5rem)] items-center justify-center bg-background px-5 py-10 lg:min-h-dvh lg:px-12">
        <div className="nx-rise w-full max-w-[400px]">
          <div className="rounded-xl border border-border bg-card p-7 shadow-card sm:p-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
