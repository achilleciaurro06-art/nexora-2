-- Migrazione 10: timeline, notifiche, note, profilo aziendale, audit, storage branding, cancellazione organizzazione.
\set ON_ERROR_STOP on
begin;
create schema tl3; grant usage on schema tl3 to public;
create function tl3.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
create function tl3.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
create function tl3.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema tl3 to public;

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('a3000000-0000-0000-0000-00000000000a', 'owner-a@a.it'),
  ('a3000000-0000-0000-0000-0000000000a2', 'member-a@a.it'),
  ('a3000000-0000-0000-0000-0000000000a3', 'viewer-a@a.it'),
  ('b3000000-0000-0000-0000-00000000000b', 'owner-b@b.it');
set local role service_role;
select public.rpc_create_activation_code('c-a', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('c-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('c-a', 'owner-a@a.it', 'Alfa', 'a3000000-0000-0000-0000-00000000000a', 'Owner A') as oa \gset
select public.rpc_redeem_activation_code('c-b', 'owner-b@b.it', 'Beta', 'b3000000-0000-0000-0000-00000000000b', 'Owner B') as ob \gset
insert into public.memberships (organization_id, user_id, role) values
  (:'oa', 'a3000000-0000-0000-0000-0000000000a2', 'member'),
  (:'oa', 'a3000000-0000-0000-0000-0000000000a3', 'viewer');
reset role;

-- ---------------------------------------------------------------- cancellazione organizzazione (bug corretto)
set local role service_role;
select public.rpc_create_activation_code('c-z', now() + interval '1 day', 1, null, null, null);
reset role;
insert into auth.users (id, email) values ('c3000000-0000-0000-0000-00000000000c', 'z@z.it');
set local role service_role;
select public.rpc_redeem_activation_code('c-z', 'z@z.it', 'Zeta', 'c3000000-0000-0000-0000-00000000000c', 'Z') as oz \gset
insert into public.customers (organization_id, name) values (:'oz', 'CZ') returning id as cz \gset
insert into public.customer_contacts (organization_id, customer_id, full_name) values (:'oz', :'cz', 'Ref Z');
reset role;
delete from public.organizations where id = :'oz';
select tl3.check('organization with data can be deleted (cascade, audit and timeline do not break)',
  not exists (select 1 from public.organizations where id = :'oz')
  and not exists (select 1 from public.customers where organization_id = :'oz'));

-- ---------------------------------------------------------------- profilo aziendale
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-00000000000a';
update public.organizations set address = 'Via Roma 1', tax_code = 'RSSMRA80A01L219X', email = 'info@alfa.it',
  phone = '011 123', website = 'https://alfa.it', quote_footer = 'IBAN IT00', quote_default_terms = 'Pagamento 30gg'
  where id = :'oa';
select tl3.check('owner updates company profile', (select address from public.organizations where id = :'oa') = 'Via Roma 1');
select tl3.denies('logo must live in own _branding folder',
  format($$update public.organizations set logo_path = %L where id = %L$$, :'ob' || '/_branding/x.png', :'oa'));
update public.organizations set logo_path = :'oa' || '/_branding/logo.png' where id = :'oa';
select tl3.check('logo path accepted in own folder', true);
select tl3.denies('status stays protected', format($$update public.organizations set status = 'suspended' where id = %L$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select tl3.check('member cannot update company profile',
  tl3.affected(format($$update public.organizations set address = 'hack' where id = %L$$, :'oa')) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-0000-0000-00000000000b';
select tl3.check('other tenant cannot update org A',
  tl3.affected(format($$update public.organizations set address = 'hack' where id = %L$$, :'oa')) = 0);
reset role;

-- ---------------------------------------------------------------- dati operativi come membro
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
insert into public.customers (id, organization_id, name, created_by) values ('d3000000-0000-0000-0000-00000000000a', :'oa', 'Cliente A', 'a3000000-0000-0000-0000-0000000000a2');
insert into public.customer_contacts (organization_id, customer_id, full_name, notes) values (:'oa', 'd3000000-0000-0000-0000-00000000000a', 'Mario Rossi', 'preferisce email');
update public.customer_contacts set full_name = 'Mario Bianchi' where full_name = 'Mario Rossi';
delete from public.customer_contacts where full_name = 'Mario Bianchi' and false;
insert into public.customer_notes (organization_id, customer_id, body, created_by)
  values (:'oa', 'd3000000-0000-0000-0000-00000000000a', 'Chiamato oggi', 'a3000000-0000-0000-0000-0000000000a2');
select tl3.denies('note author must be the caller',
  format($$insert into public.customer_notes (organization_id, customer_id, body, created_by) values (%L, 'd3000000-0000-0000-0000-00000000000a', 'x', 'a3000000-0000-0000-0000-00000000000a')$$, :'oa'));
select public.save_quote(null, :'oa', 'd3000000-0000-0000-0000-00000000000a', 'Sito', '2026-05-01', null, null, null,
  '[{"description":"Sito web","quantity":1,"unit_price_cents":150000}]', current_date) as q1 \gset
update public.quotes set status = 'sent' where id = :'q1';
select tl3.denies('assignee must belong to the same organization',
  format($$insert into public.tasks (organization_id, title, assignee_id) values (%L, 'x', 'b3000000-0000-0000-0000-00000000000b')$$, :'oa'));
reset role;

-- eventi di timeline generati dai trigger
select tl3.check('timeline: customer, contact, note, quote created and sent are recorded', (
  select count(*) filter (where summary = 'Cliente creato') = 1
     and count(*) filter (where summary = 'Referente aggiunto: Mario Rossi') = 1
     and count(*) filter (where summary = 'Referente modificato: Mario Bianchi') = 1
     and count(*) filter (where summary = 'Nota aggiunta') = 1
     and count(*) filter (where event = 'status_sent') = 1
     and count(*) filter (where event = 'follow_up') = 0
  from public.activity_events where customer_id = 'd3000000-0000-0000-0000-00000000000a'));

-- attività assegnata dal titolare al membro, in scadenza fra 12 ore
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-00000000000a';
insert into public.tasks (id, organization_id, title, due_at, assignee_id, customer_id, quote_id, created_by)
  values ('e3000000-0000-0000-0000-000000000001', :'oa', 'Richiamare Rossi', now() + interval '12 hours',
          'a3000000-0000-0000-0000-0000000000a2', 'd3000000-0000-0000-0000-00000000000a', :'q1', 'a3000000-0000-0000-0000-00000000000a');
insert into public.tasks (id, organization_id, title, due_at, assignee_id, created_by)
  values ('e3000000-0000-0000-0000-000000000002', :'oa', 'Inviare contratto', now() - interval '1 day',
          'a3000000-0000-0000-0000-0000000000a2', 'a3000000-0000-0000-0000-00000000000a');
insert into public.reminders (organization_id, task_id, remind_at) values (:'oa', 'e3000000-0000-0000-0000-000000000001', now() - interval '1 minute');
select tl3.check('assigned_by is recorded', (select assigned_by from public.tasks where id = 'e3000000-0000-0000-0000-000000000001') = 'a3000000-0000-0000-0000-00000000000a');
update public.tasks set status = 'done' where id = 'e3000000-0000-0000-0000-000000000002';
update public.tasks set status = 'todo' where id = 'e3000000-0000-0000-0000-000000000002';
reset role;
select tl3.check('timeline: task completed and reopened', (
  select count(*) filter (where event = 'completed') = 1 and count(*) filter (where event = 'reopened') = 1
  from public.activity_events where entity = 'task' and organization_id = :'oa'));

-- ---------------------------------------------------------------- notifiche
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select public.refresh_my_notifications() as n1 \gset
select tl3.check('first refresh creates 6 notifications (due-soon, overdue, follow-up, reminder, 2 assigned)', :n1 = 6);
reset role;
select tl3.check('notification kinds generated for the member', (
  select array_agg(kind order by kind) from public.notifications where user_id = 'a3000000-0000-0000-0000-0000000000a2')
  @> array['quote_followup', 'reminder', 'task_assigned', 'task_due_soon', 'task_overdue']);
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select tl3.check('refresh is idempotent', public.refresh_my_notifications() = 0);
select tl3.check('reminder marked as sent', (select status from public.reminders limit 1) = 'sent');
select tl3.check('member sees own notifications only', (select count(*) from public.notifications) = (select count(*) from public.notifications where user_id = 'a3000000-0000-0000-0000-0000000000a2') and (select count(*) from public.notifications) >= 5);
update public.notifications set read_at = now() where kind = 'reminder';
select tl3.denies('notification content is not editable', $$update public.notifications set title = 'x'$$);
select tl3.denies('notifications cannot be forged', format($$insert into public.notifications (organization_id, user_id, kind, title, dedupe_key) values (%L, 'a3000000-0000-0000-0000-0000000000a2', 'reminder', 'x', 'k')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-00000000000a';
select tl3.check('owner does not see the member notifications', (select count(*) from public.notifications where user_id = 'a3000000-0000-0000-0000-0000000000a2') = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-0000-0000-00000000000b';
select tl3.check('other tenant gets nothing and sees nothing', public.refresh_my_notifications() = 0 and (select count(*) from public.notifications) = 0);
select tl3.check('other tenant sees no timeline, notes, contacts of org A',
  (select count(*) from public.activity_events) = 0 and (select count(*) from public.customer_notes) = 0 and (select count(*) from public.customer_contacts) = 0);
reset role;

-- ---------------------------------------------------------------- clienti da ricontattare
update public.activity_events set created_at = now() - interval '90 days' where customer_id = 'd3000000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select tl3.check('stale customer is reported for recontact (with open quote)', (
  select count(*) = 1 and max(open_quotes) = 1 from public.customers_to_recontact(:'oa', 60, 10)));
select tl3.check('foreign org id yields no rows (RLS)', (select count(*) from public.customers_to_recontact(:'ob', 60, 10)) = 0);
reset role;
set local role anon;
select tl3.denies('anon cannot call customers_to_recontact', format($$select * from public.customers_to_recontact(%L)$$, :'oa'));
reset role;

-- ---------------------------------------------------------------- audit per ruolo
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select tl3.check('member sees only own audit rows, and has some',
  (select count(*) from public.audit_logs) > 0 and (select count(*) from public.audit_logs where actor_id is distinct from 'a3000000-0000-0000-0000-0000000000a2') = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-00000000000a';
select tl3.check('owner sees all org audit rows incl. contacts and notes', (
  select count(distinct entity) from public.audit_logs where entity in ('customer_contacts', 'customer_notes', 'customers', 'tasks', 'quotes')) = 5);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a3';
select tl3.check('viewer sees no audit rows (never acted)', (select count(*) from public.audit_logs) = 0);
reset role;

-- ---------------------------------------------------------------- audit di piattaforma
set local role service_role;
select public.rpc_log_platform_action('a3000000-0000-0000-0000-00000000000a', 'set_org_status', :'oa', '{"status":"suspended"}');
select tl3.check('platform action is recorded', (select count(*) from public.rpc_list_platform_audit()) = 1);
reset role;
set local role authenticated;
select tl3.denies('authenticated cannot read platform audit', $$select * from public.rpc_list_platform_audit()$$);
select tl3.denies('authenticated cannot read platform audit table', $$select * from private.platform_audit$$);
reset role;

-- ---------------------------------------------------------------- storage: logo
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select tl3.denies('member cannot write the branding folder',
  format($$insert into storage.objects (bucket_id, name) values ('documents', %L)$$, :'oa' || '/_branding/logo.png'));
insert into storage.objects (bucket_id, name) values ('documents', :'oa' || '/doc1/file.pdf');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-00000000000a';
insert into storage.objects (bucket_id, name) values ('documents', :'oa' || '/_branding/logo.png');
select tl3.check('owner can write the branding folder', true);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-0000-0000-00000000000b';
select tl3.check('other tenant cannot read org A branding or documents', (select count(*) from storage.objects) = 0);
reset role;

-- ---------------------------------------------------------------- suggerimenti AI: nuovi tipi
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
insert into public.ai_suggestions (organization_id, kind, payload, source_type, created_by)
  values (:'oa', 'price_review', '{"verdict":"low"}', 'quote', 'a3000000-0000-0000-0000-0000000000a2'),
         (:'oa', 'quote_followup', '{}', 'conversation', 'a3000000-0000-0000-0000-0000000000a2'),
         (:'oa', 'customer_followup', '{}', 'conversation', 'a3000000-0000-0000-0000-0000000000a2'),
         (:'oa', 'customer_note', '{}', 'conversation', 'a3000000-0000-0000-0000-0000000000a2');
select tl3.check('new suggestion kinds accepted', (select count(*) from public.ai_suggestions) = 4);
reset role;

-- ---------------------------------------------------------------- analisi prezzi (migrazione 11)
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
insert into public.price_analyses (organization_id, quote_id, items, created_by)
  values (:'oa', :'q1', '[{"verdict":"insufficient_data"}]', 'a3000000-0000-0000-0000-0000000000a2');
select tl3.check('member stores a price analysis', (select count(*) from public.price_analyses) = 1);
select tl3.denies('price analyses cannot be edited', $$update public.price_analyses set items = '[]'$$);
select tl3.denies('price analysis for a foreign quote is rejected',
  format($$insert into public.price_analyses (organization_id, quote_id, items, created_by) values (%L, %L, '[]', 'a3000000-0000-0000-0000-0000000000a2')$$, :'ob', :'q1'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a3';
select tl3.denies('viewer cannot create price analyses',
  format($$insert into public.price_analyses (organization_id, quote_id, items, created_by) values (%L, %L, '[]', 'a3000000-0000-0000-0000-0000000000a3')$$, :'oa', :'q1'));
select tl3.check('viewer can read price analyses', (select count(*) from public.price_analyses) = 1);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-0000-0000-00000000000b';
select tl3.check('other tenant sees no price analyses', (select count(*) from public.price_analyses) = 0);
reset role;

-- ---------------------------------------------------------------- audit delle righe preventivo (migrazione 12)
-- (tutto il test gira in una sola transazione: si retrodatano le righe precedenti per simulare azioni separate nel tempo)
update public.audit_logs set created_at = now() - interval '1 minute' where entity = 'quotes' and entity_id = :'q1';
update public.quotes set items_updated_at = now() - interval '1 minute' where id = :'q1';
update public.audit_logs set created_at = now() - interval '1 minute' where entity = 'quotes' and entity_id = :'q1';
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select count(*) as before_n from public.audit_logs where entity = 'quotes' and entity_id = :'q1' \gset
update public.quote_items set unit_price_cents = 160000 where quote_id = :'q1';
select tl3.check('editing only the lines of a quote is audited', (select count(*) from public.audit_logs where entity = 'quotes' and entity_id = :'q1') = :before_n + 1);
select tl3.check('audit row names the tracked field', exists (select 1 from public.audit_logs where entity = 'quotes' and entity_id = :'q1' and 'items_updated_at' = any (changed_fields)));
select public.save_quote(null, :'oa', 'd3000000-0000-0000-0000-00000000000a', 'Bozza2', null, null, null, null, '[{"description":"x","quantity":1,"unit_price_cents":100}]') as q2 \gset
reset role;
update public.audit_logs set created_at = now() - interval '1 minute' where entity = 'quotes' and entity_id = :'q2';
update public.quotes set items_updated_at = now() - interval '1 minute' where id = :'q2';
update public.audit_logs set created_at = now() - interval '1 minute' where entity = 'quotes' and entity_id = :'q2';
select count(*) as q2_before from public.audit_logs where entity = 'quotes' and entity_id = :'q2' and action = 'update' \gset
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select public.save_quote(:'q2', :'oa', 'd3000000-0000-0000-0000-00000000000a', 'Bozza2', null, null, null, null,
  '[{"description":"a","quantity":1,"unit_price_cents":100},{"description":"b","quantity":1,"unit_price_cents":200},{"description":"c","quantity":1,"unit_price_cents":300},{"description":"d","quantity":1,"unit_price_cents":400}]');
reset role;
select tl3.check('rewriting 4 lines produces a single collapsed audit row (not one per line)', (
  select count(*) from public.audit_logs where entity = 'quotes' and entity_id = :'q2' and action = 'update') = :q2_before + 1);

select tl3.check('member editing a draft replaces the lines (no duplicates)', (select count(*) from public.quote_items where quote_id = :'q2') = 4);
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select tl3.check('member cannot delete lines of a quote that is not a draft',
  tl3.affected(format($$delete from public.quote_items where quote_id = %L$$, :'q1')) = 0);
reset role;

-- ---------------------------------------------------------------- rimozione cliente (migrazione 14)
reset role;
insert into public.customers (id, organization_id, name) values ('d3000000-0000-0000-0000-0000000000f1', :'oa', 'Cliente da rimuovere');
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-0000000000a2';
select public.save_quote(null, :'oa', 'd3000000-0000-0000-0000-0000000000f1', 'Aperto 1', null, null, null, null, '[{"description":"x","quantity":1,"unit_price_cents":100}]') as rq1 \gset
select public.save_quote(null, :'oa', 'd3000000-0000-0000-0000-0000000000f1', 'Accettato', null, null, null, null, '[{"description":"x","quantity":1,"unit_price_cents":100}]') as rq2 \gset
update public.quotes set status = 'accepted' where id = :'rq2';
update public.quotes set status = 'sent' where id = :'rq1';
select tl3.denies('a member cannot remove a customer (role checked in the database)',
  $$select public.remove_customer('d3000000-0000-0000-0000-0000000000f1')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-0000-0000-00000000000b';
select tl3.denies('another organization cannot remove it (customer not visible)',
  $$select public.remove_customer('d3000000-0000-0000-0000-0000000000f1')$$);
reset role;
set local role anon;
select tl3.denies('anon cannot call remove_customer', $$select public.remove_customer('d3000000-0000-0000-0000-0000000000f1')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-00000000000a';
select public.remove_customer('d3000000-0000-0000-0000-0000000000f1') as removed_quotes \gset
select tl3.check('owner removes the customer and its open quotes in one go (returns how many)', :removed_quotes = 1);
select tl3.check('the customer is no longer visible in active lists', not exists (select 1 from public.customers where id = 'd3000000-0000-0000-0000-0000000000f1' and deleted_at is null));
select tl3.check('open quote removed, accepted quote kept in history', (
  select (select deleted_at is not null from public.quotes where id = :'rq1') and (select deleted_at is null from public.quotes where id = :'rq2')));
select tl3.denies('removing it twice fails cleanly', $$select public.remove_customer('d3000000-0000-0000-0000-0000000000f1')$$);
reset role;
select tl3.check('timeline and audit record the removal', (
  select count(*) filter (where event = 'deleted' and entity = 'customer') = 1 and count(*) filter (where event = 'deleted' and entity = 'quote') = 1
  from public.activity_events where customer_id = 'd3000000-0000-0000-0000-0000000000f1')
  and exists (select 1 from public.audit_logs where entity = 'customers' and entity_id = 'd3000000-0000-0000-0000-0000000000f1' and 'deleted_at' = any (changed_fields)));

-- ---------------------------------------------------------------- relazione memberships -> profiles (migrazione 15)
select tl3.check('every member has a profile and the relationship is declared (needed by the API embed)', (
  select count(*) = 0 from public.memberships m where not exists (select 1 from public.profiles p where p.id = m.user_id))
  and exists (select 1 from pg_constraint where conname = 'memberships_user_profile_fkey'));

-- ---------------------------------------------------------------- RLS ovunque (tabelle nuove incluse)
select tl3.check('every table in public/private has RLS enabled', (
  select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity));
rollback;
\echo COMMERCIAL TESTS PASSED
