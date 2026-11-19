-- NEXORA 2.0 – 10 funzioni commerciali: profilo aziendale, note cliente, timeline, notifiche,
-- audit esteso, audit di piattaforma, nuovi tipi di suggerimento AI, metadati documenti.
-- Solo aggiunte: nessuna tabella o colonna esistente viene eliminata, nessun dato viene modificato
-- (il backfill della timeline inserisce soltanto righe nuove).

-- ============================================================ 1. profilo aziendale
alter table public.organizations
  add column address text,
  add column tax_code text,
  add column email text,
  add column phone text,
  add column website text,
  add column logo_path text,
  add column quote_footer text,
  add column quote_default_terms text;

alter table public.organizations
  add constraint organizations_profile_lengths check (
    char_length(coalesce(address, '')) <= 300 and char_length(coalesce(tax_code, '')) <= 32
    and char_length(coalesce(email, '')) <= 200 and char_length(coalesce(phone, '')) <= 40
    and char_length(coalesce(website, '')) <= 200 and char_length(coalesce(quote_footer, '')) <= 2000
    and char_length(coalesce(quote_default_terms, '')) <= 4000),
  add constraint organizations_logo_in_own_folder check (logo_path is null or logo_path like id::text || '/_branding/%');

-- la RLS organizations_update (solo owner/admin) resta l'unica via di scrittura
grant update (address, tax_code, email, phone, website, logo_path, quote_footer, quote_default_terms)
  on public.organizations to authenticated;

-- ============================================================ 2. referenti: note facoltative
alter table public.customer_contacts add column notes text check (char_length(coalesce(notes, '')) <= 1000);

-- ============================================================ 3. note del cliente
create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index customer_notes_idx on public.customer_notes (organization_id, customer_id, created_at desc);
alter table public.customer_notes enable row level security;
create policy customer_notes_select on public.customer_notes for select to authenticated
  using (private.is_member(organization_id));
create policy customer_notes_insert on public.customer_notes for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin', 'member']) and created_by = (select auth.uid()));
create policy customer_notes_update on public.customer_notes for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']) or (created_by = (select auth.uid()) and private.has_role(organization_id, array['member'])))
  with check (private.has_role(organization_id, array['owner', 'admin', 'member']));
create policy customer_notes_delete on public.customer_notes for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']) or (created_by = (select auth.uid()) and private.has_role(organization_id, array['member'])));
revoke update on public.customer_notes from authenticated;
grant update (body) on public.customer_notes to authenticated;
create trigger customer_notes_updated_at before update on public.customer_notes
  for each row execute function private.set_updated_at();
create trigger customer_notes_org_immutable before update on public.customer_notes
  for each row execute function private.prevent_org_change();

-- ============================================================ 4. attività: chi ha assegnato
alter table public.tasks add column assigned_by uuid references auth.users (id) on delete set null;
create function private.tasks_set_assigned_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then new.assigned_by := (select auth.uid()); end if;
  elsif new.assignee_id is distinct from old.assignee_id then
    new.assigned_by := (select auth.uid());
  end if;
  return new;
end $$;
create trigger tasks_assigned_by before insert or update on public.tasks
  for each row execute function private.tasks_set_assigned_by();
-- l'assegnatario deve appartenere alla stessa organizzazione
create function private.tasks_check_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    if not exists (select 1 from public.memberships where organization_id = new.organization_id and user_id = new.assignee_id) then
      raise exception 'assignee is not a member of the organization' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger tasks_check_assignee before insert or update on public.tasks
  for each row execute function private.tasks_check_assignee();
create index tasks_customer_idx on public.tasks (organization_id, customer_id) where deleted_at is null;
create index tasks_quote_idx on public.tasks (organization_id, quote_id) where deleted_at is null;

-- ============================================================ 5. documenti: metadati e impronta
alter table public.documents
  add column description text check (char_length(coalesce(description, '')) <= 1000),
  add column content_hash text;
