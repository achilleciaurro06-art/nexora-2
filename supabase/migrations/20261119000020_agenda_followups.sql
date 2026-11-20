-- NEXORA 2.0 – 20 attività evolute, appuntamenti, registro chiamate, follow-up a sei stati, centro Promemoria.
-- Solo aggiunte. Sostituisce: refresh_my_notifications (nuove notifiche), customer_delete_blockers/delete_customer_permanently
-- (nuovi dati collegati che impediscono l'eliminazione), customer_commercial_summary (ultimo contatto con chiamate/appuntamenti).
-- Fuso orario dell'applicazione: Europe/Rome (come nelle notifiche già esistenti). Gli istanti sono sempre timestamptz.

-- ============================================================ 1. tipologie di attività (configurabili senza modificare il database)
create table public.task_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,29}$'),
  label text not null check (char_length(label) between 1 and 60),
  system boolean not null default false,
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key),
  unique (id, organization_id)
);
alter table public.task_types enable row level security;
create policy task_types_select on public.task_types for select to authenticated using (private.is_member(organization_id));
create policy task_types_insert on public.task_types for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin']) and system = false);
create policy task_types_update on public.task_types for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin'])) with check (private.has_role(organization_id, array['owner', 'admin']));
revoke delete on public.task_types from authenticated;
revoke update on public.task_types from authenticated;
grant update (label, active, position) on public.task_types to authenticated;
create trigger task_types_updated_at before update on public.task_types for each row execute function private.set_updated_at();
create trigger task_types_org_immutable before update on public.task_types for each row execute function private.prevent_org_change();
create trigger task_types_audit after insert or update on public.task_types for each row execute function private.audit_trigger();

create function private.seed_task_types(p_org uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.task_types (organization_id, key, label, system, position) values
    (p_org, 'generic', 'Attività generica', true, 0), (p_org, 'call', 'Telefonata', true, 1),
    (p_org, 'material', 'Invio o preparazione materiale', true, 2), (p_org, 'other', 'Altro', true, 3)
  on conflict (organization_id, key) do nothing;
$$;
revoke all on function private.seed_task_types(uuid) from public, anon, authenticated;
select private.seed_task_types(id) from public.organizations;
create function private.organizations_seed_task_types() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.seed_task_types(new.id); return null; end $$;
create trigger organizations_seed_task_types after insert on public.organizations for each row execute function private.organizations_seed_task_types();

-- ============================================================ 2. attività: tipologia, referente, durata, note, ora
alter table public.customer_contacts add constraint customer_contacts_id_org_key unique (id, organization_id);
alter table public.tasks add column type_id uuid;
alter table public.tasks add column contact_id uuid;
alter table public.tasks add column duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 1440);
alter table public.tasks add column notes text check (char_length(coalesce(notes, '')) <= 4000);
alter table public.tasks add column due_has_time boolean not null default false;
alter table public.tasks add constraint tasks_type_fk foreign key (type_id, organization_id) references public.task_types (id, organization_id) on delete set null (type_id);
alter table public.tasks add constraint tasks_contact_fk foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id);
update public.tasks t set type_id = (select id from public.task_types y where y.organization_id = t.organization_id and y.key = 'generic');
create index tasks_type_idx on public.tasks (organization_id, type_id);

-- tipologia predefinita: "Attività generica"
create function private.tasks_default_type() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type_id is null then
    select id into new.type_id from public.task_types where organization_id = new.organization_id and key = 'generic';
  end if;
  return new;
end $$;
create trigger tasks_default_type before insert on public.tasks for each row execute function private.tasks_default_type();

-- ============================================================ 3. appuntamenti
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(coalesce(description, '')) <= 2000),
  customer_id uuid,
  contact_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text check (char_length(coalesce(location, '')) <= 300),
  assignee_id uuid references auth.users (id) on delete set null,
  notes text check (char_length(coalesce(notes, '')) <= 4000),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  status_changed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours'),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id)
);
create index appointments_org_idx on public.appointments (organization_id, starts_at) where deleted_at is null;
create index appointments_customer_idx on public.appointments (organization_id, customer_id);

create table public.appointment_participants (
  appointment_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (appointment_id, user_id),
  foreign key (appointment_id, organization_id) references public.appointments (id, organization_id) on delete cascade
);

-- ============================================================ 4. follow-up a sei stati
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  contact_id uuid,
  quote_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(coalesce(description, '')) <= 2000),
  reason text check (char_length(coalesce(reason, '')) <= 300),
  due_on date not null,
  assignee_id uuid references auth.users (id) on delete set null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  notes text check (char_length(coalesce(notes, '')) <= 4000),
  status text not null default 'todo' check (status in ('todo', 'scheduled', 'in_progress', 'waiting', 'done', 'cancelled')),
  completed_at timestamptz,
  source_task_id uuid,
  source_call_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete set null (quote_id),
  foreign key (source_task_id, organization_id) references public.tasks (id, organization_id) on delete set null (source_task_id)
);
create index follow_ups_org_idx on public.follow_ups (organization_id, status, due_on) where deleted_at is null;
create index follow_ups_customer_idx on public.follow_ups (organization_id, customer_id);

