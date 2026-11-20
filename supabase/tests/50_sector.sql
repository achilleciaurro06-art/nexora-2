-- Migrazione 18: settore, campi personalizzati, catalogo, listini, modelli.
\set ON_ERROR_STOP on
begin;
create schema s5; grant usage on schema s5 to public;
create function s5.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
create function s5.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
create function s5.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema s5 to public;

insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-00000000000a', 'owner-a@a.it'),
  ('a5000000-0000-0000-0000-0000000000a2', 'member-a@a.it'),
  ('a5000000-0000-0000-0000-0000000000a3', 'viewer-a@a.it'),
  ('b5000000-0000-0000-0000-00000000000b', 'owner-b@b.it');
set local role service_role;
select public.rpc_create_activation_code('c-a', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('c-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('c-a', 'owner-a@a.it', 'Alfa', 'a5000000-0000-0000-0000-00000000000a', 'Owner A') as oa \gset
select public.rpc_redeem_activation_code('c-b', 'owner-b@b.it', 'Beta', 'b5000000-0000-0000-0000-00000000000b', 'Owner B') as ob \gset
insert into public.memberships (organization_id, user_id, role) values
  (:'oa', 'a5000000-0000-0000-0000-0000000000a2', 'member'),
  (:'oa', 'a5000000-0000-0000-0000-0000000000a3', 'viewer');
reset role;
insert into public.customers (id, organization_id, name) values
  ('a5c00000-0000-0000-0000-000000000001', :'oa', 'Cliente A'),
  ('b5c00000-0000-0000-0000-000000000001', :'ob', 'Cliente B');

-- ---------------------------------------------------------------- settore e terminologia
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-00000000000a';
select s5.check('default sector is generic', (select sector from public.organizations where id = :'oa') = 'generic');
update public.organizations set sector = 'serramenti', terminology = '{"customer_plural":"Committenti"}' where id = :'oa';
select s5.check('owner sets sector and terminology', (select sector from public.organizations where id = :'oa') = 'serramenti');
select s5.denies('unknown sector rejected', format($$update public.organizations set sector = 'altro' where id = %L$$, :'oa'));
select s5.denies('terminology must be an object', format($$update public.organizations set terminology = '[1]' where id = %L$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-0000000000a2';
select s5.check('a member cannot change the sector', s5.affected(format($$update public.organizations set sector = 'edilizia' where id = %L$$, :'oa')) = 0);
reset role;

-- ---------------------------------------------------------------- campi personalizzati
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-00000000000a';
insert into public.custom_field_definitions (organization_id, entity, key, label, field_type, options)
  values (:'oa', 'customer', 'tipo_infisso', 'Tipo di infisso', 'select', '{PVC,Alluminio,Legno}');
insert into public.custom_field_definitions (organization_id, entity, key, label, field_type) values (:'oa', 'quote', 'cantiere', 'Cantiere', 'text');
select s5.denies('invalid key rejected', format($$insert into public.custom_field_definitions (organization_id, entity, key, label, field_type) values (%L, 'customer', 'Bad Key', 'x', 'text')$$, :'oa'));
select s5.denies('duplicate key rejected', format($$insert into public.custom_field_definitions (organization_id, entity, key, label, field_type) values (%L, 'customer', 'tipo_infisso', 'x', 'text')$$, :'oa'));
select s5.denies('select field needs options', format($$insert into public.custom_field_definitions (organization_id, entity, key, label, field_type) values (%L, 'customer', 'senza_opz', 'x', 'select')$$, :'oa'));
update public.custom_field_definitions set key = 'altro', field_type = 'text', label = 'Tipo infisso 2' where key = 'tipo_infisso';
select s5.check('key and type are immutable, label editable', (select key = 'tipo_infisso' and field_type = 'select' and label = 'Tipo infisso 2' from public.custom_field_definitions where entity = 'customer'));
update public.customers set custom_values = '{"tipo_infisso":"PVC"}' where id = 'a5c00000-0000-0000-0000-000000000001';
select s5.check('customer stores custom values', (select custom_values ->> 'tipo_infisso' from public.customers where id = 'a5c00000-0000-0000-0000-000000000001') = 'PVC');
select s5.denies('custom values must be an object', $$update public.customers set custom_values = '[1]' where id = 'a5c00000-0000-0000-0000-000000000001'$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-0000000000a2';
select s5.denies('a member cannot define fields', format($$insert into public.custom_field_definitions (organization_id, entity, key, label, field_type) values (%L, 'customer', 'm', 'x', 'text')$$, :'oa'));
select s5.check('a member can read definitions', (select count(*) from public.custom_field_definitions) = 2);
select s5.check('a member can fill values on a customer', s5.affected($$update public.customers set custom_values = '{"tipo_infisso":"Legno"}' where id = 'a5c00000-0000-0000-0000-000000000001'$$) = 1);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-0000000000a3';
select s5.check('a viewer cannot fill values', s5.affected($$update public.customers set custom_values = '{}' where id = 'a5c00000-0000-0000-0000-000000000001'$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-00000000000b';
select s5.check('another organization sees no definitions', (select count(*) from public.custom_field_definitions) = 0);
select s5.denies('another organization cannot define fields on ours', format($$insert into public.custom_field_definitions (organization_id, entity, key, label, field_type) values (%L, 'customer', 'x', 'x', 'text')$$, :'oa'));
reset role;

-- ---------------------------------------------------------------- catalogo
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-0000000000a2';
insert into public.products (id, organization_id, kind, code, name, unit, unit_price_cents, vat_rate, created_by)
  values ('a5e00000-0000-0000-0000-000000000001', :'oa', 'product', 'SER-01', 'Serramento PVC', 'pz', 50000, 22, 'a5000000-0000-0000-0000-0000000000a2');
insert into public.products (id, organization_id, kind, name, unit, unit_price_cents, created_by)
  values ('a5e00000-0000-0000-0000-000000000002', :'oa', 'service', 'Posa in opera', 'ora', 4500, 'a5000000-0000-0000-0000-0000000000a2');
select s5.check('a member creates products', (select count(*) from public.products) = 2);
select s5.denies('duplicate code (case-insensitive) rejected', format($$insert into public.products (organization_id, code, name, created_by) values (%L, 'ser-01', 'x', 'a5000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select s5.denies('negative price rejected', format($$insert into public.products (organization_id, name, unit_price_cents, created_by) values (%L, 'x', -1, 'a5000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select s5.check('a member can archive a product', s5.affected($$update public.products set deleted_at = now() where id = 'a5e00000-0000-0000-0000-000000000002'$$) = 1);
select s5.check('a member cannot delete a product', s5.affected($$delete from public.products where id = 'a5e00000-0000-0000-0000-000000000001'$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-0000000000a3';
select s5.denies('a viewer cannot create products', format($$insert into public.products (organization_id, name, created_by) values (%L, 'x', 'a5000000-0000-0000-0000-0000000000a3')$$, :'oa'));
select s5.check('a viewer can read products', (select count(*) from public.products) = 2);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-00000000000b';
select s5.check('another organization sees no products', (select count(*) from public.products) = 0);
reset role;

-- ---------------------------------------------------------------- listini
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-00000000000a';
insert into public.price_lists (id, organization_id, name) values ('a5f00000-0000-0000-0000-000000000001', :'oa', 'Rivenditori');
select s5.denies('duplicate list name rejected', format($$insert into public.price_lists (organization_id, name) values (%L, 'RIVENDITORI')$$, :'oa'));
insert into public.price_list_items (organization_id, price_list_id, product_id, unit_price_cents)
  values (:'oa', 'a5f00000-0000-0000-0000-000000000001', 'a5e00000-0000-0000-0000-000000000001', 42000);
select s5.denies('one price per product per list', format($$insert into public.price_list_items (organization_id, price_list_id, product_id, unit_price_cents) values (%L, 'a5f00000-0000-0000-0000-000000000001', 'a5e00000-0000-0000-0000-000000000001', 1)$$, :'oa'));
update public.customers set price_list_id = 'a5f00000-0000-0000-0000-000000000001' where id = 'a5c00000-0000-0000-0000-000000000001';
select s5.check('customer linked to a price list', (select price_list_id is not null from public.customers where id = 'a5c00000-0000-0000-0000-000000000001'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-00000000000b';
select s5.denies('a foreign list cannot be attached to our customer (composite FK)', $$update public.customers set price_list_id = 'a5f00000-0000-0000-0000-000000000001' where id = 'b5c00000-0000-0000-0000-000000000001'$$);
select s5.denies('another organization cannot add items to our list', format($$insert into public.price_list_items (organization_id, price_list_id, product_id, unit_price_cents) values (%L, 'a5f00000-0000-0000-0000-000000000001', 'a5e00000-0000-0000-0000-000000000001', 1)$$, :'ob'));
select s5.check('another organization sees no lists or items', (select count(*) from public.price_lists) + (select count(*) from public.price_list_items) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-0000000000a2';
select s5.denies('a member cannot create price lists', format($$insert into public.price_lists (organization_id, name) values (%L, 'Mio')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-00000000000a';
delete from public.price_lists where id = 'a5f00000-0000-0000-0000-000000000001';
select s5.check('deleting a list detaches customers and removes its items', (select price_list_id is null from public.customers where id = 'a5c00000-0000-0000-0000-000000000001')
  and (select count(*) from public.price_list_items) = 0);
reset role;

-- ---------------------------------------------------------------- modelli di preventivo
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-0000000000a2';
insert into public.quote_templates (id, organization_id, name, items, created_by)
  values ('a5d00000-0000-0000-0000-000000000001', :'oa', 'Sostituzione infissi', '[{"description":"Serramento","quantity":1,"unit_price_cents":50000,"discount_percent":0,"vat_rate":22}]', 'a5000000-0000-0000-0000-0000000000a2');
select s5.check('template stored', (select jsonb_array_length(items) from public.quote_templates) = 1);
select s5.denies('items must be an array', format($$insert into public.quote_templates (organization_id, name, items, created_by) values (%L, 'x', '{}', 'a5000000-0000-0000-0000-0000000000a2')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-00000000000b';
select s5.check('another organization sees no templates', (select count(*) from public.quote_templates) = 0);
select s5.check('another organization cannot edit our template', s5.affected($$update public.quote_templates set name = 'hack'$$) = 0);
reset role;

-- ---------------------------------------------------------------- duplicazione e audit
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-00000000000a';
select public.save_quote(null, :'oa', 'a5c00000-0000-0000-0000-000000000001', 'Q', current_date, null, null, null,
  '[{"description":"Voce","quantity":1,"unit_price_cents":1000,"discount_percent":0,"vat_rate":22}]') as q1 \gset
update public.quotes set custom_values = '{"cantiere":"Via Roma"}' where id = :'q1';
select public.duplicate_quote(:'q1') as d1 \gset
select s5.check('duplicate copies custom values', (select custom_values ->> 'cantiere' from public.quotes where id = :'d1') = 'Via Roma');
select s5.check('catalog and definitions are audited', (select count(distinct entity) from public.audit_logs where entity in ('products', 'custom_field_definitions', 'price_lists', 'quote_templates')) = 4);
reset role;
select s5.check('every table still has RLS', (
  select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity));
rollback;
\echo SECTOR TESTS PASSED