create index documents_hash_idx on public.documents (organization_id, content_hash) where content_hash is not null;

-- ============================================================ 6. nuovi tipi di suggerimento AI
alter table public.ai_suggestions drop constraint ai_suggestions_kind_check;
alter table public.ai_suggestions add constraint ai_suggestions_kind_check
  check (kind in ('quote_item', 'quote_text', 'task', 'customer_update', 'insight', 'quote_draft',
                  'quote_followup', 'customer_followup', 'customer_note', 'price_review'));

-- ============================================================ 7. audit: correzione cancellazione organizzazione + estensione
-- Bug: eliminare un'organizzazione falliva perché il trigger scriveva l'audit di righe figlie
-- in cascata verso un'organizzazione già rimossa.
create or replace function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_fields text[];
begin
  v_org := case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
                else (v_row ->> 'organization_id')::uuid end;
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = v_org) then
    return null;
  end if;
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

do $$
declare t text;
begin
  foreach t in array array['customer_contacts', 'customer_notes', 'reminders']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ogni membro vede almeno le proprie operazioni (owner/admin vedono tutto, policy già esistente)
create policy audit_logs_select_own on public.audit_logs for select to authenticated
  using (actor_id = (select auth.uid()) and private.is_member(organization_id));

-- ============================================================ 8. timeline commerciale
create table public.activity_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid,
  entity text not null check (entity in ('customer', 'contact', 'quote', 'task', 'document', 'note')),
  entity_id uuid,
  event text not null,
  summary text not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index activity_events_customer_idx on public.activity_events (organization_id, customer_id, created_at desc);
create index activity_events_org_idx on public.activity_events (organization_id, created_at desc);
alter table public.activity_events enable row level security;
create policy activity_events_select on public.activity_events for select to authenticated
  using (private.is_member(organization_id));
revoke insert, update, delete, truncate on public.activity_events from authenticated;

create function private.quote_status_label(p text) returns text
language sql immutable set search_path = '' as $$
  select case p when 'draft' then 'bozza' when 'sent' then 'inviato' when 'accepted' then 'accettato'
                when 'rejected' then 'rifiutato' when 'expired' then 'scaduto' else p end;
$$;

