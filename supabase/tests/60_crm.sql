-- Migrazione 19: archivio clienti, eliminazione definitiva, fatture registrate, sintesi commerciale.
\set ON_ERROR_STOP on
begin;
create schema c6; grant usage on schema c6 to public;
create function c6.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
create function c6.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
create function c6.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema c6 to public;

insert into auth.users (id, email) values
  ('a6000000-0000-0000-0000-00000000000a', 'owner-a@a.it'),
  ('a6000000-0000-0000-0000-0000000000a2', 'member-a@a.it'),
  ('a6000000-0000-0000-0000-0000000000a3', 'viewer-a@a.it'),
  ('b6000000-0000-0000-0000-00000000000b', 'owner-b@b.it');
set local role service_role;
select public.rpc_create_activation_code('c-a', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('c-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('c-a', 'owner-a@a.it', 'Alfa', 'a6000000-0000-0000-0000-00000000000a', 'Owner A') as oa \gset
select public.rpc_redeem_activation_code('c-b', 'owner-b@b.it', 'Beta', 'b6000000-0000-0000-0000-00000000000b', 'Owner B') as ob \gset
insert into public.memberships (organization_id, user_id, role) values
  (:'oa', 'a6000000-0000-0000-0000-0000000000a2', 'member'),
  (:'oa', 'a6000000-0000-0000-0000-0000000000a3', 'viewer');
reset role;
insert into public.customers (id, organization_id, name) values
  ('a6c00000-0000-0000-0000-000000000001', :'oa', 'Cliente Uno'),
  ('a6c00000-0000-0000-0000-000000000002', :'oa', 'Cliente Vuoto'),
  ('b6c00000-0000-0000-0000-000000000001', :'ob', 'Cliente B');

-- ---------------------------------------------------------------- archivio e ripristino
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-0000000000a2';
update public.customers set archived_at = now() - interval '5 years', archived_by = 'a6000000-0000-0000-0000-00000000000a' where id = 'a6c00000-0000-0000-0000-000000000001';
select c6.check('archive date/author are set by the database, not the client',
  (select archived_by = 'a6000000-0000-0000-0000-0000000000a2' and archived_at > now() - interval '1 minute' from public.customers where id = 'a6c00000-0000-0000-0000-000000000001'));
select c6.check('timeline records the archiving once, without a generic "updated"',
  (select count(*) from public.activity_events where customer_id = 'a6c00000-0000-0000-0000-000000000001' and event = 'archived') = 1
  and (select count(*) from public.activity_events where customer_id = 'a6c00000-0000-0000-0000-000000000001' and event = 'updated') = 0);
update public.customers set archived_by = 'a6000000-0000-0000-0000-00000000000a', name = 'Cliente Uno' where id = 'a6c00000-0000-0000-0000-000000000001';
select c6.check('author cannot be changed afterwards', (select archived_by = 'a6000000-0000-0000-0000-0000000000a2' from public.customers where id = 'a6c00000-0000-0000-0000-000000000001'));
select c6.denies('no new quote for an archived customer', $$select public.save_quote(null, (select id from public.organizations where name = 'Alfa'), 'a6c00000-0000-0000-0000-000000000001', 'X', current_date, null, null, null, '[{"description":"v","quantity":1,"unit_price_cents":100,"discount_percent":0,"vat_rate":22}]')$$);
select c6.check('recontact list ignores archived customers', (select count(*) from public.customers_to_recontact(:'oa', -1, 50) where customer_id = 'a6c00000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.customers_to_recontact(:'oa', -1, 50) where customer_id = 'a6c00000-0000-0000-0000-000000000002') = 1);
update public.customers set archived_at = null where id = 'a6c00000-0000-0000-0000-000000000001';
select c6.check('restore clears date and author', (select archived_at is null and archived_by is null from public.customers where id = 'a6c00000-0000-0000-0000-000000000001'));
select c6.check('timeline records the restoration', (select count(*) from public.activity_events where customer_id = 'a6c00000-0000-0000-0000-000000000001' and event = 'restored') = 1);
select public.save_quote(null, :'oa', 'a6c00000-0000-0000-0000-000000000001', 'Q-aperto', current_date, null, null, null,
  '[{"description":"v","quantity":1,"unit_price_cents":10000,"discount_percent":0,"vat_rate":22}]') as q1 \gset
select c6.check('after restore the customer is usable again', :'q1' is not null);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-0000000000a3';
select c6.check('a viewer cannot archive', c6.affected($$update public.customers set archived_at = now() where id = 'a6c00000-0000-0000-0000-000000000002'$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-00000000000b';
select c6.check('another organization cannot archive ours', c6.affected($$update public.customers set archived_at = now() where id = 'a6c00000-0000-0000-0000-000000000002'$$) = 0);
reset role;

-- ---------------------------------------------------------------- sintesi commerciale
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-00000000000a';
select public.save_quote(null, :'oa', 'a6c00000-0000-0000-0000-000000000001', 'Q-acc', current_date, null, null, null, '[{"description":"v","quantity":1,"unit_price_cents":100000,"discount_percent":0,"vat_rate":0}]') as q2 \gset
select public.save_quote(null, :'oa', 'a6c00000-0000-0000-0000-000000000001', 'Q-acc2', current_date, null, null, null, '[{"description":"v","quantity":1,"unit_price_cents":50000,"discount_percent":0,"vat_rate":0}]') as q3 \gset
select public.save_quote(null, :'oa', 'a6c00000-0000-0000-0000-000000000001', 'Q-rif', current_date, null, null, null, '[{"description":"v","quantity":1,"unit_price_cents":30000,"discount_percent":0,"vat_rate":0}]') as q4 \gset
select public.save_quote(null, :'oa', 'a6c00000-0000-0000-0000-000000000001', 'Q-inv', current_date, null, null, null, '[{"description":"v","quantity":1,"unit_price_cents":20000,"discount_percent":0,"vat_rate":0}]') as q5 \gset
update public.quotes set status = 'accepted' where id in (:'q2', :'q3');
update public.quotes set status = 'rejected' where id = :'q4';
update public.quotes set status = 'sent' where id = :'q5';
select public.customer_commercial_summary('a6c00000-0000-0000-0000-000000000001') as s \gset
select c6.check('issued = non-draft quotes (count and value)', (:'s'::jsonb ->> 'issued_count')::int = 4 and (:'s'::jsonb ->> 'issued_cents')::bigint = 200000);
select c6.check('accepted count/value', (:'s'::jsonb ->> 'accepted_count')::int = 2 and (:'s'::jsonb ->> 'accepted_cents')::bigint = 150000);
select c6.check('rejected count/value', (:'s'::jsonb ->> 'rejected_count')::int = 1 and (:'s'::jsonb ->> 'rejected_cents')::bigint = 30000);
select c6.check('open (sent) count/value', (:'s'::jsonb ->> 'open_count')::int = 1 and (:'s'::jsonb ->> 'open_cents')::bigint = 20000);
select c6.check('drafts are counted apart (the earlier open quote)', (:'s'::jsonb ->> 'draft_count')::int = 1 and (:'s'::jsonb ->> 'draft_cents')::bigint = 12200);
select c6.check('average = issued / issued count', (:'s'::jsonb ->> 'avg_issued_cents')::bigint = 50000);
select c6.check('conversion = accepted / (accepted + rejected)', (:'s'::jsonb ->> 'conversion_pct')::int = 67);
select c6.check('accepted is NOT invoiced: nothing invoiced yet', (:'s'::jsonb ->> 'invoiced_cents')::bigint = 0 and (:'s'::jsonb ->> 'collected_cents')::bigint = 0);
select c6.check('last activity exists', (:'s'::jsonb ->> 'last_activity_at') is not null);

-- ---------------------------------------------------------------- fatture registrate
insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, taxable_cents, vat_cents, billed_at, reference, created_by)
  values (:'oa', :'q2', 'a6c00000-0000-0000-0000-000000000001', 100000, 100000, 0, '2026-03-01', 'FT-1', 'a6000000-0000-0000-0000-00000000000a');
insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, taxable_cents, vat_cents, billed_at, reference, created_by)
  values (:'oa', null, 'a6c00000-0000-0000-0000-000000000001', 12200, 10000, 2200, '2026-03-05', 'FT-2', 'a6000000-0000-0000-0000-00000000000a');
select c6.check('an invoice may exist without a quote', (select count(*) from public.quote_billings where quote_id is null) = 1);
select c6.denies('taxable + VAT must equal the total', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, taxable_cents, vat_cents, created_by) values (%L, null, 'a6c00000-0000-0000-0000-000000000001', 100, 50, 10, 'a6000000-0000-0000-0000-00000000000a')$$, :'oa'));
select c6.denies('taxable without VAT rejected', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, taxable_cents, created_by) values (%L, null, 'a6c00000-0000-0000-0000-000000000001', 100, 100, 'a6000000-0000-0000-0000-00000000000a')$$, :'oa'));
select c6.denies('a quote that is not accepted cannot be invoiced', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, created_by) values (%L, %L, 'a6c00000-0000-0000-0000-000000000001', 100, 'a6000000-0000-0000-0000-00000000000a')$$, :'oa', :'q5'));
select c6.denies('a customer of another organization cannot be invoiced (composite FK)', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, created_by) values (%L, null, 'b6c00000-0000-0000-0000-000000000001', 100, 'a6000000-0000-0000-0000-00000000000a')$$, :'oa'));
select c6.denies('paid needs a date', $$update public.quote_billings set payment_status = 'paid' where reference = 'FT-1'$$);
select c6.denies('payment cannot precede the invoice', $$update public.quote_billings set payment_status = 'paid', paid_at = '2026-02-01' where reference = 'FT-1'$$);
update public.quote_billings set payment_status = 'paid', paid_at = '2026-03-20' where reference = 'FT-1';
select c6.check('payment recorded in the timeline', (select count(*) from public.activity_events where event = 'payment_received') = 1);
select c6.check('invoice without a quote is on the customer timeline', (select count(*) from public.activity_events where event = 'billed' and entity = 'customer' and customer_id = 'a6c00000-0000-0000-0000-000000000001') = 1);
select c6.denies('customer and quote columns cannot be updated', $$update public.quote_billings set customer_id = 'a6c00000-0000-0000-0000-000000000002', quote_id = null where reference = 'FT-1'$$);
select c6.check('customer and quote cannot be changed afterwards', (select customer_id = 'a6c00000-0000-0000-0000-000000000001' and quote_id = :'q2' from public.quote_billings where reference = 'FT-1'));
select public.customer_commercial_summary('a6c00000-0000-0000-0000-000000000001') as s2 \gset
select c6.check('invoiced total includes quote-linked and standalone invoices', (:'s2'::jsonb ->> 'invoiced_cents')::bigint = 112200 and (:'s2'::jsonb ->> 'invoiced_count')::int = 2);
select c6.check('collected counts only paid invoices', (:'s2'::jsonb ->> 'collected_cents')::bigint = 100000);
select c6.check('accepted-and-invoiced counts only invoices on accepted quotes', (:'s2'::jsonb ->> 'accepted_invoiced_cents')::bigint = 100000 and (:'s2'::jsonb ->> 'accepted_cents')::bigint = 150000);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-0000000000a3';
select c6.check('a viewer can read the summary', public.customer_commercial_summary('a6c00000-0000-0000-0000-000000000001') is not null);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-00000000000b';
select c6.check('another organization gets nothing', public.customer_commercial_summary('a6c00000-0000-0000-0000-000000000001') is null
  and public.customer_delete_blockers('a6c00000-0000-0000-0000-000000000001') is null);
