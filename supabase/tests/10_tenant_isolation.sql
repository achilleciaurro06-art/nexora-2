-- Test di isolamento multi-tenant e RLS. Esecuzione: psql -v ON_ERROR_STOP=1 -f 10_tenant_isolation.sql
-- Ogni controllo che fallisce solleva un'eccezione.
\set ON_ERROR_STOP on
begin;
create schema tl;
grant usage on schema tl to public;

create function tl.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
-- permette ai ruoli di usare l'helper temporaneo

create function tl.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok   - % (%)', p_name, sqlerrm; return;
  end;
  raise exception 'FAIL (statement was allowed): %', p_name;
end $$;

create function tl.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema tl to public;

-- ------------------------------------------------ fixture (superuser)
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'owner-a@a.it'),
  ('a0000000-0000-0000-0000-0000000000a2', 'viewer-a@a.it'),
  ('b0000000-0000-0000-0000-00000000000b', 'owner-b@b.it');

set local role service_role;
select tl.check('activation code created',
  public.rpc_create_activation_code('hash-a', now() + interval '1 day', 1, 'owner-a@a.it', null, null) is not null);
select public.rpc_create_activation_code('hash-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('hash-exp', now() - interval '1 day', 1, null, null, null);

select tl.check('check code ok', public.rpc_check_activation_code('hash-a', 'OWNER-A@a.it'));
select tl.check('check code wrong email', not public.rpc_check_activation_code('hash-a', 'x@x.it'));
select tl.denies('expired code rejected',
  $$select public.rpc_redeem_activation_code('hash-exp', 'q@q.it', 'Qux', 'b0000000-0000-0000-0000-00000000000b', 'Q')$$);
select tl.denies('wrong email rejected',
  $$select public.rpc_redeem_activation_code('hash-a', 'x@x.it', 'Azienda A', 'a0000000-0000-0000-0000-00000000000a', 'A')$$);

select public.rpc_redeem_activation_code('hash-a', 'owner-a@a.it', 'Azienda A', 'a0000000-0000-0000-0000-00000000000a', 'Owner A') as org_a \gset
select public.rpc_redeem_activation_code('hash-b', 'owner-b@b.it', 'Azienda B', 'b0000000-0000-0000-0000-00000000000b', 'Owner B') as org_b \gset
select tl.denies('single-use code cannot be reused',
  $$select public.rpc_redeem_activation_code('hash-a', 'owner-a@a.it', 'Altra', 'a0000000-0000-0000-0000-00000000000a', 'A')$$);

insert into public.memberships (organization_id, user_id, role)
  values (:'org_a', 'a0000000-0000-0000-0000-0000000000a2', 'viewer');
insert into public.customers (id, organization_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', :'org_a', 'Cliente A'),
  ('c0000000-0000-0000-0000-00000000000b', :'org_b', 'Cliente B');
reset role;

-- ------------------------------------------------ utente A (owner azienda A)
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';

select tl.check('A sees only own customers',
  (select count(*) from public.customers) = 1 and (select name from public.customers) = 'Cliente A');
select tl.check('A sees only own organization', (select count(*) from public.organizations) = 1);
select tl.check('A cannot see org B members',
  (select count(*) from public.memberships where organization_id = :'org_b') = 0);
select tl.denies('A cannot insert customer in org B',
  format($$insert into public.customers (organization_id, name) values (%L, 'intruso')$$, :'org_b'));
select tl.check('A update of B customer touches 0 rows',
  tl.affected($$update public.customers set name = 'hacked' where id = 'c0000000-0000-0000-0000-00000000000b'$$) = 0);
select tl.check('A delete of B customer touches 0 rows',
  tl.affected($$delete from public.customers where id = 'c0000000-0000-0000-0000-00000000000b'$$) = 0);
select tl.denies('A cannot move customer to org B',
  format($$update public.customers set organization_id = %L where id = 'c0000000-0000-0000-0000-00000000000a'$$, :'org_b'));

-- preventivi: numerazione e totali
insert into public.quotes (id, organization_id, customer_id, issue_date)
  values ('d0000000-0000-0000-0000-000000000001', :'org_a', 'c0000000-0000-0000-0000-00000000000a', '2026-03-01');
insert into public.quotes (id, organization_id, customer_id, issue_date)
  values ('d0000000-0000-0000-0000-000000000002', :'org_a', 'c0000000-0000-0000-0000-00000000000a', '2026-04-01');
select tl.check('quote numbers are sequential',
  (select string_agg(number, ',' order by seq) from public.quotes) = '2026/0001,2026/0002');
select tl.denies('client cannot set quote number',
  format($$insert into public.quotes (organization_id, customer_id, number) values (%L, 'c0000000-0000-0000-0000-00000000000a', 'X')$$, :'org_a'));
select tl.denies('client cannot set quote totals',
  $$update public.quotes set total_cents = 1 where id = 'd0000000-0000-0000-0000-000000000001'$$);
select tl.denies('quote cannot reference customer of another org',
  format($$insert into public.quotes (organization_id, customer_id) values (%L, 'c0000000-0000-0000-0000-00000000000b')$$, :'org_a'));

insert into public.quote_items (organization_id, quote_id, description, quantity, unit_price_cents, discount_percent, vat_rate)
  values (:'org_a', 'd0000000-0000-0000-0000-000000000001', 'Servizio', 2, 10000, 10, 22),
         (:'org_a', 'd0000000-0000-0000-0000-000000000001', 'Altro', 1, 5000, 0, 10);
select tl.check('quote totals recalculated (net 23000, vat 3960+500)', (
  select subtotal_cents = 23000 and vat_cents = 4460 and total_cents = 27460
  from public.quotes where id = 'd0000000-0000-0000-0000-000000000001'));
delete from public.quote_items where description = 'Altro';
select tl.check('quote totals recalculated after delete',
  (select total_cents from public.quotes where id = 'd0000000-0000-0000-0000-000000000001') = 21960);

-- ruoli e privilegi
select tl.denies('A cannot suspend/modify org status',
  format($$update public.organizations set status = 'suspended' where id = %L$$, :'org_a'));
select tl.denies('A cannot insert membership directly',
  format($$insert into public.memberships (organization_id, user_id, role) values (%L, 'b0000000-0000-0000-0000-00000000000b', 'admin')$$, :'org_a'));
select tl.denies('last owner cannot be demoted',
  format($$update public.memberships set role = 'admin' where organization_id = %L and user_id = 'a0000000-0000-0000-0000-00000000000a'$$, :'org_a'));
select tl.check('owner can read audit logs', (select count(*) from public.audit_logs) > 0);
select tl.check('audit logs only of own org',
  (select count(*) from public.audit_logs where organization_id <> :'org_a') = 0);
select tl.denies('audit logs are append-only (update)', $$update public.audit_logs set action = 'x'$$);
select tl.denies('audit logs are append-only (delete)', $$delete from public.audit_logs$$);
select tl.denies('authenticated cannot call privileged rpc',
  $$select public.rpc_check_activation_code('hash-b', 'a@a.it')$$);
select tl.denies('authenticated cannot read private tables', $$select * from private.activation_codes$$);
select tl.denies('authenticated cannot touch quotas',
  format($$update public.ai_quotas set monthly_token_limit = 999999999 where organization_id = %L$$, :'org_a'));

-- AI suggerimenti: decisione una sola volta
insert into public.ai_suggestions (id, organization_id, kind, payload, source_type, created_by)
  values ('e0000000-0000-0000-0000-000000000001', :'org_a', 'task', '{"title":"x"}', 'conversation', 'a0000000-0000-0000-0000-00000000000a');
update public.ai_suggestions set status = 'accepted' where id = 'e0000000-0000-0000-0000-000000000001';
select tl.check('suggestion decision recorded',
  (select decided_by from public.ai_suggestions) = 'a0000000-0000-0000-0000-00000000000a');
select tl.denies('suggestion cannot be re-decided',
  $$update public.ai_suggestions set status = 'rejected' where id = 'e0000000-0000-0000-0000-000000000001'$$);

-- storage
select tl.denies('A cannot upload into org B folder',
  format($$insert into storage.objects (bucket_id, name) values ('documents', %L)$$, :'org_b' || '/x/file.pdf'));
insert into storage.objects (bucket_id, name) values ('documents', :'org_a' || '/x/file.pdf');
select tl.denies('malformed path rejected',
  $$insert into storage.objects (bucket_id, name) values ('documents', 'nonuuid/x/file.pdf')$$);
reset role;

-- ------------------------------------------------ viewer di A
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
select tl.check('viewer can read customers', (select count(*) from public.customers) = 1);
select tl.denies('viewer cannot insert customers',
  format($$insert into public.customers (organization_id, name) values (%L, 'v')$$, :'org_a'));
select tl.check('viewer update touches 0 rows',
  tl.affected($$update public.customers set name = 'v'$$) = 0);
select tl.check('viewer cannot read audit logs', (select count(*) from public.audit_logs) = 0);
reset role;

-- ------------------------------------------------ utente B
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select tl.check('B sees only B customers',
  (select count(*) from public.customers) = 1 and (select name from public.customers) = 'Cliente B');
select tl.check('B sees no quotes of A', (select count(*) from public.quotes) = 0);
select tl.check('B sees no storage objects of A', (select count(*) from storage.objects) = 0);
reset role;

-- ------------------------------------------------ anon
set local role anon;
select tl.denies('anon cannot read customers', $$select * from public.customers$$);
select tl.denies('anon cannot read organizations', $$select * from public.organizations$$);
reset role;

-- ------------------------------------------------ ogni tabella ha RLS attiva
select tl.check('every table in public/private has RLS enabled', (
  select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity));

rollback;
\echo ALL TENANT ISOLATION TESTS PASSED
