-- NEXORA 2.0 – 19 CRM completo: archiviazione/ripristino clienti, eliminazione definitiva controllata,
-- anagrafica estesa, fatture registrate (estensione di quote_billings), sintesi del valore commerciale.
-- Solo aggiunte. Sostituisce: activity_trigger (eventi archivio/incassi), quote_billings_guard, customers_to_recontact.
-- ATTENZIONE: nessuna funzione fiscale. Le fatture qui sono REGISTRAZIONI di dati, non documenti fiscali.

-- ============================================================ 1. clienti: archivio e anagrafica
alter table public.customers add column archived_at timestamptz;
alter table public.customers add column archived_by uuid references auth.users (id) on delete set null;
alter table public.customers add column website text check (char_length(coalesce(website, '')) <= 200);
alter table public.customers add column customer_type text not null default 'company' check (customer_type in ('company', 'private', 'public', 'other'));
alter table public.customers add column industry text check (char_length(coalesce(industry, '')) <= 100);
create index customers_archived_idx on public.customers (organization_id, archived_at) where archived_at is not null and deleted_at is null;

-- data e autore dell'archiviazione sono decisi dal database (non falsificabili dal client)
create function private.customers_archive_meta() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.archived_at is distinct from old.archived_at then
    if new.archived_at is not null then
      new.archived_at := now(); new.archived_by := (select auth.uid());
    else
      new.archived_by := null;
    end if;
  else
    new.archived_by := old.archived_by;
  end if;
  return new;
end $$;
create trigger customers_archive_meta before update on public.customers for each row execute function private.customers_archive_meta();

-- nuovi preventivi: mai su clienti archiviati o rimossi
create function private.quotes_customer_active() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id
             and (c.archived_at is not null or c.deleted_at is not null)) then
    raise exception 'customer is archived' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger quotes_customer_active before insert on public.quotes for each row execute function private.quotes_customer_active();

-- clienti da ricontattare: gli archiviati non vengono proposti
create or replace function public.customers_to_recontact(p_org uuid, p_days int default 60, p_limit int default 20)
returns table (customer_id uuid, name text, last_activity timestamptz, open_quotes bigint)
language sql stable set search_path = '' as $$
  select c.id, c.name, coalesce(max(e.created_at), c.created_at) as last_activity,
         (select count(*) from public.quotes q where q.organization_id = c.organization_id and q.customer_id = c.id
            and q.deleted_at is null and q.status in ('draft', 'sent')) as open_quotes
  from public.customers c
  left join public.activity_events e on e.organization_id = c.organization_id and e.customer_id = c.id
  where c.organization_id = p_org and c.deleted_at is null and c.archived_at is null and c.status <> 'inactive'
  group by c.id, c.name, c.created_at, c.organization_id
  having coalesce(max(e.created_at), c.created_at) < now() - make_interval(days => p_days)
  order by last_activity asc
  limit least(greatest(p_limit, 1), 100);
$$;

-- ============================================================ 2. fatture registrate (estende quote_billings, senza duplicarla)
-- amount_cents resta il TOTALE fatturato (IVA inclusa). Nuovi campi: imponibile, IVA, incasso. quote_id diventa facoltativo.
alter table public.quote_billings alter column quote_id drop not null;
alter table public.quote_billings add column taxable_cents bigint check (taxable_cents is null or (taxable_cents > 0 and taxable_cents <= 100000000000));
alter table public.quote_billings add column vat_cents bigint check (vat_cents is null or (vat_cents >= 0 and vat_cents <= 100000000000));
alter table public.quote_billings add column payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid'));
alter table public.quote_billings add column paid_at date;
alter table public.quote_billings add constraint quote_billings_vat_pair check ((taxable_cents is null) = (vat_cents is null));
alter table public.quote_billings add constraint quote_billings_vat_sum check (taxable_cents is null or taxable_cents + vat_cents = amount_cents);
alter table public.quote_billings add constraint quote_billings_paid_pair check ((payment_status = 'paid') = (paid_at is not null));
alter table public.quote_billings add constraint quote_billings_paid_after check (paid_at is null or paid_at >= billed_at);
alter table public.quote_billings add constraint quote_billings_customer_fk
  foreign key (customer_id, organization_id) references public.customers (id, organization_id);
grant update (taxable_cents, vat_cents, payment_status, paid_at) on public.quote_billings to authenticated;
-- il cliente non cambia dopo la registrazione
create function private.quote_billings_lock() returns trigger language plpgsql set search_path = '' as $$
begin new.customer_id := old.customer_id; new.quote_id := old.quote_id; return new; end $$;
create trigger quote_billings_lock before update on public.quote_billings for each row execute function private.quote_billings_lock();

create or replace function private.quote_billings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  if new.quote_id is not null then
    select customer_id, status into q from public.quotes where id = new.quote_id and organization_id = new.organization_id;
    if q.status is distinct from 'accepted' then
      raise exception 'billing can only be recorded on an accepted quote' using errcode = '23514';
    end if;
    new.customer_id := q.customer_id;
  end if;
  return new;
