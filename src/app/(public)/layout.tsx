export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-2xl font-bold tracking-tight text-primary">NEXORA</p>
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">{children}</div>
    </main>
  );
}