reset role;

-- ---------------------------------------------------------------- eliminazione definitiva
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-00000000000a';
select c6.check('blockers are listed', (public.customer_delete_blockers('a6c00000-0000-0000-0000-000000000001') ->> 'quotes')::int = 5
  and (public.customer_delete_blockers('a6c00000-0000-0000-0000-000000000001') ->> 'invoices')::int = 2);
select c6.denies('active customers cannot be deleted (archive first)', $$select public.delete_customer_permanently('a6c00000-0000-0000-0000-000000000002')$$);
update public.customers set archived_at = now() where id in ('a6c00000-0000-0000-0000-000000000001', 'a6c00000-0000-0000-0000-000000000002');
select c6.denies('a customer with quotes and invoices cannot be deleted', $$select public.delete_customer_permanently('a6c00000-0000-0000-0000-000000000001')$$);
select c6.check('…and it is still there with all its data', (select count(*) from public.quotes where customer_id = 'a6c00000-0000-0000-0000-000000000001') = 5);
reset role;
-- vincoli anche per attività e documenti
insert into public.tasks (organization_id, title, customer_id, created_by) values (:'oa', 'T', 'a6c00000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-00000000000a');
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-00000000000a';
select c6.denies('a customer with tasks cannot be deleted', $$select public.delete_customer_permanently('a6c00000-0000-0000-0000-000000000002')$$);
reset role;
delete from public.tasks where title = 'T';
insert into public.customer_contacts (organization_id, customer_id, full_name) values (:'oa', 'a6c00000-0000-0000-0000-000000000002', 'Ref');
insert into public.customer_notes (organization_id, customer_id, body, created_by) values (:'oa', 'a6c00000-0000-0000-0000-000000000002', 'nota', 'a6000000-0000-0000-0000-00000000000a');
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-0000000000a2';
select c6.denies('a member cannot delete permanently', $$select public.delete_customer_permanently('a6c00000-0000-0000-0000-000000000002')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-00000000000b';
select c6.denies('another organization cannot delete ours', $$select public.delete_customer_permanently('a6c00000-0000-0000-0000-000000000002')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-00000000000a';
select public.delete_customer_permanently('a6c00000-0000-0000-0000-000000000002');
select c6.check('the empty archived customer is gone with contacts, notes and timeline',
  not exists (select 1 from public.customers where id = 'a6c00000-0000-0000-0000-000000000002')
  and not exists (select 1 from public.customer_contacts where customer_id = 'a6c00000-0000-0000-0000-000000000002')
  and not exists (select 1 from public.customer_notes where customer_id = 'a6c00000-0000-0000-0000-000000000002')
  and not exists (select 1 from public.activity_events where customer_id = 'a6c00000-0000-0000-0000-000000000002'));
select c6.check('audit keeps the deletion', (select count(*) from public.audit_logs where entity = 'customers' and action = 'delete' and entity_id = 'a6c00000-0000-0000-0000-000000000002') = 1);
select c6.denies('deleting twice fails cleanly', $$select public.delete_customer_permanently('a6c00000-0000-0000-0000-000000000002')$$);
reset role;
select c6.check('every table still has RLS', (
  select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity));
rollback;
\echo CRM TESTS PASSED