end $$;

-- timeline: eventi di archivio/ripristino e incassi (la funzione si sostituisce per intero)
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
    elsif tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null then v_event := 'archived'; v_summary := 'Cliente archiviato';
    elsif tg_op = 'UPDATE' and new.archived_at is null and old.archived_at is not null then v_event := 'restored'; v_summary := 'Cliente ripristinato';
    elsif tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'archived_at' - 'archived_by') is distinct from (to_jsonb(old) - 'updated_at' - 'archived_at' - 'archived_by') then v_event := 'updated'; v_summary := 'Dati del cliente modificati';
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
    v_customer := (v_row ->> 'customer_id')::uuid;
    if (v_row ->> 'quote_id') is not null then
      v_entity := 'quote'; v_id := (v_row ->> 'quote_id')::uuid;
      select number into v_number from public.quotes where id = v_id;
    else
      v_entity := 'customer'; v_id := v_customer;
    end if;
    if tg_op = 'INSERT' then
      v_event := 'billed';
      v_summary := 'Fattura registrata: € ' || translate(to_char(new.amount_cents / 100.0, 'FM999,999,990.00'), ',.', '.,')
        || coalesce(' n. ' || new.reference, '') || coalesce(' (preventivo ' || v_number || ')', '');
    elsif tg_op = 'DELETE' then
      v_event := 'billing_removed';
      v_summary := 'Fattura rimossa: € ' || translate(to_char(old.amount_cents / 100.0, 'FM999,999,990.00'), ',.', '.,') || coalesce(' n. ' || old.reference, '');
    elsif new.payment_status is distinct from old.payment_status then
      v_event := case when new.payment_status = 'paid' then 'payment_received' else 'payment_reopened' end;
      v_summary := case when new.payment_status = 'paid' then 'Incasso registrato: € ' else 'Incasso annullato: € ' end
        || translate(to_char(new.amount_cents / 100.0, 'FM999,999,990.00'), ',.', '.,') || coalesce(' fattura n. ' || new.reference, '');
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
drop trigger quote_billings_activity on public.quote_billings;
create trigger quote_billings_activity after insert or update or delete on public.quote_billings for each row execute function private.activity_trigger();

-- ============================================================ 3. eliminazione definitiva controllata
-- Elenco di ciò che impedisce l'eliminazione (conta anche i record rimossi/archiviati: non si perde storico).
create function public.customer_delete_blockers(p_customer uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when exists (select 1 from public.customers c where c.id = p_customer) then jsonb_build_object(
    'quotes', (select count(*) from public.quotes q where q.customer_id = p_customer),
    'invoices', (select count(*) from public.quote_billings b where b.customer_id = p_customer),
    'documents', (select count(*) from public.documents d where d.customer_id = p_customer),
    'tasks', (select count(*) from public.tasks t where t.customer_id = p_customer),
    'contacts', (select count(*) from public.customer_contacts k where k.customer_id = p_customer),
    'notes', (select count(*) from public.customer_notes n where n.customer_id = p_customer)) end;
$$;
revoke all on function public.customer_delete_blockers(uuid) from public, anon;
grant execute on function public.customer_delete_blockers(uuid) to authenticated;

-- Eliminazione fisica: solo titolare/amministratori, solo se il cliente è già archiviato e non ha preventivi, fatture,
-- documenti né attività. Referenti, note e cronologia del cliente vengono eliminati con lui; l'audit resta.
create function public.delete_customer_permanently(p_customer uuid) returns void
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
    'tasks', (select count(*) from public.tasks t where t.customer_id = p_customer)) into b;
  if (b ->> 'quotes')::int + (b ->> 'invoices')::int + (b ->> 'documents')::int + (b ->> 'tasks')::int > 0 then
    raise exception 'customer has linked records' using errcode = 'P0001', detail = b::text;
  end if;
  delete from public.customers where id = p_customer and organization_id = c.organization_id;
  -- dopo: l'eliminazione a cascata dei referenti genera a sua volta eventi di cronologia
  delete from public.activity_events where organization_id = c.organization_id and customer_id = p_customer;
end $$;
revoke all on function public.delete_customer_permanently(uuid) from public, anon;
grant execute on function public.delete_customer_permanently(uuid) to authenticated;

-- ============================================================ 4. valore commerciale: UNICA fonte dei calcoli
-- Preventivi "emessi" = non bozze. Accettato ≠ fatturato ≠ incassato: tre misure separate.
create function public.customer_commercial_summary(p_customer uuid) returns jsonb
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
        union all select max(created_at) from public.activity_events e where e.organization_id = v_org and e.customer_id = p_customer and e.event in ('status_sent', 'status_accepted', 'status_rejected')) x));
end $$;
revoke all on function public.customer_commercial_summary(uuid) from public, anon;
grant execute on function public.customer_commercial_summary(uuid) to authenticated;
