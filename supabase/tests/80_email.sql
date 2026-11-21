-- Migrazione 21: caselle, segreti, conversazioni, messaggi, allegati, bozze, modelli, collegamento al CRM.
\set ON_ERROR_STOP on
begin;
create schema e8; grant usage on schema e8 to public;
create function e8.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
create function e8.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
create function e8.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema e8 to public;

insert into auth.users (id, email) values
  ('a8000000-0000-0000-0000-00000000000a', 'owner-a@a.it'), ('a8000000-0000-0000-0000-0000000000a2', 'member-a@a.it'),
  ('a8000000-0000-0000-0000-0000000000a3', 'viewer-a@a.it'), ('a8000000-0000-0000-0000-0000000000a4', 'member2-a@a.it'),
  ('b8000000-0000-0000-0000-00000000000b', 'owner-b@b.it');
set local role service_role;
select public.rpc_create_activation_code('c-a', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('c-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('c-a', 'owner-a@a.it', 'Alfa', 'a8000000-0000-0000-0000-00000000000a', 'Owner A') as oa \gset
select public.rpc_redeem_activation_code('c-b', 'owner-b@b.it', 'Beta', 'b8000000-0000-0000-0000-00000000000b', 'Owner B') as ob \gset
insert into public.memberships (organization_id, user_id, role) values
  (:'oa', 'a8000000-0000-0000-0000-0000000000a2', 'member'), (:'oa', 'a8000000-0000-0000-0000-0000000000a3', 'viewer'), (:'oa', 'a8000000-0000-0000-0000-0000000000a4', 'member');
reset role;
insert into public.customers (id, organization_id, name, email) values
  ('a8c00000-0000-0000-0000-000000000001', :'oa', 'Cliente Uno', 'info@uno.it'),
  ('a8c00000-0000-0000-0000-000000000002', :'oa', 'Cliente Due', 'info@due.it'),
  ('a8c00000-0000-0000-0000-000000000003', :'oa', 'Cliente Tre', 'condiviso@mail.it'),
  ('a8c00000-0000-0000-0000-000000000004', :'oa', 'Cliente Quattro', 'condiviso@mail.it'),
  ('b8c00000-0000-0000-0000-000000000001', :'ob', 'Cliente B', 'info@uno.it');
insert into public.customer_contacts (id, organization_id, customer_id, full_name, email) values
  ('a8d00000-0000-0000-0000-000000000001', :'oa', 'a8c00000-0000-0000-0000-000000000001', 'Mario Uno', 'Mario@Uno.it'),
  ('a8d00000-0000-0000-0000-000000000002', :'oa', 'a8c00000-0000-0000-0000-000000000002', 'Luisa Due', 'luisa@due.it');

-- ---------------------------------------------------------------- caselle e autorizzazioni (le righe le scrive il server con il service role)
insert into public.email_accounts (id, organization_id, provider, address, display_name, visibility, created_by) values
  ('a8e00000-0000-0000-0000-000000000001', :'oa', 'imap_smtp', 'vendite@alfa.it', 'Vendite', 'shared', 'a8000000-0000-0000-0000-00000000000a'),
  ('a8e00000-0000-0000-0000-000000000002', :'oa', 'gmail', 'marco@alfa.it', 'Marco', 'restricted', 'a8000000-0000-0000-0000-0000000000a2'),
  ('b8e00000-0000-0000-0000-000000000001', :'ob', 'outlook', 'info@beta.it', 'Beta', 'shared', 'b8000000-0000-0000-0000-00000000000b');
select e8.denies('same address twice in an organization (case-insensitive)', format($$insert into public.email_accounts (organization_id, provider, address, created_by) values (%L, 'gmail', 'VENDITE@alfa.it', 'a8000000-0000-0000-0000-00000000000a')$$, :'oa'));
select e8.denies('bad address rejected', format($$insert into public.email_accounts (organization_id, provider, address) values (%L, 'gmail', 'non-un-indirizzo')$$, :'oa'));
select e8.denies('unknown provider rejected', format($$insert into public.email_accounts (organization_id, provider, address) values (%L, 'yahoo', 'x@y.it')$$, :'oa'));

set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a3';
select e8.check('a viewer sees shared mailboxes only', (select array_agg(address order by address) from public.email_accounts) = array['vendite@alfa.it']);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a4';
select e8.check('a member not authorized does not see the restricted mailbox', (select count(*) from public.email_accounts where address = 'marco@alfa.it') = 0);
select e8.denies('cannot authorize himself on a mailbox that is not his', $$insert into public.email_account_members (account_id, organization_id, user_id) values ('a8e00000-0000-0000-0000-000000000002', (select id from public.organizations where name = 'Alfa'), 'a8000000-0000-0000-0000-0000000000a4')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a2';
select e8.check('the creator uses his restricted mailbox', (select count(*) from public.email_accounts where address = 'marco@alfa.it') = 1);
insert into public.email_account_members (account_id, organization_id, user_id) values ('a8e00000-0000-0000-0000-000000000002', :'oa', 'a8000000-0000-0000-0000-0000000000a4');
select e8.denies('an authorized user must belong to the organization', format($$insert into public.email_account_members (account_id, organization_id, user_id) values ('a8e00000-0000-0000-0000-000000000002', %L, 'b8000000-0000-0000-0000-00000000000b')$$, :'oa'));
update public.email_accounts set display_name = 'Marco Rossi', signature = 'Marco' where id = 'a8e00000-0000-0000-0000-000000000002';
select e8.check('the creator edits name and signature', (select display_name = 'Marco Rossi' from public.email_accounts where id = 'a8e00000-0000-0000-0000-000000000002'));
select e8.denies('status and provider cannot be edited by users', $$update public.email_accounts set status = 'connected', provider = 'outlook' where id = 'a8e00000-0000-0000-0000-000000000002'$$);
select e8.denies('the sync cursor cannot be edited by users', $$update public.email_accounts set sync_cursor = '{}' where id = 'a8e00000-0000-0000-0000-000000000002'$$);
select e8.denies('users cannot insert accounts', format($$insert into public.email_accounts (organization_id, provider, address, created_by) values (%L, 'gmail', 'x@alfa.it', 'a8000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select e8.denies('users cannot delete accounts', $$delete from public.email_accounts where id = 'a8e00000-0000-0000-0000-000000000002'$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a4';
select e8.check('after authorization the colleague sees it', (select count(*) from public.email_accounts where address = 'marco@alfa.it') = 1);
select e8.check('the colleague cannot edit it', e8.affected($$update public.email_accounts set display_name = 'hack' where id = 'a8e00000-0000-0000-0000-000000000002'$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.check('the owner manages every account of the organization', (select count(*) from public.email_accounts) = 2);
select public.set_default_email_account('a8e00000-0000-0000-0000-000000000001');
select public.set_default_email_account('a8e00000-0000-0000-0000-000000000002');
select e8.check('only one default account per organization', (select count(*) from public.email_accounts where is_default) = 1 and (select address from public.email_accounts where is_default) = 'marco@alfa.it');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a2';
select e8.denies('a member cannot set the default account', $$select public.set_default_email_account('a8e00000-0000-0000-0000-000000000001')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b8000000-0000-0000-0000-00000000000b';
select e8.check('another organization sees only its own mailbox', (select array_agg(address) from public.email_accounts) = array['info@beta.it']);
select e8.denies('another organization cannot set our default', $$select public.set_default_email_account('a8e00000-0000-0000-0000-000000000001')$$);
select e8.check('another organization cannot edit ours', e8.affected($$update public.email_accounts set display_name = 'hack' where id = 'a8e00000-0000-0000-0000-000000000001'$$) = 0);
reset role;

-- ---------------------------------------------------------------- segreti
set local role service_role;
select public.rpc_email_secret_set('a8e00000-0000-0000-0000-000000000002', 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
select e8.check('the service role stores and reads the (already encrypted) secret', public.rpc_email_secret_get('a8e00000-0000-0000-0000-000000000002') = 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
select e8.denies('a too-short value (plain password) is rejected', $$select public.rpc_email_secret_set('a8e00000-0000-0000-0000-000000000002', 'abc')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.denies('users cannot read secrets (even the owner)', $$select public.rpc_email_secret_get('a8e00000-0000-0000-0000-000000000002')$$);
select e8.denies('users cannot write secrets', $$select public.rpc_email_secret_set('a8e00000-0000-0000-0000-000000000002', 'v1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')$$);
select e8.denies('users cannot touch the private table', $$select * from private.email_account_secrets$$);
reset role;
set local role anon;
select e8.denies('anon cannot call the secret functions', $$select public.rpc_email_secret_get('a8e00000-0000-0000-0000-000000000002')$$);
reset role;
select e8.check('deleting the account removes its secret (cascade)', (select count(*) from private.email_account_secrets) = 1);

-- sincronizzazione: prenotazione atomica (due sincronizzazioni insieme non si sovrappongono)
set local role service_role;
select e8.check('the first claim wins', public.rpc_email_claim_sync('a8e00000-0000-0000-0000-000000000001'));
select e8.check('a second claim while the first runs is refused', not public.rpc_email_claim_sync('a8e00000-0000-0000-0000-000000000001'));
reset role;
update public.email_accounts set sync_started_at = now() - interval '4 minutes' where id = 'a8e00000-0000-0000-0000-000000000001';
set local role service_role;
select e8.check('a stale claim (crashed run) can be taken over', public.rpc_email_claim_sync('a8e00000-0000-0000-0000-000000000001'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.denies('users cannot claim syncs', $$select public.rpc_email_claim_sync('a8e00000-0000-0000-0000-000000000001')$$);
reset role;

-- ---------------------------------------------------------------- conversazioni e messaggi
set local request.jwt.claim.sub = '';  -- come il service role: nessun utente
insert into public.email_threads (id, organization_id, account_id, provider_thread_id, subject) values
  ('a8f00000-0000-0000-0000-000000000001', :'oa', 'a8e00000-0000-0000-0000-000000000001', 'T1', 'Richiesta preventivo'),
  ('a8f00000-0000-0000-0000-000000000002', :'oa', 'a8e00000-0000-0000-0000-000000000002', 'T2', 'Privata di Marco');
insert into public.email_messages (id, organization_id, account_id, thread_id, direction, provider_message_id, internet_message_id, from_address, to_addrs, subject, snippet, message_at, status) values
  ('a8a00000-0000-0000-0000-000000000001', :'oa', 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'inbound', 'M1', '<m1@uno.it>', 'mario@uno.it', '[{"address":"vendite@alfa.it"}]', 'Richiesta preventivo', 'Buongiorno vorrei un preventivo', now() - interval '2 hours', 'received'),
  ('a8a00000-0000-0000-0000-000000000002', :'oa', 'a8e00000-0000-0000-0000-000000000002', 'a8f00000-0000-0000-0000-000000000002', 'inbound', 'M2', '<m2@x.it>', 'altro@x.it', '[{"address":"marco@alfa.it"}]', 'Privata di Marco', 'Riservata', now() - interval '1 hour', 'received');
select e8.check('the thread summarizes its messages', (select message_count = 1 and unread_count = 1 from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
select e8.denies('the same provider message cannot be imported twice', format($$insert into public.email_messages (organization_id, account_id, thread_id, direction, provider_message_id, from_address, status) values (%L, 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'inbound', 'M1', 'x@y.it', 'received')$$, :'oa'));
insert into public.email_messages (organization_id, account_id, thread_id, direction, provider_message_id, from_address, to_addrs, subject, message_at, status, is_read, sent_by) values
  (:'oa', 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'outbound', 'M3', 'vendite@alfa.it', '[{"address":"mario@uno.it"}]', 'Re: Richiesta preventivo', now() - interval '1 hour', 'sent', true, 'a8000000-0000-0000-0000-00000000000a');
select e8.check('the thread follows: 2 messages, still 1 unread', (select message_count = 2 and unread_count = 1 from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
select e8.denies('an inbound message cannot have a sending status', format($$insert into public.email_messages (organization_id, account_id, thread_id, direction, from_address, status) values (%L, 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'inbound', 'x@y.it', 'sent')$$, :'oa'));
select gen_random_uuid() as idem \gset
insert into public.email_messages (organization_id, account_id, thread_id, direction, from_address, status, idempotency_key) values (:'oa', 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'outbound', 'vendite@alfa.it', 'sending', :'idem');
select e8.denies('a send attempt with the same idempotency key is rejected (no duplicate sends)', format($$insert into public.email_messages (organization_id, account_id, thread_id, direction, from_address, status, idempotency_key) values (%L, 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'outbound', 'vendite@alfa.it', 'sending', %L)$$, :'oa', :'idem'));
delete from public.email_messages where idempotency_key = :'idem';
select e8.check('search text includes sender, subject and recipients', (select search_text like '%mario@uno.it%' and search_text like '%richiesta preventivo%' from public.email_messages where provider_message_id = 'M1'));

set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.check('the owner sees shared-mailbox messages but NOT those of a restricted mailbox he is not authorized on',
  (select count(*) from public.email_messages) = 2 and (select count(*) from public.email_messages where subject = 'Privata di Marco') = 0 and (select count(*) from public.email_threads) = 1);
select e8.denies('users cannot insert messages', format($$insert into public.email_messages (organization_id, account_id, thread_id, direction, from_address, status) values (%L, 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'outbound', 'x@y.it', 'sent')$$, :'oa'));
select e8.denies('users cannot delete messages', $$delete from public.email_messages$$);
select e8.denies('users cannot edit message content', $$update public.email_messages set body_text = 'x' where provider_message_id = 'M1'$$);
update public.email_messages set is_read = true where provider_message_id = 'M1';
select e8.check('marking as read updates the unread counter', (select unread_count = 0 from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a3';
select e8.check('a viewer reads the shared mailbox', (select count(*) from public.email_messages) = 2);
select e8.check('a viewer cannot change read state', e8.affected($$update public.email_messages set is_read = false$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a2';
select e8.check('the owner of the restricted mailbox sees its messages and the shared ones', (select count(*) from public.email_messages) = 3);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b8000000-0000-0000-0000-00000000000b';
select e8.check('another organization sees no messages or threads', (select count(*) from public.email_messages) + (select count(*) from public.email_threads) = 0);
reset role;

-- ---------------------------------------------------------------- abbinamento indirizzi (solo indirizzi esatti)
set local role service_role;
select e8.check('exact customer address matches (case-insensitive)', (select count(*) from public.email_match_addresses(:'oa', array['INFO@uno.it']) where customer_id = 'a8c00000-0000-0000-0000-000000000001' and contact_id is null) = 1);
select e8.check('a contact address matches its contact and customer', (select count(*) from public.email_match_addresses(:'oa', array['mario@uno.it']) where contact_id = 'a8d00000-0000-0000-0000-000000000001' and customer_id = 'a8c00000-0000-0000-0000-000000000001') = 1);
select e8.check('an address shared by two customers returns both (ambiguous)', (select count(distinct customer_id) from public.email_match_addresses(:'oa', array['condiviso@mail.it'])) = 2);
select e8.check('no match for unknown or similar addresses', (select count(*) from public.email_match_addresses(:'oa', array['info@uno.com', 'nuovo@sconosciuto.it', 'info@un.it'])) = 0);
select e8.check('matching never crosses organizations', (select count(*) from public.email_match_addresses(:'ob', array['info@uno.it']) where customer_id = 'b8c00000-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.email_match_addresses(:'ob', array['mario@uno.it'])) = 0);
reset role;

-- ---------------------------------------------------------------- collegamento al CRM
set local request.jwt.claim.sub = '';  -- come il service role: nessun utente
update public.email_threads set customer_id = 'a8c00000-0000-0000-0000-000000000001', contact_id = 'a8d00000-0000-0000-0000-000000000001', link_status = 'auto' where id = 'a8f00000-0000-0000-0000-000000000001';
select e8.check('the system can link automatically (status auto, no author)', (select link_status = 'auto' and linked_by is null from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
select e8.check('timeline: link event on the customer', (select count(*) from public.activity_events where entity = 'email' and event = 'linked' and customer_id = 'a8c00000-0000-0000-0000-000000000001') = 1);
insert into public.email_messages (organization_id, account_id, thread_id, direction, provider_message_id, from_address, to_addrs, subject, message_at, status) values
  (:'oa', 'a8e00000-0000-0000-0000-000000000001', 'a8f00000-0000-0000-0000-000000000001', 'inbound', 'M4', 'mario@uno.it', '[]', 'Re: Re: Richiesta preventivo', now(), 'received');
select e8.check('timeline: new message of a linked thread appears on the customer', (select count(*) from public.activity_events where entity = 'email' and event = 'received' and customer_id = 'a8c00000-0000-0000-0000-000000000001') = 1);
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
update public.email_threads set customer_id = 'a8c00000-0000-0000-0000-000000000002', contact_id = 'a8d00000-0000-0000-0000-000000000002' where id = 'a8f00000-0000-0000-0000-000000000001';
select e8.check('a manual change is recorded as manual with author', (select link_status = 'manual' and linked_by = 'a8000000-0000-0000-0000-00000000000a' and customer_id = 'a8c00000-0000-0000-0000-000000000002' from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
select e8.denies('a contact of another customer is rejected', $$update public.email_threads set contact_id = 'a8d00000-0000-0000-0000-000000000001' where id = 'a8f00000-0000-0000-0000-000000000001'$$);
select e8.denies('a customer of another organization is rejected (composite FK)', $$update public.email_threads set customer_id = 'b8c00000-0000-0000-0000-000000000001', contact_id = null where id = 'a8f00000-0000-0000-0000-000000000001'$$);
select e8.denies('a quote that is not of the customer is rejected', format($$update public.email_threads set quote_id = gen_random_uuid() where id = 'a8f00000-0000-0000-0000-000000000001'$$));
select e8.denies('the link status and candidates cannot be edited directly', $$update public.email_threads set link_status = 'auto' where id = 'a8f00000-0000-0000-0000-000000000001'$$);
select e8.denies('the subject and account cannot be edited', $$update public.email_threads set subject = 'x' where id = 'a8f00000-0000-0000-0000-000000000001'$$);
update public.email_threads set customer_id = null where id = 'a8f00000-0000-0000-0000-000000000001';
select e8.check('unlinking resets to none (and clears the contact)', (select link_status = 'none' and customer_id is null and contact_id is null from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
reset role;
set local request.jwt.claim.sub = '';
update public.customers set archived_at = now() where id = 'a8c00000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.denies('no manual link to an archived customer', $$update public.email_threads set customer_id = 'a8c00000-0000-0000-0000-000000000002' where id = 'a8f00000-0000-0000-0000-000000000001'$$);
reset role;
set local request.jwt.claim.sub = '';
update public.email_threads set customer_id = 'a8c00000-0000-0000-0000-000000000002', link_status = 'auto' where id = 'a8f00000-0000-0000-0000-000000000001';
select e8.check('automatic links to archived customers keep their history', (select customer_id is not null from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.check('even the owner cannot link threads of a restricted mailbox he is not authorized on', e8.affected($$update public.email_threads set task_id = null where id = 'a8f00000-0000-0000-0000-000000000002'$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a3';
select e8.check('a viewer cannot link threads', e8.affected($$update public.email_threads set customer_id = null where id = 'a8f00000-0000-0000-0000-000000000001'$$) = 0);
reset role;
set local request.jwt.claim.sub = '';
update public.customers set archived_at = null where id = 'a8c00000-0000-0000-0000-000000000002';

-- task e follow-up da un'email: coerenza con il cliente
insert into public.tasks (id, organization_id, title, customer_id, created_by) values ('a8b00000-0000-0000-0000-000000000001', :'oa', 'Rispondere', 'a8c00000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-00000000000a');
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.denies('a task of another customer cannot be linked', $$update public.email_threads set customer_id = 'a8c00000-0000-0000-0000-000000000002', task_id = 'a8b00000-0000-0000-0000-000000000001' where id = 'a8f00000-0000-0000-0000-000000000001'$$);
update public.email_threads set customer_id = 'a8c00000-0000-0000-0000-000000000001', task_id = 'a8b00000-0000-0000-0000-000000000001' where id = 'a8f00000-0000-0000-0000-000000000001';
select e8.check('thread linked to customer and its task', (select task_id is not null from public.email_threads where id = 'a8f00000-0000-0000-0000-000000000001'));
reset role;
select e8.check('last contact of the customer considers emails', (public.customer_commercial_summary('a8c00000-0000-0000-0000-000000000001') ->> 'last_contact_at')::timestamptz > now() - interval '5 minutes');
select e8.check('customers with email threads cannot be deleted permanently', (select (public.customer_delete_blockers('a8c00000-0000-0000-0000-000000000001') ->> 'emails')::int >= 1));

-- ---------------------------------------------------------------- allegati
insert into public.email_attachments (organization_id, message_id, filename, mime_type, size_bytes, storage_path) values
  (:'oa', 'a8a00000-0000-0000-0000-000000000001', 'offerta.pdf', 'application/pdf', 1000, :'oa' || '/email/a8a00000/offerta.pdf'),
  (:'oa', 'a8a00000-0000-0000-0000-000000000002', 'privato.pdf', 'application/pdf', 1000, :'oa' || '/email/a8a00000/privato.pdf');
select e8.denies('the storage path must be inside the organization folder', format($$insert into public.email_attachments (organization_id, message_id, filename, mime_type, size_bytes, storage_path) values (%L, 'a8a00000-0000-0000-0000-000000000001', 'x.pdf', 'application/pdf', 1, 'altra-org/x.pdf')$$, :'oa'));
select e8.denies('attachment size is bounded', format($$insert into public.email_attachments (organization_id, message_id, filename, mime_type, size_bytes, storage_path) values (%L, 'a8a00000-0000-0000-0000-000000000001', 'x.pdf', 'application/pdf', 99999999999, %L)$$, :'oa', :'oa' || '/x.pdf'));
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.check('attachments follow the mailbox permission', (select array_agg(filename) from public.email_attachments) = array['offerta.pdf']);
select e8.denies('users cannot insert attachments', format($$insert into public.email_attachments (organization_id, message_id, filename, mime_type, size_bytes, storage_path) values (%L, 'a8a00000-0000-0000-0000-000000000001', 'x.pdf', 'application/pdf', 1, %L)$$, :'oa', :'oa' || '/y.pdf'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a2';
select e8.check('the authorized collaborator sees both', (select count(*) from public.email_attachments) = 2);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b8000000-0000-0000-0000-00000000000b';
select e8.check('another organization sees none', (select count(*) from public.email_attachments) = 0);
reset role;
-- bucket privato: nessun accesso diretto ai file
insert into storage.objects (bucket_id, name) values ('email-attachments', :'oa' || '/email/a8a00000/offerta.pdf');
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.check('the email bucket is not readable by users (only the server can serve it)', (select count(*) from storage.objects where bucket_id = 'email-attachments') = 0);
select e8.denies('users cannot upload directly to the email bucket', format($$insert into storage.objects (bucket_id, name) values ('email-attachments', %L)$$, :'oa' || '/email/x.pdf'));
reset role;
select e8.check('the bucket is private', (select not public from storage.buckets where id = 'email-attachments'));

-- ---------------------------------------------------------------- bozze
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a2';
insert into public.email_drafts (id, organization_id, author_id, account_id, subject, body_html, to_addrs) values
  ('a8900000-0000-0000-0000-000000000001', :'oa', 'a8000000-0000-0000-0000-0000000000a2', 'a8e00000-0000-0000-0000-000000000002', 'Bozza', '<p>Ciao</p>', '[{"address":"x@y.it"}]');
update public.email_drafts set body_html = '<p>Ciao a tutti</p>' where id = 'a8900000-0000-0000-0000-000000000001';
select e8.check('the author saves and resumes a draft', (select body_html from public.email_drafts where id = 'a8900000-0000-0000-0000-000000000001') = '<p>Ciao a tutti</p>');
select e8.denies('a draft cannot use a mailbox the author cannot use', format($$insert into public.email_drafts (organization_id, author_id, account_id) values (%L, 'a8000000-0000-0000-0000-0000000000a2', 'b8e00000-0000-0000-0000-000000000001')$$, :'oa'));
select e8.denies('a draft cannot be written on behalf of someone else', format($$insert into public.email_drafts (organization_id, author_id) values (%L, 'a8000000-0000-0000-0000-00000000000a')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a4';
select e8.check('colleagues (even on the same mailbox) cannot see someone else''s draft', (select count(*) from public.email_drafts) = 0);
select e8.check('...nor delete it', e8.affected($$delete from public.email_drafts$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
select e8.check('not even the owner reads another user''s drafts', (select count(*) from public.email_drafts) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a3';
select e8.denies('a viewer cannot create drafts', format($$insert into public.email_drafts (organization_id, author_id) values (%L, 'a8000000-0000-0000-0000-0000000000a3')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a2';
delete from public.email_drafts where id = 'a8900000-0000-0000-0000-000000000001';
select e8.check('the author deletes the draft', (select count(*) from public.email_drafts) = 0);
reset role;

-- ---------------------------------------------------------------- modelli e firme
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a2';
select e8.check('six starter templates per organization', (select count(*) from public.email_templates) = 6
  and (select count(*) from public.email_templates where name in ('Primo contatto', 'Invio preventivo', 'Follow-up dopo preventivo', 'Richiesta di informazioni', 'Risposta a un cliente', 'Ringraziamento')) = 6);
update public.email_templates set subject = 'Il mio oggetto' where name = 'Ringraziamento';
select e8.check('templates are editable by writers', (select subject from public.email_templates where name = 'Ringraziamento') = 'Il mio oggetto');
insert into public.email_templates (organization_id, name, subject, created_by) values (:'oa', 'Mio modello', 'x', 'a8000000-0000-0000-0000-0000000000a2');
select e8.denies('template names are unique per organization', format($$insert into public.email_templates (organization_id, name, created_by) values (%L, 'MIO MODELLO', 'a8000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select e8.check('a member cannot delete templates', e8.affected($$delete from public.email_templates where name = 'Mio modello'$$) = 0);
insert into public.email_user_signatures (user_id, organization_id, signature) values ('a8000000-0000-0000-0000-0000000000a2', :'oa', 'Marco Rossi — Vendite');
select e8.denies('nobody writes the signature of another user', format($$insert into public.email_user_signatures (user_id, organization_id, signature) values ('a8000000-0000-0000-0000-00000000000a', %L, 'x')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-0000000000a3';
select e8.check('a viewer reads templates but cannot create them and sees no signatures', (select count(*) from public.email_templates) >= 6 and (select count(*) from public.email_user_signatures) = 0);
select e8.denies('a viewer cannot create templates', format($$insert into public.email_templates (organization_id, name, created_by) values (%L, 'v', 'a8000000-0000-0000-0000-0000000000a3')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-0000-0000-00000000000a';
delete from public.email_templates where name = 'Mio modello';
select e8.check('the owner deletes templates', (select count(*) from public.email_templates where name = 'Mio modello') = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b8000000-0000-0000-0000-00000000000b';
select e8.check('another organization has its own templates only', (select count(*) from public.email_templates) = 6 and (select count(*) from public.email_templates where subject = 'Il mio oggetto') = 0);
reset role;

-- ---------------------------------------------------------------- integrità finale
select e8.check('every table has RLS', (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity));
rollback;
\echo EMAIL TESTS PASSED