-- cronologia dei cambiamenti: scritta SOLO dal database (nessun privilegio di scrittura per gli utenti)
create table public.follow_up_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  follow_up_id uuid not null,
  event text not null check (event in ('created', 'status', 'rescheduled', 'updated')),
  from_status text, to_status text, from_due date, to_due date,
  note text,
  actor_id uuid,
  created_at timestamptz not null default now(),
  foreign key (follow_up_id, organization_id) references public.follow_ups (id, organization_id) on delete cascade
);
create index follow_up_events_idx on public.follow_up_events (organization_id, follow_up_id, id);

-- ============================================================ 5. registro chiamate (manuale)
create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  contact_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  user_id uuid references auth.users (id) on delete set null,
  called_at timestamptz not null default now(),
  duration_seconds int check (duration_seconds is null or duration_seconds between 0 and 43200),
  outcome text not null check (outcome in ('answered', 'no_answer', 'busy', 'callback', 'interested', 'not_interested', 'other')),
  notes text check (char_length(coalesce(notes, '')) <= 4000),
  follow_up_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (called_at <= now() + interval '10 minutes'),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id),
  foreign key (follow_up_id, organization_id) references public.follow_ups (id, organization_id) on delete set null (follow_up_id)
);
create index call_logs_org_idx on public.call_logs (organization_id, called_at desc);
create index call_logs_customer_idx on public.call_logs (organization_id, customer_id, called_at desc);
alter table public.follow_ups add constraint follow_ups_call_fk
  foreign key (source_call_id, organization_id) references public.call_logs (id, organization_id) on delete set null (source_call_id);

-- ============================================================ 6. promemoria anche per gli appuntamenti
alter table public.reminders alter column task_id drop not null;
alter table public.reminders add column appointment_id uuid;
alter table public.reminders add column offset_minutes int check (offset_minutes is null or offset_minutes between 0 and 20160);
alter table public.reminders add constraint reminders_one_target check (num_nonnulls(task_id, appointment_id) = 1);
alter table public.reminders add constraint reminders_appointment_fk
  foreign key (appointment_id, organization_id) references public.appointments (id, organization_id) on delete cascade;
create index reminders_appointment_idx on public.reminders (organization_id, appointment_id);

-- ============================================================ 7. controlli di integrità (assegnatari, referenti, preventivi, clienti archiviati)
create function private.check_member_ref() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_new uuid := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid; v_old uuid;
begin
  if v_new is null then return new; end if;
  if tg_op = 'UPDATE' then
    v_old := nullif(to_jsonb(old) ->> tg_argv[0], '')::uuid;
    if v_old is not distinct from v_new then return new; end if;
  end if;
  if not exists (select 1 from public.memberships where organization_id = new.organization_id and user_id = v_new) then
    raise exception 'user is not a member of the organization' using errcode = '23514';
  end if;
  return new;
end $$;

create function private.check_contact_customer() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.contact_id is not null then
    if new.customer_id is null or not exists (select 1 from public.customer_contacts k where k.id = new.contact_id and k.organization_id = new.organization_id and k.customer_id = new.customer_id) then
      raise exception 'contact does not belong to the customer' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create function private.check_quote_customer() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.quote_id is not null and not exists (select 1 from public.quotes q where q.id = new.quote_id and q.organization_id = new.organization_id and q.customer_id = new.customer_id) then
    raise exception 'quote does not belong to the customer' using errcode = '23514';
  end if;
  return new;
end $$;

-- nuovi record commerciali: mai su clienti archiviati o rimossi (i record esistenti restano consultabili)
create function private.assert_customer_active() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    if exists (select 1 from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id and (c.archived_at is not null or c.deleted_at is not null)) then
      raise exception 'customer is archived' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.check_member_ref(), private.check_contact_customer(), private.check_quote_customer(), private.assert_customer_active() from public, anon, authenticated;

