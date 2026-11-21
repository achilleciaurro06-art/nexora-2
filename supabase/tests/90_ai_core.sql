-- Migrazione 22: crediti AI (prenotazione e contabilizzazione), azioni proposte, insight proattivi.
\set ON_ERROR_STOP on
begin;
create schema e9; grant usage on schema e9 to public;
create function e9.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
create function e9.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
create function e9.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema e9 to public;

insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-00000000000a', 'owner-a@a.it'), ('a9000000-0000-0000-0000-0000000000a2', 'member-a@a.it'),
  ('a9000000-0000-0000-0000-0000000000a3', 'viewer-a@a.it'), ('a9000000-0000-0000-0000-0000000000a4', 'member2-a@a.it'),
  ('b9000000-0000-0000-0000-00000000000b', 'owner-b@b.it');
insert into auth.users (id, email) values ('a9000000-0000-0000-0000-0000000000a5', 'x@x.it') on conflict do nothing;
set local role service_role;
select public.rpc_create_activation_code('c-a', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('c-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('c-a', 'owner-a@a.it', 'Alfa', 'a9000000-0000-0000-0000-00000000000a', 'Owner A') as oa \gset
select public.rpc_redeem_activation_code('c-b', 'owner-b@b.it', 'Beta', 'b9000000-0000-0000-0000-00000000000b', 'Owner B') as ob \gset
insert into public.memberships (organization_id, user_id, role) values
  (:'oa', 'a9000000-0000-0000-0000-0000000000a2', 'member'), (:'oa', 'a9000000-0000-0000-0000-0000000000a3', 'viewer');
reset role;
\set ua 'a9000000-0000-0000-0000-00000000000a'

-- ---------------------------------------------------------------- crediti: prenotazione
update public.ai_quotas set monthly_token_limit = 1000, tokens_used = 0 where organization_id = :'oa';
set local role service_role;
select public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0001-aaaa', 400) as r1 \gset
select e9.check('reservation within the limit succeeds', (:'r1'::jsonb ->> 'ok')::boolean and not (:'r1'::jsonb ->> 'duplicate')::boolean);
select (:'r1'::jsonb ->> 'id') as id1 \gset
select e9.check('tokens are held', (select tokens_used from public.ai_quotas where organization_id = :'oa') = 400);
select public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0001-aaaa', 400) as r1b \gset
select e9.check('the same request key does not reserve twice', (:'r1b'::jsonb ->> 'duplicate')::boolean and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 400);
select public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0002-bbbb', 700) as r2 \gset
select e9.check('exceeding the limit is refused', (:'r2'::jsonb ->> 'reason') = 'limit' and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 400);
select public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0003-cccc', 600) as r3 \gset
select e9.check('a second reservation that fits is accepted', (:'r3'::jsonb ->> 'ok')::boolean);
select public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0004-dddd', 1) as r4 \gset
select e9.check('the limit is now exactly reached and further requests are refused', (:'r4'::jsonb ->> 'reason') = 'limit' and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 1000);
select e9.check('invalid amounts are refused', (public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0005-eeee', 0) ->> 'reason') = 'invalid');
select e9.check('an organization without quota cannot reserve', (public.rpc_ai_reserve('00000000-0000-0000-0000-000000000000', :'ua', 'copilot', 'req-0006-ffff', 10) ->> 'reason') = 'no_quota');

-- contabilizzazione
update public.ai_quotas set input_price_micro_per_mtok = null, output_price_micro_per_mtok = null where organization_id = :'oa';
select public.rpc_ai_settle(:'id1', 100, 50, 'gemini', 'm1', false) as ok1 \gset
select e9.check('settle replaces the estimate with real tokens', :'ok1' and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 750);
select e9.check('usage is recorded with provider tokens and no cost when prices are not configured',
  (select input_tokens = 100 and output_tokens = 50 and tokens_source = 'provider' and cost_source = 'none' and cost_micro_eur = 0 and status = 'completed' from public.ai_usage where reservation_id = :'id1'::uuid));
select public.rpc_ai_settle(:'id1', 100, 50, 'gemini', 'm1', false) as ok2 \gset
select e9.check('a second settle does not charge twice', not :'ok2' and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 750 and (select count(*) from public.ai_usage where reservation_id = :'id1'::uuid) = 1);
select e9.check('a settled reservation cannot be released', not public.rpc_ai_release(:'id1', 'x'));

-- rilascio (richiesta fallita)
select (public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0007-gggg', 200) ->> 'id') as id2 \gset
select public.rpc_ai_release(:'id2', 'overloaded') as ok3 \gset
select e9.check('release refunds the held tokens', :'ok3' and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 750);
select e9.check('a failed request is logged with zero tokens (no charge)', (select status = 'failed' and input_tokens = 0 and output_tokens = 0 and error_kind = 'overloaded' from public.ai_usage where reservation_id = :'id2'::uuid));
select public.rpc_ai_settle(:'id2', 10, 10, 'gemini', 'm1', false) as ok4 \gset
select e9.check('a released reservation cannot be settled', not :'ok4' and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 750);
select public.rpc_ai_release(:'id2', 'again') as ok5 \gset
select e9.check('release is idempotent', not :'ok5' and (select count(*) from public.ai_usage where reservation_id = :'id2'::uuid) = 1);

-- costo stimato (prezzi configurati) e token stimati
update public.ai_quotas set input_price_micro_per_mtok = 100000, output_price_micro_per_mtok = 400000 where organization_id = :'oa';
select (public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0008-hhhh', 100) ->> 'id') as id3 \gset
select public.rpc_ai_settle(:'id3', 1000000, 500000, 'gemini', 'm1', true);
select e9.check('cost is an explicit estimate computed from configured prices', (select cost_micro_eur = 300000 and cost_source = 'estimated' and tokens_source = 'estimated' from public.ai_usage where reservation_id = :'id3'::uuid));

-- prenotazioni abbandonate
update public.ai_quotas set tokens_used = 0 where organization_id = :'oa';
select (public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0009-iiii', 300) ->> 'id') as id4 \gset
update public.ai_reservations set created_at = now() - interval '30 minutes' where id = :'id4'::uuid;
select public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0010-jjjj', 50);
select e9.check('abandoned reservations are refunded automatically and logged as cancelled',
  (select status = 'released' from public.ai_reservations where id = :'id4'::uuid) and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 50
  and exists (select 1 from public.ai_usage where reservation_id = :'id4'::uuid and status = 'cancelled' and input_tokens = 0));
-- mese successivo: il consumo si azzera
update public.ai_quotas set period_start = (date_trunc('month', current_date) - interval '1 month')::date, tokens_used = 900 where organization_id = :'oa';
select public.rpc_ai_reserve(:'oa', :'ua', 'copilot', 'req-0011-kkkk', 100) as r11 \gset
select e9.check('a new month resets the consumption before reserving', (:'r11'::jsonb ->> 'ok')::boolean and (select tokens_used from public.ai_quotas where organization_id = :'oa') = 100);
reset role;

-- isolamento: utenti e anon non possono usare le funzioni né le tabelle
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-0000-0000-00000000000a';
select e9.denies('users cannot reserve credits directly', format($q$select public.rpc_ai_reserve(%L, %L, 'x', 'req-9999-zzzz', 1)$q$, :'oa', :'ua'));
select e9.denies('users cannot settle', format($q$select public.rpc_ai_settle(%L, 1, 1, 'p', 'm', false)$q$, :'id1'));
select e9.denies('users cannot read reservations', $q$select count(*) from public.ai_reservations$q$);
select e9.denies('users cannot edit quotas (limits are admin-only)', format($q$update public.ai_quotas set monthly_token_limit = 99999999 where organization_id = %L$q$, :'oa'));
reset role;
set local role anon;
select e9.denies('anon cannot reserve', format($q$select public.rpc_ai_reserve(%L, %L, 'x', 'req-9998-zzzz', 1)$q$, :'oa', :'ua'));
reset role;

-- ---------------------------------------------------------------- azioni proposte
insert into public.ai_suggestions (id, organization_id, kind, payload, source_type, created_by, description)
values ('a9500000-0000-0000-0000-000000000001', :'oa', 'task', '{"kind":"task","title":"x"}', 'conversation', :'ua', 'Crea attività'),
       ('a9500000-0000-0000-0000-000000000002', :'oa', 'follow_up', '{"kind":"follow_up"}', 'conversation', :'ua', 'Follow-up'),
       ('a9500000-0000-0000-0000-000000000003', :'oa', 'email_draft', '{"kind":"email_draft"}', 'conversation', :'ua', 'Bozza');
set local role service_role;
select e9.check('the first claim wins', (select id from public.rpc_ai_claim_action(:'oa', 'a9500000-0000-0000-0000-000000000001', :'ua')) = 'a9500000-0000-0000-0000-000000000001');
select e9.check('a second (double-click / concurrent) claim gets nothing', (select id from public.rpc_ai_claim_action(:'oa', 'a9500000-0000-0000-0000-000000000001', :'ua')) is null);
select e9.check('another organization cannot claim it', (select id from public.rpc_ai_claim_action(:'ob', 'a9500000-0000-0000-0000-000000000002', :'ua')) is null);
select public.rpc_ai_finish_action(:'oa', 'a9500000-0000-0000-0000-000000000001', :'ua', false, '{"error":"boom"}') as f1 \gset
select e9.check('finishing with an error keeps it retryable', :'f1' and (select execution_status = 'failed' and status = 'pending' and attempts = 1 from public.ai_suggestions where id = 'a9500000-0000-0000-0000-000000000001'));
select e9.check('a failed action can be claimed again', (select attempts from public.rpc_ai_claim_action(:'oa', 'a9500000-0000-0000-0000-000000000001', :'ua')) = 2);
select public.rpc_ai_finish_action(:'oa', 'a9500000-0000-0000-0000-000000000001', :'ua', true, '{"id":"t"}') as f2 \gset
select e9.check('success marks it accepted, executed and attributed', :'f2'
  and (select execution_status = 'done' and status = 'accepted' and decided_by = :'ua' and executed_at is not null and execution_result ->> 'id' = 't' from public.ai_suggestions where id = 'a9500000-0000-0000-0000-000000000001'));
select e9.check('an executed action can never be claimed again', (select id from public.rpc_ai_claim_action(:'oa', 'a9500000-0000-0000-0000-000000000001', :'ua')) is null);
select e9.check('finishing without a claim does nothing', not public.rpc_ai_finish_action(:'oa', 'a9500000-0000-0000-0000-000000000002', :'ua', true, '{}'));
select (id) from public.rpc_ai_claim_action(:'oa', 'a9500000-0000-0000-0000-000000000003', :'ua');
select e9.check('an action that is running now cannot be claimed again', (select id from public.rpc_ai_claim_action(:'oa', 'a9500000-0000-0000-0000-000000000003', :'ua')) is null);
reset role;
alter table public.ai_suggestions disable trigger ai_suggestions_updated_at;
update public.ai_suggestions set updated_at = now() - interval '10 minutes' where id = 'a9500000-0000-0000-0000-000000000003';
alter table public.ai_suggestions enable trigger ai_suggestions_updated_at;
set local role service_role;
select e9.check('a stuck "running" action (older than 5 minutes) can be resumed', (select attempts from public.rpc_ai_claim_action(:'oa', 'a9500000-0000-0000-0000-000000000003', :'ua')) = 2);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-0000-0000-00000000000a';
select e9.denies('a running action cannot be rejected by the user', $q$update public.ai_suggestions set status = 'rejected' where id = 'a9500000-0000-0000-0000-000000000003'$q$);
select e9.check('a pending action can still be rejected', e9.affected($q$update public.ai_suggestions set status = 'rejected' where id = 'a9500000-0000-0000-0000-000000000002'$q$) = 1);
select e9.denies('users cannot mark an action executed by hand', $q$update public.ai_suggestions set execution_status = 'done' where id = 'a9500000-0000-0000-0000-000000000002'$q$);
select e9.denies('users cannot use claim', format($q$select * from public.rpc_ai_claim_action(%L, 'a9500000-0000-0000-0000-000000000002', %L)$q$, :'oa', :'ua'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b9000000-0000-0000-0000-00000000000b';
select e9.check('another organization does not see the suggestions', (select count(*) from public.ai_suggestions) = 0);
reset role;

-- ---------------------------------------------------------------- insight
set local role service_role;
select e9.check('first claim of the insight generation wins', public.rpc_ai_insights_claim(:'oa', 3600));
select e9.check('a concurrent / immediate claim does not', not public.rpc_ai_insights_claim(:'oa', 3600));
select e9.check('with a zero interval it can run again', public.rpc_ai_insights_claim(:'oa', 0));
select public.rpc_ai_insights_sync(:'oa', jsonb_build_array(
  jsonb_build_object('dedupe_key', 'stale:c1', 'rule', 'stale_customer', 'category', 'opportunity', 'priority', 'high', 'title', 'T1', 'description', 'D', 'reason', 'R', 'evidence', '[{"label":"Cliente Uno","href":"/clienti/x"}]'::jsonb, 'action_href', '/clienti/x', 'expires_at', (now() + interval '7 days')),
  jsonb_build_object('dedupe_key', 'late:q1', 'rule', 'late_followup', 'category', 'attention', 'title', 'T2', 'description', 'D', 'reason', 'R', 'expires_at', (now() + interval '7 days')))) as s1 \gset
select e9.check('sync creates the new insights', (:'s1'::jsonb ->> 'created') = '2' and (select count(*) from public.ai_insights where organization_id = :'oa') = 2);
select public.rpc_ai_insights_sync(:'oa', jsonb_build_array(
  jsonb_build_object('dedupe_key', 'stale:c1', 'rule', 'stale_customer', 'category', 'opportunity', 'priority', 'high', 'title', 'T1 aggiornato', 'description', 'D2', 'reason', 'R', 'expires_at', (now() + interval '7 days')),
  jsonb_build_object('dedupe_key', 'late:q1', 'rule', 'late_followup', 'category', 'attention', 'title', 'T2', 'description', 'D', 'reason', 'R', 'expires_at', (now() + interval '7 days')))) as s2 \gset
select e9.check('the same keys are updated, never duplicated', (:'s2'::jsonb ->> 'updated') = '2' and (:'s2'::jsonb ->> 'created') = '0' and (select count(*) from public.ai_insights where organization_id = :'oa') = 2
  and (select title from public.ai_insights where dedupe_key = 'stale:c1' and organization_id = :'oa') = 'T1 aggiornato');
select public.rpc_ai_insight_set_status(:'oa', (select id from public.ai_insights where dedupe_key = 'stale:c1' and organization_id = :'oa'), 'dismissed', :'ua') as d1 \gset
select e9.check('user decisions are preserved across refreshes', :'d1'
  and (select status from public.ai_insights where dedupe_key = 'stale:c1' and organization_id = :'oa') = 'dismissed');
select public.rpc_ai_insights_sync(:'oa', jsonb_build_array(
  jsonb_build_object('dedupe_key', 'stale:c1', 'rule', 'stale_customer', 'category', 'opportunity', 'title', 'T1 ancora', 'description', 'D3', 'reason', 'R', 'expires_at', (now() + interval '7 days')),
  jsonb_build_object('dedupe_key', 'late:q1', 'rule', 'late_followup', 'category', 'attention', 'title', 'T2', 'description', 'D', 'reason', 'R', 'expires_at', (now() + interval '7 days')))) as s3 \gset
select e9.check('a dismissed insight stays dismissed while the condition persists', (select status from public.ai_insights where dedupe_key = 'stale:c1' and organization_id = :'oa') = 'dismissed');
select public.rpc_ai_insights_sync(:'oa', jsonb_build_array(
  jsonb_build_object('dedupe_key', 'late:q1', 'rule', 'late_followup', 'category', 'attention', 'title', 'T2', 'description', 'D', 'reason', 'R', 'expires_at', (now() + interval '7 days')))) as s4 \gset
select e9.check('insights whose condition no longer holds are closed (expired)', (:'s4'::jsonb ->> 'closed') = '1' and (select expires_at <= now() from public.ai_insights where dedupe_key = 'stale:c1' and organization_id = :'oa'));
select e9.check('a closed insight cannot be changed by the user any more', not public.rpc_ai_insight_set_status(:'oa', (select id from public.ai_insights where dedupe_key = 'stale:c1' and organization_id = :'oa'), 'done', :'ua'));
select public.rpc_ai_insights_sync(:'oa', jsonb_build_array(
  jsonb_build_object('dedupe_key', 'stale:c1', 'rule', 'stale_customer', 'category', 'opportunity', 'title', 'T1 di nuovo', 'description', 'D4', 'reason', 'R', 'expires_at', (now() + interval '7 days')),
  jsonb_build_object('dedupe_key', 'late:q1', 'rule', 'late_followup', 'category', 'attention', 'title', 'T2', 'description', 'D', 'reason', 'R', 'expires_at', (now() + interval '7 days')))) as s5 \gset
select e9.check('an insight that comes back after being closed is new again', (:'s5'::jsonb ->> 'reopened') = '1' and (select status = 'new' from public.ai_insights where dedupe_key = 'stale:c1' and organization_id = :'oa'));
select e9.denies('invalid sync payloads are rejected', format($q$select public.rpc_ai_insights_sync(%L, '{"a":1}'::jsonb)$q$, :'oa'));
select e9.denies('invalid category is rejected by the table', format($q$select public.rpc_ai_insights_sync(%L, '[{"dedupe_key":"zz:1","rule":"r","category":"hack","title":"t","description":"d","reason":"r","expires_at":"2030-01-01T00:00:00Z"}]'::jsonb)$q$, :'oa'));
select e9.denies('external links are rejected by the table', format($q$select public.rpc_ai_insights_sync(%L, '[{"dedupe_key":"zz:2","rule":"r","category":"attention","title":"t","description":"d","reason":"r","action_href":"https://evil.example/x","expires_at":"2030-01-01T00:00:00Z"}]'::jsonb)$q$, :'oa'));
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-0000-0000-0000000000a3';
select e9.check('a read-only member sees the organization insights', (select count(*) from public.ai_insights) = 2);
select e9.denies('members cannot write insights directly', $q$update public.ai_insights set status = 'done'$q$);
select e9.denies('members cannot insert insights', format($q$insert into public.ai_insights (organization_id, dedupe_key, rule, category, title, description, reason, expires_at) values (%L, 'k:1', 'r', 'attention', 't', 'd', 'r', now())$q$, :'oa'));
select e9.denies('members cannot call the sync function', format($q$select public.rpc_ai_insights_sync(%L, '[]'::jsonb)$q$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b9000000-0000-0000-0000-00000000000b';
select e9.check('another organization sees none of them', (select count(*) from public.ai_insights) = 0);
reset role;
set local role anon;
select e9.denies('anon cannot read insights', $q$select count(*) from public.ai_insights$q$);
reset role;

-- ---------------------------------------------------------------- integrità finale
select e9.check('every table has RLS', (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity));
select e9.check('no permissive policies on the new tables', (select count(*) from pg_policies where tablename in ('ai_reservations', 'ai_insight_state')) = 0
  and (select count(*) from pg_policies where tablename = 'ai_insights' and cmd <> 'SELECT') = 0);
rollback;
\echo AI CORE TESTS PASSED
