# NEXORA 2.0

Gestionale per PMI italiane. Next.js (App Router) · TypeScript · Tailwind · Supabase · Claude · Vercel.
Progetto indipendente da NEXORA 1. Architettura: [docs/architettura.md](docs/architettura.md).

## Database
Migrazioni SQL in `supabase/migrations`. Test di isolamento multi-tenant:
`supabase/tests/run-local.sh` (Postgres locale usa-e-getta) – 42 controlli RLS/ruoli/numerazione.