create trigger tasks_check_contact before insert or update on public.tasks for each row execute function private.check_contact_customer();
create trigger tasks_customer_active before insert or update on public.tasks for each row execute function private.assert_customer_active();
create trigger appointments_check_assignee before insert or update on public.appointments for each row execute function private.check_member_ref('assignee_id');
create trigger appointments_check_contact before insert or update on public.appointments for each row execute function private.check_contact_customer();
create trigger appointments_customer_active before insert or update on public.appointments for each row execute function private.assert_customer_active();
create trigger participants_check_member before insert on public.appointment_participants for each row execute function private.check_member_ref('user_id');
create trigger follow_ups_check_assignee before insert or update on public.follow_ups for each row execute function private.check_member_ref('assignee_id');
create trigger follow_ups_check_contact before insert or update on public.follow_ups for each row execute function private.check_contact_customer();
create trigger follow_ups_check_quote before insert or update on public.follow_ups for each row execute function private.check_quote_customer();
create trigger follow_ups_customer_active before insert or update on public.follow_ups for each row execute function private.assert_customer_active();
create trigger call_logs_check_user before insert or update on public.call_logs for each row execute function private.check_member_ref('user_id');
create trigger call_logs_check_contact before insert or update on public.call_logs for each row execute function private.check_contact_customer();
create trigger call_logs_customer_active before insert or update on public.call_logs for each row execute function private.assert_customer_active();

-- ============================================================ 8. macchina a stati dei follow-up + cronologia
create function private.follow_ups_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.customer_id := old.customer_id;  -- il cliente non cambia
  if new.status is distinct from old.status then
    -- aperti: si muovono liberamente tra loro e verso la chiusura; chiusi (completato/annullato): si possono solo riaprire in "Da fare"
    if old.status in ('done', 'cancelled') and new.status <> 'todo' then
      raise exception 'closed follow-up can only be reopened' using errcode = '23514';
    end if;
    new.completed_at := case when new.status = 'done' then now() else null end;
  end if;
  if new.due_on is distinct from old.due_on and old.status in ('done', 'cancelled') and new.status in ('done', 'cancelled') then
    raise exception 'closed follow-up cannot be rescheduled' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger follow_ups_guard before update on public.follow_ups for each row execute function private.follow_ups_guard();

create function private.follow_ups_history() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(current_setting('nexora.change_note', true), '');
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.follow_up_events (organization_id, follow_up_id, event, to_status, to_due, note, actor_id)
    values (new.organization_id, new.id, 'created', new.status, new.due_on, null, v_actor);
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.follow_up_events (organization_id, follow_up_id, event, from_status, to_status, note, actor_id)
    values (new.organization_id, new.id, 'status', old.status, new.status, v_note, v_actor);
  end if;
  if new.due_on is distinct from old.due_on then
    insert into public.follow_up_events (organization_id, follow_up_id, event, from_due, to_due, note, actor_id)
    values (new.organization_id, new.id, 'rescheduled', old.due_on, new.due_on, v_note, v_actor);
  end if;
  if new.status = old.status and new.due_on = old.due_on
     and (new.title, new.description, new.reason, new.priority, new.notes, new.assignee_id, new.contact_id, new.quote_id)
         is distinct from (old.title, old.description, old.reason, old.priority, old.notes, old.assignee_id, old.contact_id, old.quote_id) then
    insert into public.follow_up_events (organization_id, follow_up_id, event, note, actor_id) values (new.organization_id, new.id, 'updated', v_note, v_actor);
  end if;
  return null;
end $$;
create trigger follow_ups_history after insert or update on public.follow_ups for each row execute function private.follow_ups_history();
revoke all on function private.follow_ups_guard(), private.follow_ups_history() from public, anon, authenticated;

-- cambio di stato e riprogrammazione con nota (la nota finisce nella cronologia)
create function public.set_follow_up_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('nexora.change_note', coalesce(left(p_note, 500), ''), true);
  update public.follow_ups set status = p_status where id = p_id and deleted_at is null;
  if not found then raise exception 'follow-up not found' using errcode = 'P0002'; end if;
