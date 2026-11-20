-- NEXORA 2.0 – 18 adattabilità per settore: settore e terminologia, campi personalizzati, catalogo prodotti/servizi,
-- listini, modelli di preventivo. Solo aggiunte (più la sostituzione di duplicate_quote per copiare i campi personalizzati).

-- ============================================================ 1. settore e terminologia
alter table public.organizations
  add column sector text not null default 'generic' check (sector in ('generic', 'rubinetterie', 'serramenti', 'edilizia', 'impianti', 'servizi'));
alter table public.organizations
  add column terminology jsonb not null default '{}'::jsonb check (jsonb_typeof(terminology) = 'object' and pg_column_size(terminology) < 2000);
grant update (sector, terminology) on public.organizations to authenticated;

-- ============================================================ 2. campi personalizzati
create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity text not null check (entity in ('customer', 'quote')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80),
  field_type text not null check (field_type in ('text', 'number', 'date', 'select', 'boolean')),
  options text[] not null default '{}' check (cardinality(options) <= 50),
  required boolean not null default false,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity, key),
  check (field_type <> 'select' or cardinality(options) >= 1)
);
create index custom_field_definitions_idx on public.custom_field_definitions (organization_id, entity, position);

alter table public.customers add column custom_values jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_values) = 'object' and pg_column_size(custom_values) < 20000);
alter table public.quotes add column custom_values jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_values) = 'object' and pg_column_size(custom_values) < 20000);
grant update (custom_values) on public.quotes to authenticated;

-- ============================================================ 3. catalogo prodotti e servizi
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'product' check (kind in ('product', 'service')),
  code text check (code is null or char_length(code) between 1 and 40),
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(coalesce(description, '')) <= 1000),
  category text check (char_length(coalesce(category, '')) <= 80),
  unit text not null default 'pz' check (char_length(unit) between 1 and 12),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0 and unit_price_cents <= 100000000000),
  vat_rate numeric(5, 2) not null default 22 check (vat_rate between 0 and 100),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index products_code_uniq on public.products (organization_id, lower(code)) where code is not null and deleted_at is null;
create index products_org_idx on public.products (organization_id, name) where deleted_at is null;

-- ============================================================ 4. listini
create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(coalesce(description, '')) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index price_lists_name_uniq on public.price_lists (organization_id, lower(name));

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  price_list_id uuid not null,
  product_id uuid not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0 and unit_price_cents <= 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (price_list_id, product_id),
  foreign key (price_list_id, organization_id) references public.price_lists (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete cascade
);
create index price_list_items_idx on public.price_list_items (organization_id, price_list_id);

alter table public.customers add column price_list_id uuid;
alter table public.customers add constraint customers_price_list_fk
  foreign key (price_list_id, organization_id) references public.price_lists (id, organization_id) on delete set null (price_list_id);

-- ============================================================ 5. modelli di preventivo
create table public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(coalesce(description, '')) <= 500),
  title text check (char_length(coalesce(title, '')) <= 200),
  notes text check (char_length(coalesce(notes, '')) <= 4000),
  terms text check (char_length(coalesce(terms, '')) <= 4000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 100 and pg_column_size(items) < 100000),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index quote_templates_idx on public.quote_templates (organization_id, name) where deleted_at is null;

-- ============================================================ RLS, trigger, audit
do $$
declare t text;
begin
  foreach t in array array['custom_field_definitions', 'products', 'price_lists', 'price_list_items', 'quote_templates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(organization_id))', t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.prevent_org_change()', t || '_org_immutable', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger()', t || '_audit', t);
  end loop;
  -- catalogo e modelli: chi può scrivere (titolare, amministratore, collaboratore); elimina solo titolare/amministratore
  foreach t in array array['products', 'quote_templates']
  loop
    execute format($f$create policy %1$I on public.%2$I for insert to authenticated
      with check (private.has_role(organization_id, array['owner','admin','member']) and created_by = (select auth.uid()))$f$, t || '_insert', t);
    execute format($f$create policy %1$I on public.%2$I for update to authenticated
      using (private.has_role(organization_id, array['owner','admin','member']))
      with check (private.has_role(organization_id, array['owner','admin','member']))$f$, t || '_update', t);
    execute format($f$create policy %1$I on public.%2$I for delete to authenticated
      using (private.has_role(organization_id, array['owner','admin']))$f$, t || '_delete', t);
  end loop;
  -- struttura (campi personalizzati, listini): solo titolare e amministratori
  foreach t in array array['custom_field_definitions', 'price_lists', 'price_list_items']
  loop
    execute format($f$create policy %1$I on public.%2$I for insert to authenticated
      with check (private.has_role(organization_id, array['owner','admin']))$f$, t || '_insert', t);
    execute format($f$create policy %1$I on public.%2$I for update to authenticated
      using (private.has_role(organization_id, array['owner','admin']))
      with check (private.has_role(organization_id, array['owner','admin']))$f$, t || '_update', t);
    execute format($f$create policy %1$I on public.%2$I for delete to authenticated
      using (private.has_role(organization_id, array['owner','admin']))$f$, t || '_delete', t);
  end loop;
end $$;
-- la chiave di un campo personalizzato non cambia dopo la creazione (i valori salvati ne dipendono)
create function private.custom_field_lock_key() returns trigger language plpgsql set search_path = '' as $$
begin
  new.key := old.key; new.entity := old.entity; new.field_type := old.field_type;
  return new;
end $$;
create trigger custom_field_definitions_lock before update on public.custom_field_definitions for each row execute function private.custom_field_lock_key();

-- ============================================================ duplicazione: copia anche i campi personalizzati
create or replace function public.duplicate_quote(p_quote uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  q public.quotes;
  v_items jsonb;
  v_validity int;
  v_valid date;
  v_new uuid;
begin
  select * into q from public.quotes where id = p_quote and deleted_at is null;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity, 'unit_price_cents', unit_price_cents,
                                               'discount_percent', discount_percent, 'vat_rate', vat_rate) order by position, created_at), '[]'::jsonb)
    into v_items from public.quote_items where quote_id = p_quote and organization_id = q.organization_id;
  select coalesce(nullif(settings -> 'quotes' ->> 'default_validity_days', '')::int, 30) into v_validity from public.organizations where id = q.organization_id;
  v_valid := case when v_validity > 0 then current_date + v_validity end;
  select public.save_quote(null, q.organization_id, q.customer_id, q.title, current_date, v_valid, q.notes, q.terms, v_items, null) into v_new;
  update public.quotes set custom_values = q.custom_values where id = v_new;
  return v_new;
end $$;
