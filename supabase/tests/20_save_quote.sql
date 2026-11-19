-- save_quote: atomicità, numerazione senza buchi, isolamento. Eseguito da run-local.sh dopo le migrazioni.
\set ON_ERROR_STOP on
begin;
create schema tl2; grant usage on schema tl2 to public;
create function tl2.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
grant execute on all functions in schema tl2 to public;

insert into auth.users (id, email) values ('a1000000-0000-0000-0000-00000000000a', 'a@a.it'), ('b1000000-0000-0000-0000-00000000000b', 'b@b.it');
set local role service_role;
select public.rpc_create_activation_code('h1', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('h2', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('h1', 'a@a.it', 'Alfa', 'a1000000-0000-0000-0000-00000000000a', 'A') as oa \gset
select public.rpc_redeem_activation_code('h2', 'b@b.it', 'Beta', 'b1000000-0000-0000-0000-00000000000b', 'B') as ob \gset
insert into public.customers (id, organization_id, name) values
  ('c1000000-0000-0000-0000-00000000000a', :'oa', 'CA'), ('c1000000-0000-0000-0000-00000000000b', :'ob', 'CB');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-00000000000a';
select public.save_quote(null, :'oa', 'c1000000-0000-0000-0000-00000000000a', 'T', '2026-05-01', null, null, null,
  '[{"description":"x","quantity":2,"unit_price_cents":1000,"vat_rate":22},{"description":"y","quantity":1,"unit_price_cents":500,"vat_rate":10}]') as q1 \gset
do $$ begin
  if (select count(*) from public.quote_items) <> 2 then raise exception 'FAIL items'; end if;
  if (select total_cents from public.quotes) <> 2500 + 440 + 50 then raise exception 'FAIL total %', (select total_cents from public.quotes); end if;
  raise notice 'ok   - save_quote creates quote with items and totals';
end $$;

-- fallimento (cliente di un'altra org): nessun buco nella numerazione
select tl2.denies('save_quote rejects foreign customer',
  format($$select public.save_quote(null, %L, 'c1000000-0000-0000-0000-00000000000b', 'X', '2026-05-02', null, null, null, '[{"description":"z"}]')$$, :'oa'));
select tl2.denies('save_quote rejects empty items',
  format($$select public.save_quote(null, %L, 'c1000000-0000-0000-0000-00000000000a', 'X', '2026-05-02', null, null, null, '[]')$$, :'oa'));
select public.save_quote(null, :'oa', 'c1000000-0000-0000-0000-00000000000a', 'T2', '2026-05-03', null, null, null, '[{"description":"w","quantity":1,"unit_price_cents":100}]');
do $$ begin
  if (select string_agg(number, ',' order by seq) from public.quotes) <> '2026/0001,2026/0002' then
    raise exception 'FAIL gap in numbering: %', (select string_agg(number, ',' order by seq) from public.quotes); end if;
  raise notice 'ok   - numbering has no gaps after failed saves';
end $$;

-- modifica bozza: righe sostituite, numero invariato; non modificabile se inviato
select public.save_quote(:'q1', :'oa', 'c1000000-0000-0000-0000-00000000000a', 'T-mod', null, null, null, null,
  '[{"description":"solo","quantity":1,"unit_price_cents":1000,"vat_rate":0}]');
do $$ begin
  if (select count(*) from public.quote_items where quote_id = (select id from public.quotes where title = 'T-mod')) <> 1 then raise exception 'FAIL replace'; end if;
  raise notice 'ok   - save_quote replaces items on draft';
end $$;
update public.quotes set status = 'sent' where title = 'T-mod';
select tl2.denies('sent quote is not editable',
  format($$select public.save_quote(%L, %L, 'c1000000-0000-0000-0000-00000000000a', 'hack', null, null, null, null, '[{"description":"q"}]')$$, :'q1', :'oa'));
reset role;

-- utente B non può scrivere nell'org A
set local role authenticated;
set local request.jwt.claim.sub = 'b1000000-0000-0000-0000-00000000000b';
select tl2.denies('other tenant cannot save into org A',
  format($$select public.save_quote(null, %L, 'c1000000-0000-0000-0000-00000000000a', 'X', null, null, null, null, '[{"description":"q"}]')$$, :'oa'));
reset role;
set local role anon;
select tl2.denies('anon cannot call save_quote', $$select public.save_quote(null, gen_random_uuid(), gen_random_uuid(), 'x', null, null, null, null, '[{"description":"q"}]')$$);
reset role;
rollback;
\echo SAVE_QUOTE TESTS PASSED