end $$;
create function public.reschedule_follow_up(p_id uuid, p_new_date date, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('nexora.change_note', coalesce(left(p_note, 500), ''), true);
  update public.follow_ups set due_on = p_new_date where id = p_id and deleted_at is null and status not in ('done', 'cancelled');
  if not found then raise exception 'follow-up not found or closed' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_follow_up_status(uuid, text, text), public.reschedule_follow_up(uuid, date, text) from public, anon;
grant execute on function public.set_follow_up_status(uuid, text, text), public.reschedule_follow_up(uuid, date, text) to authenticated;

-- registrazione di una chiamata con eventuale follow-up, in un'unica transazione (RLS di chi chiama)
create function public.log_call(
  p_org uuid, p_customer uuid, p_contact uuid, p_direction text, p_user uuid, p_called_at timestamptz, p_duration int,
  p_outcome text, p_notes text, p_next_due date default null, p_next_assignee uuid default null, p_next_title text default null
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_call uuid;
  v_fu uuid;
  v_name text;
begin
  insert into public.call_logs (organization_id, customer_id, contact_id, direction, user_id, called_at, duration_seconds, outcome, notes, created_by)
  values (p_org, p_customer, p_contact, p_direction, coalesce(p_user, (select auth.uid())), coalesce(p_called_at, now()), p_duration, p_outcome, p_notes, (select auth.uid()))
  returning id into v_call;
  if p_next_due is not null then
    select name into v_name from public.customers where id = p_customer;
    insert into public.follow_ups (organization_id, customer_id, contact_id, title, reason, due_on, assignee_id, status, source_call_id, created_by)
    values (p_org, p_customer, p_contact, coalesce(nullif(trim(p_next_title), ''), 'Richiamare ' || coalesce(v_name, 'il cliente')),
            'Dopo la chiamata del ' || to_char(coalesce(p_called_at, now()) at time zone 'Europe/Rome', 'DD/MM/YYYY'),
            p_next_due, coalesce(p_next_assignee, (select auth.uid())), 'scheduled', v_call, (select auth.uid()))
    returning id into v_fu;
    update public.call_logs set follow_up_id = v_fu where id = v_call;
  end if;
  return jsonb_build_object('call_id', v_call, 'follow_up_id', v_fu);
end $$;
revoke all on function public.log_call(uuid, uuid, uuid, text, uuid, timestamptz, int, text, text, date, uuid, text) from public, anon;
grant execute on function public.log_call(uuid, uuid, uuid, text, uuid, timestamptz, int, text, text, date, uuid, text) to authenticated;

-- ============================================================ 9. promemoria: si spostano con la scadenza / l'inizio
create function private.reminders_follow_task() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.due_at is distinct from old.due_at and new.due_at is not null then
    update public.reminders set remind_at = new.due_at - make_interval(mins => coalesce(offset_minutes, 0))
     where task_id = new.id and organization_id = new.organization_id and status = 'pending';
  end if;
  return null;
end $$;
create function private.reminders_follow_appointment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update public.reminders set remind_at = new.starts_at - make_interval(mins => coalesce(offset_minutes, 0))
     where appointment_id = new.id and organization_id = new.organization_id and status = 'pending';
  end if;
  -- un appuntamento chiuso o annullato non deve più generare promemoria
  if new.status <> 'scheduled' and old.status = 'scheduled' then
    update public.reminders set status = 'cancelled' where appointment_id = new.id and organization_id = new.organization_id and status = 'pending';
  end if;
  return null;
end $$;
create trigger tasks_reminders_follow after update on public.tasks for each row execute function private.reminders_follow_task();
create trigger appointments_reminders_follow after update on public.appointments for each row execute function private.reminders_follow_appointment();

-- ============================================================ 10. RLS, trigger comuni, audit
do $$
declare t text;
begin
  foreach t in array array['appointments', 'follow_ups', 'call_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(organization_id))', t || '_select', t);
    execute format($f$create policy %1$I on public.%2$I for insert to authenticated
      with check (private.has_role(organization_id, array['owner','admin','member']) and created_by = (select auth.uid()))$f$, t || '_insert', t);
    execute format($f$create policy %1$I on public.%2$I for update to authenticated
      using (private.has_role(organization_id, array['owner','admin','member']))
      with check (private.has_role(organization_id, array['owner','admin','member']))$f$, t || '_update', t);
    execute format($f$create policy %1$I on public.%2$I for delete to authenticated
      using (private.has_role(organization_id, array['owner','admin']))$f$, t || '_delete', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.prevent_org_change()', t || '_org_immutable', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger()', t || '_audit', t);
  end loop;
end $$;
-- partecipanti: stessa gestione dell'appuntamento
alter table public.appointment_participants enable row level security;
create policy participants_select on public.appointment_participants for select to authenticated using (private.is_member(organization_id));
create policy participants_insert on public.appointment_participants for insert to authenticated with check (private.has_role(organization_id, array['owner', 'admin', 'member']));
create policy participants_delete on public.appointment_participants for delete to authenticated using (private.has_role(organization_id, array['owner', 'admin', 'member']));
revoke update on public.appointment_participants from authenticated;
-- cronologia follow-up: solo lettura
alter table public.follow_up_events enable row level security;
create policy follow_up_events_select on public.follow_up_events for select to authenticated using (private.is_member(organization_id));
revoke insert, update, delete, truncate on public.follow_up_events from authenticated;
-- la data di completamento e quella di cambio stato le decide il database
revoke update on public.follow_ups from authenticated;
grant update (contact_id, quote_id, title, description, reason, due_on, assignee_id, priority, notes, status, deleted_at) on public.follow_ups to authenticated;
revoke update on public.appointments from authenticated;
grant update (contact_id, customer_id, title, description, starts_at, ends_at, location, assignee_id, notes, status, deleted_at) on public.appointments to authenticated;
revoke update on public.call_logs from authenticated;
grant update (contact_id, direction, user_id, called_at, duration_seconds, outcome, notes, follow_up_id) on public.call_logs to authenticated;

create function private.appointments_status_stamp() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then new.status_changed_at := now(); end if;
  return new;
end $$;
create trigger appointments_status_stamp before update on public.appointments for each row execute function private.appointments_status_stamp();

-- ============================================================ 11. cronologia del cliente: appuntamenti, chiamate, follow-up
alter table public.activity_events drop constraint activity_events_entity_check;
alter table public.activity_events add constraint activity_events_entity_check
  check (entity in ('customer', 'contact', 'quote', 'task', 'document', 'note', 'appointment', 'call', 'follow_up'));

create function private.interactions_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_event text; v_summary text; v_entity text; v_customer uuid; v_id uuid; v_org uuid;
  tz constant text := 'Europe/Rome';
begin
  if tg_table_name = 'appointments' then
    v_entity := 'appointment'; v_customer := new.customer_id; v_id := new.id; v_org := new.organization_id;
    if tg_op = 'INSERT' then v_event := 'created'; v_summary := 'Appuntamento fissato: ' || new.title || ' (' || to_char(new.starts_at at time zone tz, 'DD/MM/YYYY HH24:MI') || ')';
    elsif new.deleted_at is not null and old.deleted_at is null then v_event := 'deleted'; v_summary := 'Appuntamento eliminato: ' || new.title;
    elsif new.status is distinct from old.status then
      v_event := new.status; v_summary := case new.status when 'completed' then 'Appuntamento completato: ' when 'cancelled' then 'Appuntamento annullato: ' else 'Appuntamento riaperto: ' end || new.title;
    elsif new.starts_at is distinct from old.starts_at then
      v_event := 'rescheduled'; v_summary := 'Appuntamento spostato: ' || new.title || ' (dal ' || to_char(old.starts_at at time zone tz, 'DD/MM/YYYY HH24:MI') || ' al ' || to_char(new.starts_at at time zone tz, 'DD/MM/YYYY HH24:MI') || ')';
    else return null; end if;
  elsif tg_table_name = 'call_logs' then
    v_entity := 'call'; v_customer := new.customer_id; v_id := new.id; v_org := new.organization_id;
    if tg_op <> 'INSERT' then return null; end if;
    v_event := 'logged';
    v_summary := 'Chiamata ' || case new.direction when 'inbound' then 'in entrata' else 'in uscita' end || ': ' ||
      case new.outcome when 'answered' then 'risposto' when 'no_answer' then 'nessuna risposta' when 'busy' then 'occupato' when 'callback' then 'da richiamare'
                       when 'interested' then 'interessato' when 'not_interested' then 'non interessato' else 'altro esito' end;
  else
    v_entity := 'follow_up'; v_customer := new.customer_id; v_id := new.id; v_org := new.organization_id;
    if tg_op = 'INSERT' then v_event := 'created'; v_summary := 'Follow-up creato: ' || new.title || ' (per il ' || to_char(new.due_on, 'DD/MM/YYYY') || ')';
    elsif new.deleted_at is not null and old.deleted_at is null then v_event := 'deleted'; v_summary := 'Follow-up eliminato: ' || new.title;
    elsif new.status is distinct from old.status then
      v_event := 'status_' || new.status;
      v_summary := 'Follow-up «' || new.title || '»: ' || case new.status when 'todo' then 'da fare' when 'scheduled' then 'programmato' when 'in_progress' then 'in corso'
                    when 'waiting' then 'in attesa' when 'done' then 'completato' else 'annullato' end;
    elsif new.due_on is distinct from old.due_on then
      v_event := 'rescheduled'; v_summary := 'Follow-up «' || new.title || '» riprogrammato dal ' || to_char(old.due_on, 'DD/MM/YYYY') || ' al ' || to_char(new.due_on, 'DD/MM/YYYY');
    else return null; end if;
  end if;
  insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id)
  values (v_org, v_customer, v_entity, v_id, v_event, v_summary, (select auth.uid()));
  return null;
end $$;
revoke all on function private.interactions_activity() from public, anon, authenticated;
create trigger appointments_activity after insert or update on public.appointments for each row execute function private.interactions_activity();
create trigger call_logs_activity after insert on public.call_logs for each row execute function private.interactions_activity();
create trigger follow_ups_activity after insert or update on public.follow_ups for each row execute function private.interactions_activity();

-- ============================================================ 12. vista unificata per il centro Promemoria e la dashboard (nessuna copia dei dati)
create view public.agenda_items with (security_invoker = true) as
  select 'task'::text as kind, t.id, t.organization_id, t.title, t.due_at as when_at,
         (t.due_at at time zone 'Europe/Rome')::date as when_date, t.due_has_time as has_time,
         t.status, (t.status in ('todo', 'in_progress')) as is_open, (t.status = 'done') as is_done,
         t.priority, t.assignee_id, t.customer_id, c.name as customer_name, (c.archived_at is not null) as customer_archived,
         coalesce(ty.key, 'generic') as type_key, t.completed_at, '/attivita/' || t.id as href
  from public.tasks t
  left join public.customers c on c.id = t.customer_id and c.organization_id = t.organization_id
  left join public.task_types ty on ty.id = t.type_id and ty.organization_id = t.organization_id
  where t.deleted_at is null and t.status <> 'cancelled'
  union all
  select 'follow_up', f.id, f.organization_id, f.title, (f.due_on::timestamp at time zone 'Europe/Rome'), f.due_on, false,
         f.status, (f.status in ('todo', 'scheduled', 'in_progress', 'waiting')), (f.status = 'done'),
         f.priority, f.assignee_id, f.customer_id, c.name, (c.archived_at is not null), 'follow_up', f.completed_at, '/followup/' || f.id
  from public.follow_ups f
  left join public.customers c on c.id = f.customer_id and c.organization_id = f.organization_id
  where f.deleted_at is null and f.status <> 'cancelled'
  union all
  select 'appointment', a.id, a.organization_id, a.title, a.starts_at, (a.starts_at at time zone 'Europe/Rome')::date, true,
         a.status, (a.status = 'scheduled'), (a.status = 'completed'),
         'normal', a.assignee_id, a.customer_id, c.name, (c.archived_at is not null), 'appointment', a.status_changed_at, '/appuntamenti/' || a.id
  from public.appointments a
  left join public.customers c on c.id = a.customer_id and c.organization_id = a.organization_id
  where a.deleted_at is null and a.status <> 'cancelled'
  union all
  select 'quote_followup', q.id, q.organization_id, 'Follow-up preventivo ' || q.number, (q.follow_up_date::timestamp at time zone 'Europe/Rome'), q.follow_up_date, false,
         'todo', true, false, 'normal', q.created_by, q.customer_id, c.name, (c.archived_at is not null), 'quote_followup', null::timestamptz, '/preventivi/' || q.id
  from public.quotes q
  left join public.customers c on c.id = q.customer_id and c.organization_id = q.organization_id
  where q.deleted_at is null and q.status in ('draft', 'sent') and q.follow_up_date is not null;
revoke all on public.agenda_items from public, anon;
grant select on public.agenda_items to authenticated;

-- ============================================================ 13. notifiche (nuovi tipi) – la funzione si sostituisce per intero
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('task_due_soon', 'task_overdue', 'quote_followup', 'reminder', 'task_assigned', 'followup_due', 'appointment_soon'));
create or replace function public.refresh_my_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_total int := 0;
  v_n int;
  v_prefs jsonb;
  v_hours int;
