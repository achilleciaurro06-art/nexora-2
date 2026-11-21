-- NEXORA 2.0 – 16 impostazioni: dati aziendali completi, profilo personale, avatar, preferenze di notifica.
-- Solo aggiunte. Le impostazioni "a chiave" (IVA predefinita, contesto AI, email, aspetto) usano organizations.settings
-- e profiles.preferences (jsonb) convalidati dall'app: nessuna colonna per ogni preferenza.

-- ============================================================ azienda
alter table public.organizations
  add column pec text,
  add column legal_address text,
  add column bank_name text,
  add column iban text;
alter table public.organizations
  add constraint organizations_extra_lengths check (
    char_length(coalesce(pec, '')) <= 200 and char_length(coalesce(legal_address, '')) <= 300
    and char_length(coalesce(bank_name, '')) <= 120 and char_length(coalesce(iban, '')) <= 40);
grant update (pec, legal_address, bank_name, iban) on public.organizations to authenticated;

-- ============================================================ profilo personale
alter table public.profiles
  add column job_title text check (char_length(coalesce(job_title, '')) <= 120),
  add column avatar_path text,
  add column preferences jsonb not null default '{}'::jsonb;
alter table public.profiles
  add constraint profiles_avatar_in_own_folder check (avatar_path is null or avatar_path like id::text || '/%'),
  add constraint profiles_preferences_object check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) < 8192);
grant update (job_title, avatar_path, preferences) on public.profiles to authenticated;

-- avatar: bucket privato; ognuno scrive nella propria cartella {user_id}/, lo vedono i colleghi delle stesse organizzazioni
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (private.storage_org(name) = (select auth.uid()) or private.shares_org_with(private.storage_org(name))));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and private.storage_org(name) = (select auth.uid()));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and private.storage_org(name) = (select auth.uid()))
  with check (bucket_id = 'avatars' and private.storage_org(name) = (select auth.uid()));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and private.storage_org(name) = (select auth.uid()));

-- ============================================================ notifiche: rispettano le preferenze dell'utente
-- preferenze (profiles.preferences -> 'notifications'): {task_due_soon, task_overdue, quote_followup, reminder, task_assigned: bool, due_soon_hours: 1..168}
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