create function private.activity_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid := (v_row ->> 'organization_id')::uuid;
  v_id uuid := (v_row ->> 'id')::uuid;
  v_customer uuid;
  v_entity text;
  v_event text;
  v_summary text;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = v_org) then
    return null;
  end if;

  if tg_table_name = 'customers' then
    v_entity := 'customer'; v_customer := v_id;
    if tg_op = 'INSERT' then v_event := 'created'; v_summary := 'Cliente creato';
    elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then v_event := 'deleted'; v_summary := 'Cliente eliminato';
    elsif tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then v_event := 'updated'; v_summary := 'Dati del cliente modificati';
    else return null; end if;

  elsif tg_table_name = 'customer_contacts' then
    v_entity := 'contact'; v_customer := (v_row ->> 'customer_id')::uuid;
    if tg_op = 'INSERT' then v_event := 'created'; v_summary := 'Referente aggiunto: ' || new.full_name;
    elsif tg_op = 'UPDATE' then
      if (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then return null; end if;
      v_event := 'updated'; v_summary := 'Referente modificato: ' || new.full_name;
    else v_event := 'deleted'; v_summary := 'Referente rimosso: ' || old.full_name; end if;

  elsif tg_table_name = 'quotes' then
    v_entity := 'quote'; v_customer := (v_row ->> 'customer_id')::uuid;
    if tg_op = 'INSERT' then v_event := 'created'; v_summary := 'Preventivo ' || new.number || ' creato';
    elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then v_event := 'deleted'; v_summary := 'Preventivo ' || new.number || ' eliminato';
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_event := 'status_' || new.status; v_summary := 'Preventivo ' || new.number || ': stato ' || private.quote_status_label(new.status);
    elsif tg_op = 'UPDATE' and new.follow_up_date is distinct from old.follow_up_date then
      v_event := 'follow_up';
      v_summary := case when new.follow_up_date is null then 'Follow-up del preventivo ' || new.number || ' rimosso'
                        else 'Follow-up del preventivo ' || new.number || ' fissato al ' || to_char(new.follow_up_date, 'DD/MM/YYYY') end;
    else return null; end if;

  elsif tg_table_name = 'tasks' then
    v_entity := 'task'; v_customer := (v_row ->> 'customer_id')::uuid;
    if tg_op = 'INSERT' then v_event := 'created'; v_summary := 'Attività creata: ' || new.title;
    elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then v_event := 'deleted'; v_summary := 'Attività eliminata: ' || new.title;
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.status = 'done' then v_event := 'completed'; v_summary := 'Attività completata: ' || new.title;
      elsif old.status = 'done' then v_event := 'reopened'; v_summary := 'Attività riaperta: ' || new.title;
      else v_event := 'status_' || new.status; v_summary := 'Attività "' || new.title || '": stato ' || new.status; end if;
    elsif tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id then
      v_event := 'assigned'; v_summary := 'Attività assegnata: ' || new.title;
    else return null; end if;

  elsif tg_table_name = 'documents' then
    v_entity := 'document'; v_customer := (v_row ->> 'customer_id')::uuid;
    if tg_op = 'INSERT' then v_event := 'uploaded'; v_summary := 'Documento caricato: ' || new.name;
    elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then v_event := 'deleted'; v_summary := 'Documento eliminato: ' || new.name;
    elsif tg_op = 'UPDATE' and new.customer_id is distinct from old.customer_id and new.customer_id is not null then
      v_event := 'linked'; v_summary := 'Documento collegato: ' || new.name;
    else return null; end if;

  elsif tg_table_name = 'customer_notes' then
    v_entity := 'note'; v_customer := (v_row ->> 'customer_id')::uuid;
    if tg_op = 'INSERT' then v_event := 'created'; v_summary := 'Nota aggiunta';
    else return null; end if;
  else
    return null;
  end if;

  insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id)
  values (v_org, v_customer, v_entity, v_id, v_event, v_summary, (select auth.uid()));
  return null;
end $$;
revoke all on function private.activity_trigger() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_contacts', 'quotes', 'tasks', 'documents', 'customer_notes']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.activity_trigger()', t || '_activity', t);
  end loop;
end $$;

-- backfill (solo inserimenti): eventi di creazione per i dati già esistenti
insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id, created_at)
select organization_id, id, 'customer', id, 'created', 'Cliente creato', created_by, created_at from public.customers;
insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id, created_at)
select organization_id, customer_id, 'quote', id, 'created', 'Preventivo ' || number || ' creato', created_by, created_at from public.quotes;
insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id, created_at)
select organization_id, customer_id, 'task', id, 'created', 'Attività creata: ' || title, created_by, created_at from public.tasks;
insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id, created_at)
select organization_id, customer_id, 'document', id, 'uploaded', 'Documento caricato: ' || name, uploaded_by, created_at from public.documents;

-- clienti da ricontattare: nessuna interazione registrata da p_days giorni (security invoker: vale la RLS)
create function public.customers_to_recontact(p_org uuid, p_days int default 60, p_limit int default 20)
returns table (customer_id uuid, name text, last_activity timestamptz, open_quotes bigint)
language sql stable set search_path = '' as $$
  select c.id, c.name, coalesce(max(e.created_at), c.created_at) as last_activity,
         (select count(*) from public.quotes q where q.organization_id = c.organization_id and q.customer_id = c.id
            and q.deleted_at is null and q.status in ('draft', 'sent')) as open_quotes
  from public.customers c
  left join public.activity_events e on e.organization_id = c.organization_id and e.customer_id = c.id
  where c.organization_id = p_org and c.deleted_at is null and c.status <> 'inactive'
  group by c.id, c.name, c.created_at, c.organization_id
  having coalesce(max(e.created_at), c.created_at) < now() - make_interval(days => p_days)
  order by last_activity asc
  limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.customers_to_recontact(uuid, int, int) from public, anon;