begin
  if v_uid is null then return 0; end if;
  select coalesce(preferences -> 'notifications', '{}'::jsonb) into v_prefs from public.profiles where id = v_uid;
  v_prefs := coalesce(v_prefs, '{}'::jsonb);
  v_hours := case when v_prefs ->> 'due_soon_hours' ~ '^[0-9]{1,3}$' then least(168, greatest(1, (v_prefs ->> 'due_soon_hours')::int)) else 24 end;

  if coalesce(v_prefs ->> 'task_due_soon', 'true') <> 'false' then
    insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
    select t.organization_id, v_uid, 'task_due_soon', 'Attività in scadenza: ' || t.title,
           'Scade il ' || to_char(t.due_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI'),
           '/attivita/' || t.id, 'task_due_soon:' || t.id || ':' || to_char(t.due_at, 'YYYYMMDDHH24MI')
    from public.tasks t
    join public.memberships m on m.organization_id = t.organization_id and m.user_id = v_uid
    join public.organizations o on o.id = t.organization_id and o.status = 'active'
    where t.deleted_at is null and t.status in ('todo', 'in_progress') and t.assignee_id = v_uid
      and t.due_at > now() and t.due_at <= now() + make_interval(hours => v_hours)
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end if;

  if coalesce(v_prefs ->> 'task_overdue', 'true') <> 'false' then
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
  end if;

  if coalesce(v_prefs ->> 'quote_followup', 'true') <> 'false' then
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
  end if;

  if coalesce(v_prefs ->> 'reminder', 'true') <> 'false' then
    with due as (
      select r.id, r.organization_id,
             coalesce(t.title, a.title) as title,
             case when t.id is not null then '/attivita/' || t.id else '/appuntamenti/' || a.id end as link,
             case when a.id is not null then 'Inizia il ' || to_char(a.starts_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI') end as body
      from public.reminders r
      left join public.tasks t on t.id = r.task_id and t.organization_id = r.organization_id and t.deleted_at is null and t.status in ('todo', 'in_progress')
      left join public.appointments a on a.id = r.appointment_id and a.organization_id = r.organization_id and a.deleted_at is null and a.status = 'scheduled'
      join public.memberships m on m.organization_id = r.organization_id and m.user_id = v_uid
      join public.organizations o on o.id = r.organization_id and o.status = 'active'
      where r.status = 'pending' and r.remind_at <= now() and (t.id is not null or a.id is not null)
        and v_uid in (coalesce(t.assignee_id, t.created_by), coalesce(a.assignee_id, a.created_by))
    ), ins as (
      insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
      select organization_id, v_uid, 'reminder', 'Promemoria: ' || title, body, link, 'reminder:' || id
      from due
      on conflict (user_id, dedupe_key) do nothing
      returning 1
    ), upd as (
      update public.reminders set status = 'sent' where id in (select id from due) returning 1
    )
    select (select count(*) from ins) into v_n;
    v_total := v_total + v_n;
  end if;

  if coalesce(v_prefs ->> 'followup', 'true') <> 'false' then
    insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
    select f.organization_id, v_uid, 'followup_due', 'Follow-up da eseguire: ' || f.title,
           'Previsto per il ' || to_char(f.due_on, 'DD/MM/YYYY'),
           '/followup/' || f.id, 'followup_due:' || f.id || ':' || f.due_on
    from public.follow_ups f
    join public.memberships m on m.organization_id = f.organization_id and m.user_id = v_uid
    join public.organizations o on o.id = f.organization_id and o.status = 'active'
    where f.deleted_at is null and f.status in ('todo', 'scheduled', 'in_progress', 'waiting')
      and coalesce(f.assignee_id, f.created_by) = v_uid and f.due_on <= (now() at time zone 'Europe/Rome')::date
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end if;

  if coalesce(v_prefs ->> 'appointment', 'true') <> 'false' then
    insert into public.notifications (organization_id, user_id, kind, title, body, link, dedupe_key)
    select a.organization_id, v_uid, 'appointment_soon', 'Appuntamento imminente: ' || a.title,
           'Inizia il ' || to_char(a.starts_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI'),
           '/appuntamenti/' || a.id, 'appointment_soon:' || a.id || ':' || to_char(a.starts_at, 'YYYYMMDDHH24MI')
    from public.appointments a
    join public.memberships m on m.organization_id = a.organization_id and m.user_id = v_uid
    join public.organizations o on o.id = a.organization_id and o.status = 'active'
    where a.deleted_at is null and a.status = 'scheduled' and a.starts_at > now() and a.starts_at <= now() + make_interval(hours => v_hours)
      and (coalesce(a.assignee_id, a.created_by) = v_uid or exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.user_id = v_uid))
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end if;

  if coalesce(v_prefs ->> 'task_assigned', 'true') <> 'false' then
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
  end if;

  return v_total;
end $$;
-- ============================================================ 14. eliminazione cliente e sintesi commerciale: nuovi dati collegati
create or replace function public.customer_delete_blockers(p_customer uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when exists (select 1 from public.customers c where c.id = p_customer) then jsonb_build_object(
    'quotes', (select count(*) from public.quotes q where q.customer_id = p_customer),
    'invoices', (select count(*) from public.quote_billings b where b.customer_id = p_customer),
    'documents', (select count(*) from public.documents d where d.customer_id = p_customer),
    'tasks', (select count(*) from public.tasks t where t.customer_id = p_customer),
    'appointments', (select count(*) from public.appointments x where x.customer_id = p_customer),
    'calls', (select count(*) from public.call_logs x where x.customer_id = p_customer),
    'follow_ups', (select count(*) from public.follow_ups x where x.customer_id = p_customer),
    'contacts', (select count(*) from public.customer_contacts k where k.customer_id = p_customer),
    'notes', (select count(*) from public.customer_notes n where n.customer_id = p_customer)) end;
$$;
revoke all on function public.customer_delete_blockers(uuid) from public, anon;
grant execute on function public.customer_delete_blockers(uuid) to authenticated;

-- Eliminazione fisica: solo titolare/amministratori, solo se il cliente è già archiviato e non ha preventivi, fatture,
-- documenti né attività. Referenti, note e cronologia del cliente vengono eliminati con lui; l'audit resta.
create or replace function public.delete_customer_permanently(p_customer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  b jsonb;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if not private.has_role(c.organization_id, array['owner', 'admin']) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if c.archived_at is null then
    raise exception 'customer must be archived first' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'quotes', (select count(*) from public.quotes q where q.customer_id = p_customer),
    'invoices', (select count(*) from public.quote_billings x where x.customer_id = p_customer),
    'documents', (select count(*) from public.documents d where d.customer_id = p_customer),
    'tasks', (select count(*) from public.tasks t where t.customer_id = p_customer),
    'appointments', (select count(*) from public.appointments x where x.customer_id = p_customer),
    'calls', (select count(*) from public.call_logs x where x.customer_id = p_customer),
    'follow_ups', (select count(*) from public.follow_ups x where x.customer_id = p_customer)) into b;
  if (b ->> 'quotes')::int + (b ->> 'invoices')::int + (b ->> 'documents')::int + (b ->> 'tasks')::int
     + (b ->> 'appointments')::int + (b ->> 'calls')::int + (b ->> 'follow_ups')::int > 0 then
    raise exception 'customer has linked records' using errcode = 'P0001', detail = b::text;
  end if;
  delete from public.customers where id = p_customer and organization_id = c.organization_id;
  -- dopo: l'eliminazione a cascata dei referenti genera a sua volta eventi di cronologia
  delete from public.activity_events where organization_id = c.organization_id and customer_id = p_customer;
end $$;
revoke all on function public.delete_customer_permanently(uuid) from public, anon;
grant execute on function public.delete_customer_permanently(uuid) to authenticated;

create or replace function public.customer_commercial_summary(p_customer uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_org uuid;
  r jsonb;
begin
  select organization_id into v_org from public.customers where id = p_customer;  -- RLS: null se non visibile
  if v_org is null then return null; end if;
  select jsonb_build_object(
    'issued_count', count(*) filter (where status <> 'draft'),
    'issued_cents', coalesce(sum(total_cents) filter (where status <> 'draft'), 0),
    'accepted_count', count(*) filter (where status = 'accepted'),
    'accepted_cents', coalesce(sum(total_cents) filter (where status = 'accepted'), 0),
    'rejected_count', count(*) filter (where status = 'rejected'),
    'rejected_cents', coalesce(sum(total_cents) filter (where status = 'rejected'), 0),
    'expired_count', count(*) filter (where status = 'expired'),
    'expired_cents', coalesce(sum(total_cents) filter (where status = 'expired'), 0),
    'open_count', count(*) filter (where status = 'sent'),
    'open_cents', coalesce(sum(total_cents) filter (where status = 'sent'), 0),
    'draft_count', count(*) filter (where status = 'draft'),
    'draft_cents', coalesce(sum(total_cents) filter (where status = 'draft'), 0),
    'avg_issued_cents', case when count(*) filter (where status <> 'draft') > 0
        then round(sum(total_cents) filter (where status <> 'draft') / count(*) filter (where status <> 'draft')) else 0 end,
    'conversion_pct', case when count(*) filter (where status in ('accepted', 'rejected')) > 0
        then round(100.0 * count(*) filter (where status = 'accepted') / count(*) filter (where status in ('accepted', 'rejected'))) end)
  into r
  from public.quotes where customer_id = p_customer and organization_id = v_org and deleted_at is null;
  return r || jsonb_build_object(
    'invoiced_count', (select count(*) from public.quote_billings b where b.customer_id = p_customer),
    'invoiced_cents', (select coalesce(sum(amount_cents), 0) from public.quote_billings b where b.customer_id = p_customer),
    'collected_cents', (select coalesce(sum(amount_cents), 0) from public.quote_billings b where b.customer_id = p_customer and b.payment_status = 'paid'),
    'accepted_invoiced_cents', (select coalesce(sum(b.amount_cents), 0) from public.quote_billings b join public.quotes q on q.id = b.quote_id where b.customer_id = p_customer and q.status = 'accepted'),
    'last_activity_at', (select max(created_at) from public.activity_events e where e.organization_id = v_org and e.customer_id = p_customer),
    'last_contact_at', (select max(t) from (
        select max(created_at) as t from public.customer_notes n where n.organization_id = v_org and n.customer_id = p_customer
        union all select max(completed_at) from public.tasks k where k.organization_id = v_org and k.customer_id = p_customer and k.completed_at is not null and k.deleted_at is null
        union all select max(created_at) from public.activity_events e where e.organization_id = v_org and e.customer_id = p_customer and e.event in ('status_sent', 'status_accepted', 'status_rejected')
        union all select max(called_at) from public.call_logs c where c.organization_id = v_org and c.customer_id = p_customer and c.outcome in ('answered', 'interested', 'not_interested', 'callback', 'other')
        union all select max(starts_at) from public.appointments a where a.organization_id = v_org and a.customer_id = p_customer and a.status = 'completed' and a.deleted_at is null) x));
end $$;
