-- Migrazione 17: numerazione configurabile, revisioni, fatturato registrato, duplicazione.
\set ON_ERROR_STOP on
begin;
create schema q4; grant usage on schema q4 to public;
create function q4.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
create function q4.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
create function q4.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
-- il test gira in UNA transazione: simula "transazione successiva" azzerando il txid delle revisioni già scritte
create function q4.tick() returns void language sql security definer as $$ update public.quote_revisions set txid = 0 $$;
grant execute on all functions in schema q4 to public;

insert into auth.users (id, email) values
  ('a4000000-0000-0000-0000-00000000000a', 'owner-a@a.it'),
  ('a4000000-0000-0000-0000-0000000000a2', 'member-a@a.it'),
  ('a4000000-0000-0000-0000-0000000000a3', 'viewer-a@a.it'),
  ('b4000000-0000-0000-0000-00000000000b', 'owner-b@b.it');
set local role service_role;
select public.rpc_create_activation_code('c-a', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('c-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('c-a', 'owner-a@a.it', 'Alfa', 'a4000000-0000-0000-0000-00000000000a', 'Owner A') as oa \gset
select public.rpc_redeem_activation_code('c-b', 'owner-b@b.it', 'Beta', 'b4000000-0000-0000-0000-00000000000b', 'Owner B') as ob \gset
insert into public.memberships (organization_id, user_id, role) values
  (:'oa', 'a4000000-0000-0000-0000-0000000000a2', 'member'),
  (:'oa', 'a4000000-0000-0000-0000-0000000000a3', 'viewer');
reset role;
insert into public.customers (id, organization_id, name) values
  ('a4c00000-0000-0000-0000-000000000001', :'oa', 'Cliente A'),
  ('b4c00000-0000-0000-0000-000000000001', :'ob', 'Cliente B');

-- ---------------------------------------------------------------- numerazione
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-00000000000a';
select public.save_quote(null, :'oa', 'a4c00000-0000-0000-0000-000000000001', 'Q1', '2026-03-10', null, null, null,
  '[{"description":"Voce","quantity":2,"unit_price_cents":10000,"discount_percent":0,"vat_rate":22}]') as q1 \gset
select q4.check('default numbering stays YYYY/NNNN', (select number from public.quotes where id = :'q1') = '2026/0001');
update public.organizations set quote_numbering = '{"prefix":"PRV-","digits":5,"yearly":false}' where id = :'oa';
select public.save_quote(null, :'oa', 'a4c00000-0000-0000-0000-000000000001', 'Q2', '2026-03-11', null, null, null,
  '[{"description":"Voce","quantity":1,"unit_price_cents":5000,"discount_percent":0,"vat_rate":22}]') as q2 \gset
select q4.check('custom prefix, 5 digits, no year', (select number from public.quotes where id = :'q2') = 'PRV-00001');
select q4.denies('invalid numbering config is rejected',
  $$update public.organizations set quote_numbering = '{"prefix":"a b","digits":4,"yearly":true}' where id = (select id from public.organizations where name = 'Alfa')$$);
select q4.denies('digits out of range rejected',
  $$update public.organizations set quote_numbering = '{"prefix":"","digits":12,"yearly":true}' where id = (select id from public.organizations where name = 'Alfa')$$);
select public.set_quote_next_number(:'oa', 100) as nxt \gset
select q4.check('next number set to 100', :nxt = 100);
select public.save_quote(null, :'oa', 'a4c00000-0000-0000-0000-000000000001', 'Q3', '2026-03-12', null, null, null,
  '[{"description":"Voce","quantity":1,"unit_price_cents":5000,"discount_percent":0,"vat_rate":22}]') as q3 \gset
select q4.check('numbering continues from the chosen value', (select number from public.quotes where id = :'q3') = 'PRV-00100');
select public.set_quote_next_number(:'oa', 5) as nxt2 \gset
select q4.check('cannot go backwards (no reuse of issued numbers)', :nxt2 = 101);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-0000000000a2';
select q4.denies('a member cannot set the next number', format($$select public.set_quote_next_number(%L, 500)$$, :'oa'));
select q4.check('a member cannot change numbering', q4.affected(format($$update public.organizations set quote_numbering = '{"prefix":"X","digits":4,"yearly":true}' where id = %L$$, :'oa')) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b4000000-0000-0000-0000-00000000000b';
select q4.denies('another organization cannot set the number', format($$select public.set_quote_next_number(%L, 500)$$, :'oa'));
reset role;

-- ---------------------------------------------------------------- revisioni
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-00000000000a';
select q4.check('creation produced exactly one revision', (select count(*) from public.quote_revisions where quote_id = :'q1') = 1);
select q4.check('revision snapshot carries the items', (select jsonb_array_length(snapshot -> 'items') from public.quote_revisions where quote_id = :'q1') = 1);
select q4.tick();
select public.save_quote(:'q1', :'oa', 'a4c00000-0000-0000-0000-000000000001', 'Q1', '2026-03-10', null, null, null,
  '[{"description":"Voce","quantity":2,"unit_price_cents":10000,"discount_percent":0,"vat_rate":22}]') as _ \gset
select q4.check('a save with no changes creates no revision', (select count(*) from public.quote_revisions where quote_id = :'q1') = 1);
select q4.tick();
select public.save_quote(:'q1', :'oa', 'a4c00000-0000-0000-0000-000000000001', 'Q1 nuovo', '2026-03-10', null, 'una nota', null,
  '[{"description":"Voce","quantity":3,"unit_price_cents":10000,"discount_percent":0,"vat_rate":22}]') as _ \gset
select q4.check('an edit creates one revision (many row writes collapse)', (select count(*) from public.quote_revisions where quote_id = :'q1') = 2);
select q4.check('summary lists what changed', (select summary from public.quote_revisions where quote_id = :'q1' and version = 2) ~ '^Modificato:' and (select summary from public.quote_revisions where quote_id = :'q1' and version = 2) ~ 'oggetto' and (select summary from public.quote_revisions where quote_id = :'q1' and version = 2) ~ 'note' and (select summary from public.quote_revisions where quote_id = :'q1' and version = 2) ~ 'righe');
select q4.tick();
update public.quotes set status = 'sent' where id = :'q1';
select q4.check('a status change is not a revision', (select count(*) from public.quote_revisions where quote_id = :'q1') = 2);
select q4.denies('revisions cannot be forged', format($$insert into public.quote_revisions (organization_id, quote_id, version, summary, snapshot) values (%L, %L, 99, 'x', '{}')$$, :'oa', :'q1'));
select q4.denies('revisions cannot be deleted', format($$delete from public.quote_revisions where quote_id = %L$$, :'q1'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b4000000-0000-0000-0000-00000000000b';
select q4.check('another organization sees no revisions', (select count(*) from public.quote_revisions) = 0);
reset role;

-- ---------------------------------------------------------------- fatturato registrato
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-00000000000a';
select q4.denies('billing only on accepted quotes', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, created_by) values (%L, %L, %L, 1000, %L)$$,
  :'oa', :'q1', 'a4c00000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-00000000000a'));
update public.quotes set status = 'accepted' where id = :'q1';
insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, billed_at, reference, created_by)
  values (:'oa', :'q1', 'a4c00000-0000-0000-0000-000000000001', 20000, '2026-04-01', 'FT-1', 'a4000000-0000-0000-0000-00000000000a');
select q4.check('billing recorded', (select sum(amount_cents) from public.quote_billings where quote_id = :'q1') = 20000);
select q4.denies('zero amount rejected', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, created_by) values (%L, %L, %L, 0, %L)$$,
  :'oa', :'q1', 'a4c00000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-00000000000a'));