grant execute on function public.customers_to_recontact(uuid, int, int) to authenticated;

-- ============================================================ 9. notifiche interne
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('task_due_soon', 'task_overdue', 'quote_followup', 'reminder', 'task_assigned')),
  title text not null,
  body text,
  link text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Genera le notifiche del solo utente chiamante (nessun cron necessario). Idempotente (dedupe_key).
create function public.refresh_my_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_total int := 0;
  v_n int;
begin
  if v_uid is null then return 0; end if;

  -- attività in scadenza nelle prossime 24 ore
  insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
  select t.organization_id, v_uid, 'task_due_soon', 'Attività in scadenza: ' || t.title,
         'Scade il ' || to_char(t.due_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI'),
         '/attivita/' || t.id, 'task_due_soon:' || t.id || ':' || to_char(t.due_at, 'YYYYMMDDHH24MI')
  from public.tasks t
  join public.memberships m on m.organization_id = t.organization_id and m.user_id = v_uid
  join public.organizations o on o.id = t.organization_id and o.status = 'active'
  where t.deleted_at is null and t.status in ('todo', 'in_progress') and t.assignee_id = v_uid
    and t.due_at > now() and t.due_at <= now() + interval '24 hours'
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- attività scadute
  insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
  select t.organization_id, v_uid, 'task_overdue', 'Attività scaduta: ' || t.title,
         'Era in scadenza il ' || to_char(t.due_at at time zone 'Europe/Rome', 'DD/MM/YYYY'),
         '/attivita/' || t.id, 'task_overdue:' || t.id
  from public.tasks t
  join public.memberships m on m.organization_id = t.organization_id and m.user_id = v_uid
  join public.organizations o on o.id = t.organization_id and o.status = 'active'
  where t.deleted_at is null and t.status in ('todo', 'in_progress') and t.assignee_id = v_uid and t.due_at < now()
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- follow-up dei preventivi (creati dall'utente) in scadenza o scaduti
  insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
  select q.organization_id, v_uid, 'quote_followup', 'Follow-up preventivo ' || q.number,
         'Da ricontattare entro il ' || to_char(q.follow_up_date, 'DD/MM/YYYY'),
         '/preventivi/' || q.id, 'quote_followup:' || q.id || ':' || q.follow_up_date
  from public.quotes q
  join public.memberships m on m.organization_id = q.organization_id and m.user_id = v_uid
  join public.organizations o on o.id = q.organization_id and o.status = 'active'
  where q.deleted_at is null and q.status in ('draft', 'sent') and q.created_by = v_uid
    and q.follow_up_date is not null and q.follow_up_date <= current_date
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- promemoria programmati arrivati a scadenza (destinatario: assegnatario o, in mancanza, creatore)
  with due as (
    select r.id, r.organization_id, t.id as task_id, t.title
    from public.reminders r
    join public.tasks t on t.id = r.task_id and t.organization_id = r.organization_id
    join public.memberships m on m.organization_id = r.organization_id and m.user_id = v_uid
    join public.organizations o on o.id = r.organization_id and o.status = 'active'
    where r.status = 'pending' and r.remind_at <= now() and t.deleted_at is null
      and coalesce(t.assignee_id, t.created_by) = v_uid
  ), ins as (
    insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
    select organization_id, v_uid, 'reminder', 'Promemoria: ' || title, null, '/attivita/' || task_id, 'reminder:' || id
    from due
    on conflict (user_id, dedupe_key) do nothing
    returning 1
  ), upd as (
    update public.reminders set status = 'sent' where id in (select id from due) returning 1
  )
  select (select count(*) from ins) into v_n;
  v_total := v_total + v_n;

  -- attività assegnate all'utente da altri (ultimi 14 giorni)
  insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
  select t.organization_id, v_uid, 'task_assigned', 'Ti è stata assegnata un''attività: ' || t.title,
         case when t.due_at is null then null else 'Scadenza ' || to_char(t.due_at at time zone 'Europe/Rome', 'DD/MM/YYYY') end,
         '/attivita/' || t.id, 'task_assigned:' || t.id || ':' || t.assigned_by
  from public.tasks t
  join public.memberships m on m.organization_id = t.organization_id and m.user_id = v_uid
  join public.organizations o on o.id = t.organization_id and o.status = 'active'
  where t.deleted_at is null and t.status in ('todo', 'in_progress') and t.assignee_id = v_uid
    and t.assigned_by is not null and t.assigned_by <> v_uid and t.updated_at > now() - interval '14 days'
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end $$;
revoke all on function public.refresh_my_notifications() from public, anon;
grant execute on function public.refresh_my_notifications() to authenticated;

-- ============================================================ 10. audit di piattaforma (operazioni di supporto tracciate)
create table private.platform_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  organization_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index platform_audit_idx on private.platform_audit (created_at desc);
alter table private.platform_audit enable row level security;
revoke all on private.platform_audit from public, anon, authenticated;
grant select, insert on private.platform_audit to service_role;

create function private.log_platform_action(p_actor uuid, p_action text, p_org uuid, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into private.platform_audit (actor_id, action, organization_id, details)
  values (p_actor, p_action, p_org, coalesce(p_details, '{}'::jsonb));
$$;
create function private.list_platform_audit() returns table (
  id bigint, actor_id uuid, action text, organization_id uuid, details jsonb, created_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select id, actor_id, action, organization_id, details, created_at from private.platform_audit
  order by created_at desc limit 100;
$$;
revoke all on function private.log_platform_action(uuid, text, uuid, jsonb), private.list_platform_audit() from public, anon, authenticated;
grant execute on function private.log_platform_action(uuid, text, uuid, jsonb), private.list_platform_audit() to service_role;

create function public.rpc_log_platform_action(p_actor uuid, p_action text, p_org uuid, p_details jsonb)
returns void language sql set search_path = '' as $$ select private.log_platform_action(p_actor, p_action, p_org, p_details); $$;
create function public.rpc_list_platform_audit() returns table (
  id bigint, actor_id uuid, action text, organization_id uuid, details jsonb, created_at timestamptz
) language sql set search_path = '' as $$ select * from private.list_platform_audit(); $$;
revoke all on function public.rpc_log_platform_action(uuid, text, uuid, jsonb), public.rpc_list_platform_audit() from public, anon, authenticated;
grant execute on function public.rpc_log_platform_action(uuid, text, uuid, jsonb), public.rpc_list_platform_audit() to service_role;

-- ============================================================ 11. storage: la cartella _branding (logo) è modificabile solo da owner/admin
create function private.storage_is_branding(p_name text) returns boolean
language sql immutable set search_path = '' as $$ select split_part(p_name, '/', 2) = '_branding'; $$;
revoke all on function private.storage_is_branding(text) from public, anon;
grant execute on function private.storage_is_branding(text) to authenticated, service_role;

drop policy documents_insert on storage.objects;
drop policy documents_update on storage.objects;
create policy documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and private.has_role(private.storage_org(name),
    case when private.storage_is_branding(name) then array['owner', 'admin'] else array['owner', 'admin', 'member'] end));
create policy documents_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and private.has_role(private.storage_org(name),
    case when private.storage_is_branding(name) then array['owner', 'admin'] else array['owner', 'admin', 'member'] end))
  with check (bucket_id = 'documents' and private.has_role(private.storage_org(name),
    case when private.storage_is_branding(name) then array['owner', 'admin'] else array['owner', 'admin', 'member'] end));
