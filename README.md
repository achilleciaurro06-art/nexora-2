# NEXORA 2.0

Gestionale per PMI italiane. Next.js (App Router) · TypeScript · Tailwind · Supabase · Gemini · Vercel.
Progetto indipendente da NEXORA 1. Architettura: [docs/architettura.md](docs/architettura.md).

## Database
Migrazioni SQL in `supabase/migrations`. Test di isolamento multi-tenant:
`supabase/tests/run-local.sh` (Postgres locale usa-e-getta) – 42 controlli RLS/ruoli/numerazione.

## Sviluppo
```bash
cp .env.example .env.local   # compila le chiavi (mai committarle)
npm ci && npm run dev
npm run lint && npm run typecheck && npm test && npm run build
npm run db:test               # richiede un Postgres locale (vedi supabase/tests/run-local.sh)
```
Migrazioni: `supabase/migrations/*.sql` (applicate in ordine). La registrazione pubblica è disabilitata:
le aziende entrano con un codice di attivazione creato dalla console `/admin`.
