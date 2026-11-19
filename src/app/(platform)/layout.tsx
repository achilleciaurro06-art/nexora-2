import Link from "next/link";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <p className="mb-6 text-sm"><Link className="text-primary underline" href="/dashboard">← Torna all&apos;app</Link></p>
      {children}
    </div>
  );
}
