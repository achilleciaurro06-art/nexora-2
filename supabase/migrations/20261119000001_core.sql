-- NEXORA 2.0 – 01 core: schemi, funzioni helper, organizzazioni, profili, membership, inviti.
-- Principi: RLS su ogni tabella di public; funzioni e dati interni in "private" (non esposto alla Data API).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- anon non deve avere accesso a nessun dato applicativo
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------- utilità
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create function private.prevent_org_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- organizzazioni
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  vat_number text,
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------- profili
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  locale text not null default 'it',
  default_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------- membership
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id, organization_id);
create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger memberships_org_immutable before update on public.memberships
  for each row execute function private.prevent_org_change();

-- ---------------------------------------------------------------- helper RLS
create function private.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and o.status = 'active'
  );
$$;

create function private.has_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
      and o.status = 'active'
  );
$$;

create function private.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on b.organization_id = a.organization_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

revoke all on function private.is_member(uuid), private.has_role(uuid, text[]),
  private.shares_org_with(uuid) from public, anon;
grant execute on function private.is_member(uuid), private.has_role(uuid, text[]),
  private.shares_org_with(uuid) to authenticated, service_role;

-- l'ultimo owner non può essere rimosso o declassato
create function private.guard_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.organizations where id = old.organization_id)
     and not exists (
       select 1 from public.memberships
       where organization_id = old.organization_id and role = 'owner' and id <> old.id
     )
  then
    raise exception 'an organization must keep at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_guard_last_owner before update or delete on public.memberships
  for each row execute function private.guard_last_owner();

-- ---------------------------------------------------------------- inviti
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('admin', 'member', 'viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (organization_id);
create trigger invitations_updated_at before update on public.invitations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------- dati interni (private)
create table private.activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  bound_email text check (bound_email is null or bound_email = lower(bound_email)),
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses > 0),
  used_count int not null default 0 check (used_count >= 0),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table private.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table private.quote_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year int not null,
  last_number int not null default 0,
  primary key (organization_id, year)
);

revoke all on all tables in schema private from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema private to service_role;
