-- NEXORA 2.0 – 17 preventivi completi: numerazione configurabile, storico revisioni, fatturato registrato, duplicazione.
-- Solo aggiunte (più la sostituzione di due funzioni interne). Nessun dato esistente viene modificato:
-- le revisioni di partenza sono un inserimento nuovo.

-- ============================================================ 1. numerazione configurabile
alter table public.organizations
  add column quote_numbering jsonb not null default '{"prefix":"","digits":4,"yearly":true}'::jsonb;
alter table public.organizations
  add constraint organizations_quote_numbering_valid check (
    jsonb_typeof(quote_numbering) = 'object'
    and quote_numbering ->> 'digits' ~ '^[3-8]$'
    and char_length(coalesce(quote_numbering ->> 'prefix', '')) <= 10
    and coalesce(quote_numbering ->> 'prefix', '') ~ '^[A-Za-z0-9._-]*$'
    and jsonb_typeof(quote_numbering -> 'yearly') = 'boolean');
grant update (quote_numbering) on public.organizations to authenticated;

create or replace function private.quotes_assign_number() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb;
  v_yearly boolean;
  v_digits int;
  v_prefix text;
  v_year int := extract(year from new.issue_date)::int;
begin
  select quote_numbering into cfg from public.organizations where id = new.organization_id;
  v_yearly := coalesce((cfg ->> 'yearly')::boolean, true);
  v_digits := coalesce((cfg ->> 'digits')::int, 4);
  v_prefix := coalesce(cfg ->> 'prefix', '');
  new.year := case when v_yearly then v_year else 0 end;
  new.seq := private.next_quote_number(new.organization_id, new.year);
  new.number := v_prefix || case when v_yearly then v_year::text || '/' else '' end || lpad(new.seq::text, v_digits, '0');
  return new;
end $$;

-- Imposta il PROSSIMO numero (mai riutilizzando numeri già emessi): solo owner/admin.
create function public.set_quote_next_number(p_org uuid, p_next int, p_year int default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_yearly boolean;
  v_scope int;
  v_last int;
begin
  if not private.has_role(p_org, array['owner', 'admin']) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_next is null or p_next < 1 or p_next > 99999999 then
    raise exception 'invalid number' using errcode = '22023';
  end if;
  select coalesce((quote_numbering ->> 'yearly')::boolean, true) into v_yearly from public.organizations where id = p_org;
  v_scope := case when v_yearly then coalesce(p_year, extract(year from current_date)::int) else 0 end;
  insert into private.quote_counters as c (organization_id, year, last_number)
  values (p_org, v_scope, p_next - 1)
  on conflict (organization_id, year) do update set last_number = greatest(c.last_number, excluded.last_number)
  returning last_number into v_last;
  return v_last + 1;
end $$;
revoke all on function public.set_quote_next_number(uuid, int, int) from public, anon;
grant execute on function public.set_quote_next_number(uuid, int, int) to authenticated;

-- ============================================================ 2. storico delle revisioni
create table public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quote_id uuid not null,
  version int not null,
  summary text not null,
  snapshot jsonb not null,
  txid bigint not null default txid_current(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quote_id, version),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete cascade
);
create index quote_revisions_idx on public.quote_revisions (organization_id, quote_id, version desc);
alter table public.quote_revisions enable row level security;
create policy quote_revisions_select on public.quote_revisions for select to authenticated
  using (private.is_member(organization_id));
revoke insert, update, delete, truncate on public.quote_revisions from authenticated;

create function private.quote_snapshot(p_quote uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'customer_id', q.customer_id, 'title', q.title, 'status', q.status, 'issue_date', q.issue_date, 'valid_until', q.valid_until,
    'follow_up_date', q.follow_up_date, 'notes', q.notes, 'terms', q.terms, 'total_cents', q.total_cents,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents,
                                          'discount_percent', i.discount_percent, 'vat_rate', i.vat_rate) order by i.position, i.created_at)
      from public.quote_items i where i.quote_id = q.id), '[]'::jsonb))
  from public.quotes q where q.id = p_quote;
$$;

