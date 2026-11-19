-- NEXORA 2.0 – 03 AI e audit

create table public.ai_quotas (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  monthly_token_limit bigint not null default 200000 check (monthly_token_limit >= 0),
  period_start date not null default date_trunc('month', current_date)::date,
  tokens_used bigint not null default 0 check (tokens_used >= 0),
  updated_at timestamptz not null default now()
);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index ai_conversations_idx on public.ai_conversations (organization_id, user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, organization_id) references public.ai_conversations (id, organization_id) on delete cascade
);
create index ai_messages_idx on public.ai_messages (organization_id, conversation_id, created_at);

-- Il modello produce SOLO proposte: l'applicazione richiede una decisione esplicita dell'utente.
create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('quote_item', 'quote_text', 'task', 'customer_update', 'insight')),
  payload jsonb not null,
  source_type text not null check (source_type in ('document', 'conversation', 'quote', 'customer')),
  source_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_suggestions_idx on public.ai_suggestions (organization_id, status, created_at desc);

create function private.ai_suggestions_decide() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'suggestion already decided' using errcode = '23514';
    end if;
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger ai_suggestions_decide before update on public.ai_suggestions
  for each row execute function private.ai_suggestions_decide();

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  feature text not null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_micro_eur bigint not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_idx on public.ai_usage (organization_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['ai_conversations','ai_messages','ai_suggestions','ai_usage']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.prevent_org_change()', t || '_org_immutable', t);
  end loop;
  foreach t in array array['ai_conversations','ai_suggestions']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- audit (append-only)
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  changed_fields text[],
  created_at timestamptz not null default now()
);
create index audit_logs_idx on public.audit_logs (organization_id, created_at desc);

create function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_fields text[];
begin
  v_org := case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
                else (v_row ->> 'organization_id')::uuid end;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_fields
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'subtotal_cents', 'vat_cents', 'total_cents');
    if v_fields is null then return null; end if;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, changed_fields)
  values (v_org, (select auth.uid()), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid, v_fields);
  return null;
end $$;
revoke all on function private.audit_trigger() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['organizations','memberships','invitations','customers','quotes','tasks','documents','ai_suggestions']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger()', t || '_audit', t);
  end loop;
end $$;
