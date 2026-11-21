-- Migrazione 20: tipologie, appuntamenti, chiamate, follow-up a sei stati, vista agenda, notifiche.
\set ON_ERROR_STOP on
begin;
create schema g7; grant usage on schema g7 to public;
create function g7.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok   - %', p_name;
end $$;
create function g7.denies(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok   - % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL (allowed): %', p_name;
end $$;
create function g7.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema g7 to public;

insert into auth.users (id, email) values
  ('a7000000-0000-0000-0000-00000000000a', 'owner-a@a.it'), ('a7000000-0000-0000-0000-0000000000a2', 'member-a@a.it'),
  ('a7000000-0000-0000-0000-0000000000a3', 'viewer-a@a.it'), ('b7000000-0000-0000-0000-00000000000b', 'owner-b@b.it');
set local role service_role;
select public.rpc_create_activation_code('c-a', now() + interval '1 day', 1, null, null, null);
select public.rpc_create_activation_code('c-b', now() + interval '1 day', 1, null, null, null);
select public.rpc_redeem_activation_code('c-a', 'owner-a@a.it', 'Alfa', 'a7000000-0000-0000-0000-00000000000a', 'Owner A') as oa \gset
select public.rpc_redeem_activation_code('c-b', 'owner-b@b.it', 'Beta', 'b7000000-0000-0000-0000-00000000000b', 'Owner B') as ob \gset
insert into public.memberships (organization_id, user_id, role) values
  (:'oa', 'a7000000-0000-0000-0000-0000000000a2', 'member'), (:'oa', 'a7000000-0000-0000-0000-0000000000a3', 'viewer');
reset role;
insert into public.customers (id, organization_id, name) values
  ('a7c00000-0000-0000-0000-000000000001', :'oa', 'Cliente Uno'), ('a7c00000-0000-0000-0000-000000000002', :'oa', 'Cliente Due'),
  ('b7c00000-0000-0000-0000-000000000001', :'ob', 'Cliente B');
insert into public.customer_contacts (id, organization_id, customer_id, full_name) values
  ('a7d00000-0000-0000-0000-000000000001', :'oa', 'a7c00000-0000-0000-0000-000000000001', 'Referente Uno'),
  ('a7d00000-0000-0000-0000-000000000002', :'oa', 'a7c00000-0000-0000-0000-000000000002', 'Referente Due');

-- ---------------------------------------------------------------- tipologie di attività
select g7.check('every organization has the four system task types', (select count(*) from public.task_types where organization_id = :'oa' and system) = 4);
select g7.check('a new organization is seeded too', (select count(*) from public.task_types where organization_id = :'ob' and system) = 4);
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-00000000000a';
insert into public.task_types (organization_id, key, label) values (:'oa', 'sopralluogo', 'Sopralluogo');
select g7.check('owner adds a custom type', (select count(*) from public.task_types where key = 'sopralluogo') = 1);
select g7.denies('a system type cannot be forged', format($$insert into public.task_types (organization_id, key, label, system) values (%L, 'x1', 'X', true)$$, :'oa'));
select g7.denies('type keys are unique per organization', format($$insert into public.task_types (organization_id, key, label) values (%L, 'sopralluogo', 'Doppio')$$, :'oa'));
select g7.denies('types cannot be deleted', $$delete from public.task_types where key = 'sopralluogo'$$);
update public.task_types set active = false, label = 'Sopralluogo tecnico' where key = 'sopralluogo';
select g7.check('deactivated and renamed', (select not active and label = 'Sopralluogo tecnico' from public.task_types where key = 'sopralluogo'));
select g7.denies('the key cannot be changed', $$update public.task_types set key = 'altro2' where key = 'sopralluogo'$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
select g7.denies('a member cannot add types', format($$insert into public.task_types (organization_id, key, label) values (%L, 'm1', 'M')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b7000000-0000-0000-0000-00000000000b';
select g7.check('another organization does not see our types', (select count(*) from public.task_types where key = 'sopralluogo') = 0);
reset role;

-- ---------------------------------------------------------------- attività: nuovi campi e controlli
select id as foreign_type from public.task_types where organization_id = :'ob' limit 1 \gset
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
insert into public.tasks (id, organization_id, title, customer_id, contact_id, duration_minutes, due_at, due_has_time, created_by, assignee_id)
  values ('a7e00000-0000-0000-0000-000000000001', :'oa', 'Preparare offerta', 'a7c00000-0000-0000-0000-000000000001', 'a7d00000-0000-0000-0000-000000000001', 45, now() + interval '2 days', true,
          'a7000000-0000-0000-0000-0000000000a2', 'a7000000-0000-0000-0000-0000000000a2');
select g7.check('default type is "generic"', (select y.key from public.tasks t join public.task_types y on y.id = t.type_id where t.id = 'a7e00000-0000-0000-0000-000000000001') = 'generic');
select g7.denies('a contact of another customer is rejected', format($$insert into public.tasks (organization_id, title, customer_id, contact_id, created_by) values (%L, 'x', 'a7c00000-0000-0000-0000-000000000001', 'a7d00000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('a contact without a customer is rejected', format($$insert into public.tasks (organization_id, title, contact_id, created_by) values (%L, 'x', 'a7d00000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('duration must be positive', $$update public.tasks set duration_minutes = 0 where id = 'a7e00000-0000-0000-0000-000000000001'$$);
select g7.denies('a type of another organization is rejected (composite FK)', format($$update public.tasks set type_id = %L where id = 'a7e00000-0000-0000-0000-000000000001'$$, :'foreign_type'));
reset role;

-- ---------------------------------------------------------------- appuntamenti
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
insert into public.appointments (id, organization_id, title, customer_id, contact_id, starts_at, ends_at, location, assignee_id, created_by)
  values ('a7a00000-0000-0000-0000-000000000001', :'oa', 'Sopralluogo', 'a7c00000-0000-0000-0000-000000000001', 'a7d00000-0000-0000-0000-000000000001',
          date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '31 hours', 'Via Roma 1', 'a7000000-0000-0000-0000-0000000000a2', 'a7000000-0000-0000-0000-0000000000a2');
select g7.check('a member creates an appointment', (select count(*) from public.appointments) = 1);
select g7.denies('end must follow start', format($$insert into public.appointments (organization_id, title, starts_at, ends_at, created_by) values (%L, 'x', now(), now(), 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('longer than 24 hours is rejected', format($$insert into public.appointments (organization_id, title, starts_at, ends_at, created_by) values (%L, 'x', now(), now() + interval '25 hours', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('assignee must belong to the organization', format($$insert into public.appointments (organization_id, title, starts_at, ends_at, assignee_id, created_by) values (%L, 'x', now(), now() + interval '1 hour', 'b7000000-0000-0000-0000-00000000000b', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('contact must belong to the customer', format($$insert into public.appointments (organization_id, title, customer_id, contact_id, starts_at, ends_at, created_by) values (%L, 'x', 'a7c00000-0000-0000-0000-000000000001', 'a7d00000-0000-0000-0000-000000000002', now(), now() + interval '1 hour', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('a customer of another organization is rejected (composite FK)', format($$insert into public.appointments (organization_id, title, customer_id, starts_at, ends_at, created_by) values (%L, 'x', 'b7c00000-0000-0000-0000-000000000001', now(), now() + interval '1 hour', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
insert into public.appointment_participants (appointment_id, organization_id, user_id) values ('a7a00000-0000-0000-0000-000000000001', :'oa', 'a7000000-0000-0000-0000-00000000000a');
select g7.denies('a participant must belong to the organization', format($$insert into public.appointment_participants (appointment_id, organization_id, user_id) values ('a7a00000-0000-0000-0000-000000000001', %L, 'b7000000-0000-0000-0000-00000000000b')$$, :'oa'));
insert into public.reminders (organization_id, appointment_id, remind_at, offset_minutes, channel)
  select organization_id, id, starts_at - interval '60 minutes', 60, 'in_app' from public.appointments where id = 'a7a00000-0000-0000-0000-000000000001';
select g7.denies('a reminder needs exactly one target', format($$insert into public.reminders (organization_id, remind_at, channel) values (%L, now(), 'in_app')$$, :'oa'));
update public.appointments set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = 'a7a00000-0000-0000-0000-000000000001';
select g7.check('the reminder follows the new start time (offset kept)', (select r.remind_at = a.starts_at - interval '60 minutes' from public.reminders r join public.appointments a on a.id = r.appointment_id));
select g7.check('timeline: created and rescheduled', (select count(*) from public.activity_events where entity = 'appointment' and event = 'created') = 1 and (select count(*) from public.activity_events where entity = 'appointment' and event = 'rescheduled') = 1);
select g7.check('customer timeline carries the appointment', (select count(*) from public.activity_events where customer_id = 'a7c00000-0000-0000-0000-000000000001' and entity = 'appointment') = 2);
update public.appointments set status = 'cancelled' where id = 'a7a00000-0000-0000-0000-000000000001';
select g7.check('cancelling stamps the date and cancels pending reminders', (select status_changed_at is not null from public.appointments) and (select status from public.reminders) = 'cancelled');
update public.appointments set status = 'scheduled' where id = 'a7a00000-0000-0000-0000-000000000001';
update public.appointments set status = 'completed' where id = 'a7a00000-0000-0000-0000-000000000001';
select g7.check('completed event in the timeline', (select count(*) from public.activity_events where entity = 'appointment' and event = 'completed') = 1);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a3';
select g7.denies('a viewer cannot create appointments', format($$insert into public.appointments (organization_id, title, starts_at, ends_at, created_by) values (%L, 'x', now(), now() + interval '1 hour', 'a7000000-0000-0000-0000-0000000000a3')$$, :'oa'));
select g7.check('a viewer can read them', (select count(*) from public.appointments) = 1);
select g7.check('a viewer cannot update them', g7.affected($$update public.appointments set title = 'hack'$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b7000000-0000-0000-0000-00000000000b';
select g7.check('another organization sees nothing of ours', (select count(*) from public.appointments) = 0 and (select count(*) from public.appointment_participants) = 0);
select g7.check('…and cannot touch it', g7.affected($$update public.appointments set title = 'hack'$$) = 0);
reset role;

-- ---------------------------------------------------------------- chiamate
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
select public.log_call(:'oa', 'a7c00000-0000-0000-0000-000000000001', 'a7d00000-0000-0000-0000-000000000001', 'outbound', null, now() - interval '5 minutes', 300, 'callback', 'Richiamare giovedì', current_date + 3, 'a7000000-0000-0000-0000-00000000000a', null)::text as r1 \gset
select g7.check('log_call creates the call and a scheduled follow-up linked to it', (select count(*) from public.call_logs) = 1
  and (select f.status = 'scheduled' and f.source_call_id = c.id and c.follow_up_id = f.id and f.assignee_id = 'a7000000-0000-0000-0000-00000000000a' from public.follow_ups f join public.call_logs c on c.id = f.source_call_id));
select g7.check('call is attributed to the caller by default', (select user_id = 'a7000000-0000-0000-0000-0000000000a2' from public.call_logs));
select g7.check('timeline records the call', (select count(*) from public.activity_events where entity = 'call' and summary like 'Chiamata in uscita: da richiamare') = 1);
select public.log_call(:'oa', 'a7c00000-0000-0000-0000-000000000001', null, 'inbound', null, now(), null, 'answered', 'Info', null, null, null);
select g7.check('without a next contact no follow-up is created', (select count(*) from public.follow_ups) = 1 and (select count(*) from public.call_logs) = 2);
select g7.denies('invalid outcome rejected', $$select public.log_call((select id from public.organizations where name = 'Alfa'), 'a7c00000-0000-0000-0000-000000000001', null, 'inbound', null, now(), null, 'boh', null)$$);
select g7.denies('a call in the future is rejected', $$select public.log_call((select id from public.organizations where name = 'Alfa'), 'a7c00000-0000-0000-0000-000000000001', null, 'inbound', null, now() + interval '2 days', null, 'answered', null)$$);
select g7.denies('negative duration rejected', $$select public.log_call((select id from public.organizations where name = 'Alfa'), 'a7c00000-0000-0000-0000-000000000001', null, 'inbound', null, now(), -5, 'answered', null)$$);
select g7.denies('a call attributed to a foreign user is rejected', $$select public.log_call((select id from public.organizations where name = 'Alfa'), 'a7c00000-0000-0000-0000-000000000001', null, 'inbound', 'b7000000-0000-0000-0000-00000000000b', now(), null, 'answered', null)$$);
select g7.denies('a customer of another organization is rejected', $$select public.log_call((select id from public.organizations where name = 'Alfa'), 'b7c00000-0000-0000-0000-000000000001', null, 'inbound', null, now(), null, 'answered', null)$$);
select g7.check('a member cannot delete calls', g7.affected($$delete from public.call_logs$$) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a3';
select g7.denies('a viewer cannot log calls', format($$select public.log_call(%L, 'a7c00000-0000-0000-0000-000000000001', null, 'inbound', null, now(), null, 'answered', null)$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b7000000-0000-0000-0000-00000000000b';
select g7.check('another organization sees no calls or follow-ups', (select count(*) from public.call_logs) = 0 and (select count(*) from public.follow_ups) = 0);
select g7.denies('another organization cannot log a call on our customer', format($$select public.log_call(%L, 'a7c00000-0000-0000-0000-000000000001', null, 'inbound', null, now(), null, 'answered', null)$$, :'oa'));
reset role;

-- ---------------------------------------------------------------- follow-up: sei stati, transizioni, cronologia
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
insert into public.follow_ups (id, organization_id, customer_id, contact_id, title, reason, due_on, assignee_id, priority, created_by)
  values ('a7f00000-0000-0000-0000-000000000001', :'oa', 'a7c00000-0000-0000-0000-000000000001', 'a7d00000-0000-0000-0000-000000000001', 'Sentire se ha deciso', 'Dopo il preventivo', current_date - 2,
          'a7000000-0000-0000-0000-0000000000a2', 'high', 'a7000000-0000-0000-0000-0000000000a2');
select g7.check('new follow-up starts "todo" and the history records its creation', (select status = 'todo' from public.follow_ups where id = 'a7f00000-0000-0000-0000-000000000001')
  and (select count(*) from public.follow_up_events where follow_up_id = 'a7f00000-0000-0000-0000-000000000001' and event = 'created') = 1);
select g7.denies('there are exactly six states', $$update public.follow_ups set status = 'sospeso' where id = 'a7f00000-0000-0000-0000-000000000001'$$);
select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'in_progress', 'Ho chiamato, linea occupata');
select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'waiting', 'Attendo risposta del cliente');
select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'scheduled', null);
select g7.check('status changes are recorded with their note', (select count(*) from public.follow_up_events where follow_up_id = 'a7f00000-0000-0000-0000-000000000001' and event = 'status') = 3
  and (select note from public.follow_up_events where to_status = 'waiting') = 'Attendo risposta del cliente');
select public.reschedule_follow_up('a7f00000-0000-0000-0000-000000000001', current_date + 7, 'Il cliente è in ferie');
select g7.check('rescheduling keeps the previous date in the history', (select from_due = current_date - 2 and to_due = current_date + 7 and note = 'Il cliente è in ferie' from public.follow_up_events where event = 'rescheduled'));
select g7.check('the note is not carried over to the next change', (select count(*) from public.follow_up_events where event = 'status' and note is not null) = 2);
select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'done', 'Concluso');
select g7.check('completing stamps the date and keeps all the history', (select completed_at is not null from public.follow_ups where id = 'a7f00000-0000-0000-0000-000000000001')
  and (select count(*) from public.follow_up_events where follow_up_id = 'a7f00000-0000-0000-0000-000000000001') = 6);
select g7.denies('a closed follow-up cannot go back to in progress', $$select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'in_progress')$$);
select g7.denies('a closed follow-up cannot go to waiting', $$select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'waiting')$$);
select g7.denies('a closed follow-up cannot be rescheduled', $$select public.reschedule_follow_up('a7f00000-0000-0000-0000-000000000001', current_date + 9, 'x')$$);
select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'todo', 'Riaperto');
select g7.check('reopening clears the completion date', (select completed_at is null and status = 'todo' from public.follow_ups where id = 'a7f00000-0000-0000-0000-000000000001'));
select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'cancelled', 'Non serve più');
select g7.check('cancelled is closed and does not complete', (select completed_at is null and status = 'cancelled' from public.follow_ups where id = 'a7f00000-0000-0000-0000-000000000001'));
select g7.check('history survives cancellation', (select count(*) from public.follow_up_events where follow_up_id = 'a7f00000-0000-0000-0000-000000000001') >= 8);
select g7.check('timeline shows the reschedule with both dates', (select count(*) from public.activity_events where entity = 'follow_up' and event = 'rescheduled' and summary like '%riprogrammato dal%al%') = 1);
select g7.denies('history cannot be forged', format($$insert into public.follow_up_events (organization_id, follow_up_id, event) values (%L, 'a7f00000-0000-0000-0000-000000000001', 'status')$$, :'oa'));
select g7.denies('history cannot be edited', $$update public.follow_up_events set note = 'x'$$);
select g7.denies('history cannot be deleted', $$delete from public.follow_up_events$$);
select g7.denies('the customer column cannot be updated', $$update public.follow_ups set customer_id = 'a7c00000-0000-0000-0000-000000000002' where id = 'a7f00000-0000-0000-0000-000000000001'$$);
select g7.check('the customer is unchanged', (select customer_id = 'a7c00000-0000-0000-0000-000000000001' from public.follow_ups where id = 'a7f00000-0000-0000-0000-000000000001'));
select g7.denies('a contact of another customer is rejected', $$update public.follow_ups set contact_id = 'a7d00000-0000-0000-0000-000000000002' where id = 'a7f00000-0000-0000-0000-000000000001'$$);
select g7.denies('an assignee outside the organization is rejected', $$update public.follow_ups set assignee_id = 'b7000000-0000-0000-0000-00000000000b' where id = 'a7f00000-0000-0000-0000-000000000001'$$);
select g7.denies('a quote of another customer is rejected', format($$insert into public.follow_ups (organization_id, customer_id, quote_id, title, due_on, created_by) values (%L, 'a7c00000-0000-0000-0000-000000000002', gen_random_uuid(), 'x', current_date, 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a3';
select g7.denies('a viewer cannot create follow-ups', format($$insert into public.follow_ups (organization_id, customer_id, title, due_on, created_by) values (%L, 'a7c00000-0000-0000-0000-000000000001', 'x', current_date, 'a7000000-0000-0000-0000-0000000000a3')$$, :'oa'));
select g7.denies('a viewer cannot change a status', $$select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'todo')$$);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b7000000-0000-0000-0000-00000000000b';
select g7.denies('another organization cannot change our follow-up', $$select public.set_follow_up_status('a7f00000-0000-0000-0000-000000000001', 'todo')$$);
select g7.check('another organization sees no history', (select count(*) from public.follow_up_events) = 0);
reset role;

-- ---------------------------------------------------------------- clienti archiviati
update public.customers set archived_at = now() where id = 'a7c00000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
select g7.denies('no new appointment for an archived customer', format($$insert into public.appointments (organization_id, title, customer_id, starts_at, ends_at, created_by) values (%L, 'x', 'a7c00000-0000-0000-0000-000000000002', now(), now() + interval '1 hour', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('no new follow-up for an archived customer', format($$insert into public.follow_ups (organization_id, customer_id, title, due_on, created_by) values (%L, 'a7c00000-0000-0000-0000-000000000002', 'x', current_date, 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('no new task for an archived customer', format($$insert into public.tasks (organization_id, title, customer_id, created_by) values (%L, 'x', 'a7c00000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-0000000000a2')$$, :'oa'));
select g7.denies('no call logged for an archived customer', format($$select public.log_call(%L, 'a7c00000-0000-0000-0000-000000000002', null, 'inbound', null, now(), null, 'answered', null)$$, :'oa'));
select g7.check('existing records of archived customers stay readable and linked', (select count(*) from public.follow_ups where customer_id = 'a7c00000-0000-0000-0000-000000000001') >= 1);
reset role;
update public.customers set archived_at = null where id = 'a7c00000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- vista agenda
insert into public.follow_ups (organization_id, customer_id, title, due_on, status, created_by) values (:'oa', 'a7c00000-0000-0000-0000-000000000001', 'Follow-up aperto', current_date, 'todo', 'a7000000-0000-0000-0000-00000000000a');
insert into public.appointments (organization_id, title, customer_id, starts_at, ends_at, created_by) values (:'oa', 'Visita in cantiere', 'a7c00000-0000-0000-0000-000000000001', now() + interval '3 hours', now() + interval '4 hours', 'a7000000-0000-0000-0000-00000000000a');
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
select g7.check('agenda unifies tasks, follow-ups and appointments from the real tables',
  (select array_agg(distinct kind order by kind) from public.agenda_items) = array['appointment', 'follow_up', 'task']);
select g7.check('cancelled items are not in the agenda', (select count(*) from public.agenda_items where title = 'Sentire se ha deciso') = 0);
select g7.check('open and done flags follow the module states', (select is_open from public.agenda_items where title = 'Follow-up aperto') and (select is_done from public.agenda_items where title = 'Sopralluogo'));
select g7.check('customer name is carried', (select customer_name from public.agenda_items where title = 'Visita in cantiere') = 'Cliente Uno');
select g7.check('every item has a link', (select count(*) from public.agenda_items where href is null) = 0);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'b7000000-0000-0000-0000-00000000000b';
select g7.check('another organization sees an empty agenda', (select count(*) from public.agenda_items) = 0);
reset role;

-- ---------------------------------------------------------------- notifiche
update public.profiles set preferences = '{}' where id = 'a7000000-0000-0000-0000-00000000000a';
insert into public.reminders (organization_id, appointment_id, remind_at, offset_minutes, channel)
  select organization_id, id, now() - interval '1 minute', 0, 'in_app' from public.appointments where title = 'Visita in cantiere';
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-00000000000a';
select public.refresh_my_notifications() as n1 \gset
select g7.check('owner is notified of: due follow-up, imminent appointment, appointment reminder', (select count(*) from public.notifications where kind = 'followup_due') = 1
  and (select count(*) from public.notifications where kind = 'appointment_soon') = 1 and (select count(*) from public.notifications where kind = 'reminder') = 1);
select g7.check('notifications are idempotent', public.refresh_my_notifications() = 0);
select g7.check('the appointment reminder is marked as sent', (select status from public.reminders where appointment_id is not null and status <> 'cancelled') = 'sent');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000a2';
select g7.check('a member sees only the notifications of their own items', (select count(*) from public.notifications) = 0);
reset role;
delete from public.notifications;
update public.profiles set preferences = '{"notifications":{"followup":false,"appointment":false,"reminder":false}}' where id = 'a7000000-0000-0000-0000-00000000000a';
update public.reminders set status = 'pending' where appointment_id is not null and status = 'sent';
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-00000000000a';
select g7.check('disabled kinds produce no notification', (select count(*) from public.notifications where kind in ('followup_due', 'appointment_soon', 'reminder')) = 0 and public.refresh_my_notifications() = 0);
reset role;

-- ---------------------------------------------------------------- eliminazione cliente e ultimo contatto
set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-0000-0000-00000000000a';
select g7.check('blockers list the new linked data', (public.customer_delete_blockers('a7c00000-0000-0000-0000-000000000001') ->> 'appointments')::int >= 1
  and (public.customer_delete_blockers('a7c00000-0000-0000-0000-000000000001') ->> 'calls')::int = 2
  and (public.customer_delete_blockers('a7c00000-0000-0000-0000-000000000001') ->> 'follow_ups')::int >= 1);
update public.customers set archived_at = now() where id = 'a7c00000-0000-0000-0000-000000000001';
select g7.denies('a customer with calls, appointments and follow-ups cannot be deleted', $$select public.delete_customer_permanently('a7c00000-0000-0000-0000-000000000001')$$);
update public.customers set archived_at = null where id = 'a7c00000-0000-0000-0000-000000000001';
select g7.check('last contact now considers the logged calls', (public.customer_commercial_summary('a7c00000-0000-0000-0000-000000000001') ->> 'last_contact_at') is not null);
reset role;
select g7.check('every table still has RLS', (
  select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity));
rollback;
\echo AGENDA TESTS PASSED