-- Registra una revisione quando cambiano i CONTENUTI del preventivo (non lo stato). Più modifiche nella stessa
-- transazione (es. salvataggio con molte righe) producono una sola revisione.
create function private.record_quote_revision(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_snap jsonb;
  v_base jsonb;
  v_org uuid;
  v_same uuid;
  v_changes text[] := '{}';
  v_summary text;
  k text;
  labels constant jsonb := '{"customer_id":"cliente","title":"oggetto","issue_date":"data","valid_until":"validità","follow_up_date":"follow-up","notes":"note","terms":"condizioni"}';
begin
  select organization_id into v_org from public.quotes where id = p_quote;
  if v_org is null then return; end if;  -- preventivo già eliminato (cascata)
  v_snap := private.quote_snapshot(p_quote);
  select snapshot into v_base from public.quote_revisions where quote_id = p_quote and txid <> txid_current() order by version desc limit 1;

  if v_base is null then
    v_summary := 'Preventivo creato';
  else
    for k in select jsonb_object_keys(labels) loop
      if (v_snap -> k) is distinct from (v_base -> k) then v_changes := array_append(v_changes, labels ->> k); end if;
    end loop;
    if (v_snap -> 'items') is distinct from (v_base -> 'items') then v_changes := array_append(v_changes, 'righe'::text); end if;
    if cardinality(v_changes) = 0 then
      select id into v_same from public.quote_revisions where quote_id = p_quote and txid = txid_current();
      if v_same is not null then delete from public.quote_revisions where id = v_same; end if;
      return;
    end if;
    v_summary := 'Modificato: ' || array_to_string(v_changes, ', ');
  end if;

  select id into v_same from public.quote_revisions where quote_id = p_quote and txid = txid_current();
  if v_same is not null then
    update public.quote_revisions set snapshot = v_snap, summary = v_summary where id = v_same;
  else
    insert into public.quote_revisions (organization_id, quote_id, version, summary, snapshot, created_by)
    values (v_org, p_quote, coalesce((select max(version) from public.quote_revisions where quote_id = p_quote), 0) + 1, v_summary, v_snap, (select auth.uid()));
  end if;
end $$;
revoke all on function private.quote_snapshot(uuid), private.record_quote_revision(uuid) from public, anon, authenticated;

create function private.quotes_revision_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_quote_revision(new.id);
  elsif (new.customer_id, new.title, new.issue_date, new.valid_until, new.follow_up_date, new.notes, new.terms)
        is distinct from (old.customer_id, old.title, old.issue_date, old.valid_until, old.follow_up_date, old.notes, old.terms) then
    perform private.record_quote_revision(new.id);
  end if;
  return null;
end $$;
create trigger quotes_revision after insert or update on public.quotes for each row execute function private.quotes_revision_trigger();

create function private.quote_items_revision_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.record_quote_revision(coalesce(new.quote_id, old.quote_id));
  return null;
end $$;
create trigger quote_items_revision after insert or update or delete on public.quote_items for each row execute function private.quote_items_revision_trigger();
revoke all on function private.quotes_revision_trigger(), private.quote_items_revision_trigger() from public, anon, authenticated;

-- revisione iniziale dei preventivi già esistenti
insert into public.quote_revisions (organization_id, quote_id, version, summary, snapshot, txid, created_by, created_at)
select q.organization_id, q.id, 1, 'Stato iniziale (storico attivato)', private.quote_snapshot(q.id), 0, q.created_by, now() from public.quotes q;

-- ============================================================ 3. fatturato registrato (distinto dal valore dei preventivi)
create table public.quote_billings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quote_id uuid not null,
  customer_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  billed_at date not null default current_date,
  reference text check (char_length(coalesce(reference, '')) <= 80),
  note text check (char_length(coalesce(note, '')) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete cascade
);
create index quote_billings_quote_idx on public.quote_billings (organization_id, quote_id);
create index quote_billings_customer_idx on public.quote_billings (organization_id, customer_id, billed_at desc);
alter table public.quote_billings enable row level security;
create policy quote_billings_select on public.quote_billings for select to authenticated using (private.is_member(organization_id));
create policy quote_billings_insert on public.quote_billings for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin', 'member']) and created_by = (select auth.uid()));
create policy quote_billings_update on public.quote_billings for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin', 'member']))
  with check (private.has_role(organization_id, array['owner', 'admin', 'member']));
create policy quote_billings_delete on public.quote_billings for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));
revoke update on public.quote_billings from authenticated;
grant update (amount_cents, billed_at, reference, note) on public.quote_billings to authenticated;

create function private.quote_billings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  select customer_id, status into q from public.quotes where id = new.quote_id and organization_id = new.organization_id;
  if q.status is distinct from 'accepted' then
    raise exception 'billing can only be recorded on an accepted quote' using errcode = '23514';
  end if;
  new.customer_id := q.customer_id;
  return new;
end $$;
create trigger quote_billings_guard before insert on public.quote_billings for each row execute function private.quote_billings_guard();
create trigger quote_billings_updated_at before update on public.quote_billings for each row execute function private.set_updated_at();
create trigger quote_billings_org_immutable before update on public.quote_billings for each row execute function private.prevent_org_change();
create trigger quote_billings_audit after insert or update or delete on public.quote_billings for each row execute function private.audit_trigger();

-- timeline: registrazione del fatturato (la funzione viene sostituita aggiungendo il ramo "quote_billings")
create or replace function private.activity_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid := (v_row ->> 'organization_id')::uuid;
  v_id uuid := (v_row ->> 'id')::uuid;
  v_customer uuid;
  v_entity text;
  v_event text;
  v_summary text;
  v_number text;
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

  elsif tg_table_name = 'quote_billings' then
    v_entity := 'quote'; v_customer := (v_row ->> 'customer_id')::uuid;
    select number into v_number from public.quotes where id = (v_row ->> 'quote_id')::uuid;
    v_id := (v_row ->> 'quote_id')::uuid;
    if tg_op = 'INSERT' then
      v_event := 'billed';
      v_summary := 'Fatturato registrato: € ' || to_char(new.amount_cents / 100.0, 'FM999G999G990D00') || ' sul preventivo ' || coalesce(v_number, '');
    elsif tg_op = 'DELETE' then
      v_event := 'billing_removed';
      v_summary := 'Registrazione di fatturato rimossa dal preventivo ' || coalesce(v_number, '');
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
create trigger quote_billings_activity after insert or delete on public.quote_billings for each row execute function private.activity_trigger();

-- ============================================================ 4. duplicazione di un preventivo
create function public.duplicate_quote(p_quote uuid) returns uuid
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
  return v_new;
end $$;
revoke all on function public.duplicate_quote(uuid) from public, anon;
grant execute on function public.duplicate_quote(uuid) to authenticated;
