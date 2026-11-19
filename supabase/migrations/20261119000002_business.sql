-- NEXORA 2.0 – 02 dominio operativo: clienti, preventivi, attività, documenti.
-- Ogni figlio referenzia il padre con chiave composta (id, organization_id): impossibile il riferimento cross-tenant.

-- ---------------------------------------------------------------- clienti
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  vat_number text,
  tax_code text,
  email text,
  phone text,
  address_line text,
  city text,
  province text,
  postal_code text,
  country text not null default 'IT',
  status text not null default 'active' check (status in ('lead', 'active', 'inactive')),
  notes text,
  tags text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index customers_org_name_idx on public.customers (organization_id, name) where deleted_at is null;

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  full_name text not null,
  job_title text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index customer_contacts_idx on public.customer_contacts (organization_id, customer_id);

-- ---------------------------------------------------------------- preventivi
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  year int not null,
  seq int not null,
  number text not null,
  title text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  issue_date date not null default current_date,
  valid_until date,
  subtotal_cents bigint not null default 0,
  vat_cents bigint not null default 0,
  total_cents bigint not null default 0,
  notes text,
  terms text,
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, year, seq),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id)
);
create index quotes_org_idx on public.quotes (organization_id, issue_date desc) where deleted_at is null;
create index quotes_customer_idx on public.quotes (organization_id, customer_id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quote_id uuid not null,
  position int not null default 0,
  description text not null,
  quantity numeric(12, 3) not null default 1 check (quantity >= 0),
  unit_price_cents bigint not null default 0,
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  vat_rate numeric(5, 2) not null default 22 check (vat_rate between 0 and 100),
  line_net_cents bigint generated always as
    (round(quantity * unit_price_cents * (1 - discount_percent / 100))::bigint) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete cascade
);
create index quote_items_idx on public.quote_items (organization_id, quote_id, position);

-- numerazione progressiva senza buchi per organizzazione/anno (stessa transazione dell'insert)
create function private.next_quote_number(p_org uuid, p_year int) returns int
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  insert into private.quote_counters as c (organization_id, year, last_number)
  values (p_org, p_year, 1)
  on conflict (organization_id, year) do update set last_number = c.last_number + 1
  returning last_number into v;
  return v;
end $$;
revoke all on function private.next_quote_number(uuid, int) from public, anon;
grant execute on function private.next_quote_number(uuid, int) to authenticated, service_role;

create function private.quotes_assign_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.year := extract(year from new.issue_date)::int;
  new.seq := private.next_quote_number(new.organization_id, new.year);
  new.number := new.year || '/' || lpad(new.seq::text, 4, '0');
  return new;
end $$;
create trigger quotes_assign_number before insert on public.quotes
  for each row execute function private.quotes_assign_number();

-- numero e anno non modificabili dopo l'emissione
create function private.quotes_lock_number() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.year := old.year; new.seq := old.seq; new.number := old.number;
  return new;
end $$;
create trigger quotes_lock_number before update on public.quotes
  for each row execute function private.quotes_lock_number();

-- ricalcolo totali
create function private.recalc_quote(p_quote uuid) returns void
language sql security definer set search_path = '' as $$
  update public.quotes q set
    subtotal_cents = coalesce(t.net, 0),
    vat_cents = coalesce(t.vat, 0),
    total_cents = coalesce(t.net, 0) + coalesce(t.vat, 0)
  from (
    select sum(line_net_cents) as net,
           sum(round(line_net_cents * vat_rate / 100))::bigint as vat
    from public.quote_items where quote_id = p_quote
  ) t
  where q.id = p_quote;
$$;
revoke all on function private.recalc_quote(uuid) from public, anon, authenticated;

create function private.quote_items_recalc() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.recalc_quote(old.quote_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform private.recalc_quote(new.quote_id); end if;
  return null;
end $$;
revoke all on function private.quote_items_recalc() from public, anon, authenticated;
create trigger quote_items_recalc after insert or update or delete on public.quote_items
  for each row execute function private.quote_items_recalc();

-- ---------------------------------------------------------------- attività e promemoria
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  completed_at timestamptz,
  assignee_id uuid references auth.users (id) on delete set null,
  customer_id uuid,
  quote_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete set null (quote_id)
);
create index tasks_org_status_idx on public.tasks (organization_id, status, due_at) where deleted_at is null;
create index tasks_assignee_idx on public.tasks (organization_id, assignee_id);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  remind_at timestamptz not null,
  channel text not null default 'in_app' check (channel in ('in_app', 'email')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete cascade
);
create index reminders_due_idx on public.reminders (remind_at) where status = 'pending';
create index reminders_org_idx on public.reminders (organization_id, task_id);

-- ---------------------------------------------------------------- documenti
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  customer_id uuid,
  quote_id uuid,
  analysis_status text not null default 'none' check (analysis_status in ('none', 'pending', 'done', 'failed')),
  uploaded_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (storage_path),
  check (storage_path like organization_id::text || '/%'),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete set null (quote_id)
);
create index documents_org_idx on public.documents (organization_id, created_at desc) where deleted_at is null;

-- ---------------------------------------------------------------- trigger comuni
do $$
declare t text;
begin
  foreach t in array array['customers','customer_contacts','quotes','quote_items','tasks','reminders','documents']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.prevent_org_change()', t || '_org_immutable', t);
  end loop;
end $$;
