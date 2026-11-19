-- NEXORA 2.0 – 11 storico delle analisi dei prezzi dei preventivi.
-- Le proposte attuabili (prezzo suggerito) restano in ai_suggestions (kind 'price_review'),
-- soggette ad approvazione dell'utente; qui si conserva l'esito completo di ogni analisi.

create table public.price_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quote_id uuid not null,
  items jsonb not null,
  model text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete cascade,
  check (jsonb_typeof(items) = 'array')
);
create index price_analyses_idx on public.price_analyses (organization_id, quote_id, created_at desc);
alter table public.price_analyses enable row level security;
create policy price_analyses_select on public.price_analyses for select to authenticated
  using (private.is_member(organization_id));
create policy price_analyses_insert on public.price_analyses for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin', 'member']) and created_by = (select auth.uid()));
create policy price_analyses_delete on public.price_analyses for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));
revoke update, truncate on public.price_analyses from authenticated;