select q4.check('timeline records the billing', (select count(*) from public.activity_events where event = 'billed' and entity_id = :'q1') = 1);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-0000000000a3';
select q4.denies('viewer cannot record billing', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, created_by) values (%L, %L, %L, 100, %L)$$,
  :'oa', :'q1', 'a4c00000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000a3'));
select q4.check('viewer can read billing', (select count(*) from public.quote_billings) = 1);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-0000000000a2';
select q4.check('member cannot delete billing', q4.affected(format($$delete from public.quote_billings where quote_id = %L$$, :'q1')) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b4000000-0000-0000-0000-00000000000b';
select q4.check('another organization sees no billing', (select count(*) from public.quote_billings) = 0);
select q4.denies('another organization cannot bill our quote', format($$insert into public.quote_billings (organization_id, quote_id, customer_id, amount_cents, created_by) values (%L, %L, %L, 100, %L)$$,
  :'ob', :'q1', 'b4c00000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-00000000000b'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-00000000000a';
select q4.check('owner can delete billing', q4.affected(format($$delete from public.quote_billings where quote_id = %L$$, :'q1')) = 1);
select q4.check('audit has the billing', (select count(*) from public.audit_logs where entity = 'quote_billings') >= 2);
reset role;

-- ---------------------------------------------------------------- duplicazione
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-0000000000a2';
select public.duplicate_quote(:'q1') as d1 \gset
select q4.check('duplicate is a draft with a new number', (select status = 'draft' and number <> (select number from public.quotes where id = :'q1') from public.quotes where id = :'d1'));
select q4.check('duplicate copies the lines and totals', (select total_cents from public.quotes where id = :'d1') = (select total_cents from public.quotes where id = :'q1'));
select q4.check('duplicate is dated today', (select issue_date = current_date from public.quotes where id = :'d1'));
select q4.check('original untouched', (select status from public.quotes where id = :'q1') = 'accepted');
select q4.denies('unknown quote cannot be duplicated', $$select public.duplicate_quote(gen_random_uuid())$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-0000000000a3';
select q4.denies('viewer cannot duplicate', format($$select public.duplicate_quote(%L)$$, :'q1'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b4000000-0000-0000-0000-00000000000b';
select q4.denies('another organization cannot duplicate', format($$select public.duplicate_quote(%L)$$, :'q1'));
reset role;
rollback;
\echo QUOTES COMPLETE TESTS PASSED
