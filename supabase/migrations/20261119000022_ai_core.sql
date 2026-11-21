-- NEXORA 2.0 – 22 AI Core: crediti con prenotazione/contabilizzazione, azioni proposte con esecuzione tracciata,
-- insight proattivi, metadati delle conversazioni. Migrazione ADDITIVA: nessun dato esistente viene modificato o eliminato.
-- Principio: il modello non scrive mai nel database. Ogni scrittura passa da funzioni del service_role o da azioni server dell'utente.

-- ============================================================ 1. crediti AI
-- Prezzi (micro-euro per milione di token) configurabili dal gestore della piattaforma: NULL = costo non calcolabile.
alter table public.ai_quotas
  add column input_price_micro_per_mtok bigint check (input_price_micro_per_mtok is null or input_price_micro_per_mtok between 0 and 1000000000000),
  add column output_price_micro_per_mtok bigint check (output_price_micro_per_mtok is null or output_price_micro_per_mtok between 0 and 1000000000000);

alter table public.ai_usage
  add column reservation_id uuid,
  add column status text not null default 'completed' check (status in ('completed', 'failed', 'cancelled')),
  add column tokens_source text not null default 'provider' check (tokens_source in ('provider', 'estimated')),
  add column cost_source text not null default 'none' check (cost_source in ('none', 'estimated')),
  add column error_kind text check (char_length(coalesce(error_kind, '')) <= 60);
create unique index ai_usage_reservation_uniq on public.ai_usage (reservation_id) where reservation_id is not null;

-- Prenotazioni: una riga per richiesta. Stato 'reserved' (token trattenuti) -> 'settled' (consumo reale) oppure 'released' (rimborsati).
create table public.ai_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  feature text not null check (char_length(feature) between 1 and 60),
  request_key text not null check (char_length(request_key) between 8 and 120),
  period_start date not null,
  reserved_tokens bigint not null check (reserved_tokens > 0),
  actual_tokens bigint check (actual_tokens is null or actual_tokens >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id, request_key)
);
create index ai_reservations_open_idx on public.ai_reservations (organization_id, created_at) where status = 'reserved';
alter table public.ai_reservations enable row level security;
-- nessuna policy per gli utenti: la tabella è gestita soltanto dalle funzioni del service_role
revoke all on public.ai_reservations from public, anon, authenticated;

create trigger ai_reservations_org_immutable before update on public.ai_reservations for each row execute function private.prevent_org_change();

-- Prenota token in modo atomico (riga della quota bloccata): richieste concorrenti non possono superare il limite.
-- Idempotente sulla chiave della richiesta: la stessa chiave non prenota due volte.
create function private.ai_reserve(p_org uuid, p_user uuid, p_feature text, p_key text, p_tokens bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.ai_quotas;
  r public.ai_reservations;
  v_period date := date_trunc('month', current_date)::date;
  v_id uuid;
begin
  if p_tokens is null or p_tokens <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into q from public.ai_quotas where organization_id = p_org for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_quota'); end if;

  -- rimborso automatico delle prenotazioni abbandonate (richiesta interrotta, processo terminato) da oltre 10 minuti
  for r in select * from public.ai_reservations where organization_id = p_org and status = 'reserved' and created_at < now() - interval '10 minutes' for update loop
    if r.period_start = q.period_start then
      update public.ai_quotas set tokens_used = greatest(0, tokens_used - r.reserved_tokens) where organization_id = p_org;
      q.tokens_used := greatest(0, q.tokens_used - r.reserved_tokens);
    end if;
    update public.ai_reservations set status = 'released', closed_at = now() where id = r.id;
    insert into public.ai_usage (organization_id, user_id, feature, provider, model, status, reservation_id, error_kind)
    values (r.organization_id, r.user_id, r.feature, 'n/d', 'n/d', 'cancelled', r.id, 'abandoned');
  end loop;

  select * into r from public.ai_reservations where organization_id = p_org and request_key = p_key;
  if found then return jsonb_build_object('ok', true, 'id', r.id, 'duplicate', true, 'status', r.status); end if;

  if q.period_start < v_period then
    update public.ai_quotas set period_start = v_period, tokens_used = 0, updated_at = now() where organization_id = p_org;
    q.period_start := v_period; q.tokens_used := 0;
  end if;
  if q.tokens_used + p_tokens > q.monthly_token_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'used', q.tokens_used, 'limit', q.monthly_token_limit);
  end if;
  update public.ai_quotas set tokens_used = tokens_used + p_tokens, updated_at = now() where organization_id = p_org;
  insert into public.ai_reservations (organization_id, user_id, feature, request_key, period_start, reserved_tokens)
  values (p_org, p_user, p_feature, p_key, q.period_start, p_tokens) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false, 'status', 'reserved');
end $$;

-- Contabilizza il consumo reale: sostituisce la stima con i token effettivi. Una sola volta per prenotazione (nessun doppio addebito).
create function private.ai_settle(p_id uuid, p_input bigint, p_output bigint, p_provider text, p_model text, p_tokens_estimated boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r public.ai_reservations;
  q public.ai_quotas;
  v_actual bigint := greatest(0, coalesce(p_input, 0)) + greatest(0, coalesce(p_output, 0));
  v_cost bigint := 0;
  v_src text := 'none';
begin
  select * into r from public.ai_reservations where id = p_id for update;
  if not found or r.status <> 'reserved' then return false; end if;
  select * into q from public.ai_quotas where organization_id = r.organization_id for update;
  if r.period_start = q.period_start then
    update public.ai_quotas set tokens_used = greatest(0, tokens_used - r.reserved_tokens + v_actual), updated_at = now() where organization_id = r.organization_id;
  end if;
  if q.input_price_micro_per_mtok is not null and q.output_price_micro_per_mtok is not null then
    v_cost := round((greatest(0, coalesce(p_input, 0)) * q.input_price_micro_per_mtok + greatest(0, coalesce(p_output, 0)) * q.output_price_micro_per_mtok) / 1000000.0);
    v_src := 'estimated';
  end if;
  update public.ai_reservations set status = 'settled', actual_tokens = v_actual, closed_at = now() where id = p_id;
  insert into public.ai_usage (organization_id, user_id, feature, provider, model, input_tokens, output_tokens, cost_micro_eur, status, reservation_id, tokens_source, cost_source)
  values (r.organization_id, r.user_id, r.feature, left(p_provider, 40), left(p_model, 80), least(greatest(0, coalesce(p_input, 0)), 2147483647), least(greatest(0, coalesce(p_output, 0)), 2147483647), v_cost, 'completed', r.id,
          case when p_tokens_estimated then 'estimated' else 'provider' end, v_src);
  return true;
end $$;

-- Rilascia una prenotazione (richiesta fallita o interrotta): i token trattenuti tornano disponibili e nessun consumo viene addebitato.
create function private.ai_release(p_id uuid, p_error_kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r public.ai_reservations;
  q public.ai_quotas;
begin
  select * into r from public.ai_reservations where id = p_id for update;
  if not found or r.status <> 'reserved' then return false; end if;
  select * into q from public.ai_quotas where organization_id = r.organization_id for update;
  if r.period_start = q.period_start then
    update public.ai_quotas set tokens_used = greatest(0, tokens_used - r.reserved_tokens), updated_at = now() where organization_id = r.organization_id;
  end if;
  update public.ai_reservations set status = 'released', actual_tokens = 0, closed_at = now() where id = p_id;
  insert into public.ai_usage (organization_id, user_id, feature, provider, model, status, reservation_id, error_kind)
  values (r.organization_id, r.user_id, r.feature, 'n/d', 'n/d', 'failed', r.id, left(coalesce(p_error_kind, 'error'), 60));
  return true;
end $$;

create function public.rpc_ai_reserve(p_org uuid, p_user uuid, p_feature text, p_key text, p_tokens bigint) returns jsonb
language sql set search_path = '' as $$ select private.ai_reserve(p_org, p_user, p_feature, p_key, p_tokens); $$;
create function public.rpc_ai_settle(p_id uuid, p_input bigint, p_output bigint, p_provider text, p_model text, p_tokens_estimated boolean) returns boolean
language sql set search_path = '' as $$ select private.ai_settle(p_id, p_input, p_output, p_provider, p_model, p_tokens_estimated); $$;
create function public.rpc_ai_release(p_id uuid, p_error_kind text) returns boolean
language sql set search_path = '' as $$ select private.ai_release(p_id, p_error_kind); $$;

revoke all on function private.ai_reserve(uuid, uuid, text, text, bigint), private.ai_settle(uuid, bigint, bigint, text, text, boolean), private.ai_release(uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_ai_reserve(uuid, uuid, text, text, bigint), public.rpc_ai_settle(uuid, bigint, bigint, text, text, boolean), public.rpc_ai_release(uuid, text) from public, anon, authenticated;
grant execute on function private.ai_reserve(uuid, uuid, text, text, bigint), private.ai_settle(uuid, bigint, bigint, text, text, boolean), private.ai_release(uuid, text) to service_role;
grant execute on function public.rpc_ai_reserve(uuid, uuid, text, text, bigint), public.rpc_ai_settle(uuid, bigint, bigint, text, text, boolean), public.rpc_ai_release(uuid, text) to service_role;

-- ============================================================ 2. conversazioni: fonti e contesto
alter table public.ai_conversations add column page_context jsonb check (page_context is null or (jsonb_typeof(page_context) = 'object' and pg_column_size(page_context) < 2000));
alter table public.ai_messages add column sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) < 20000);

-- ============================================================ 3. azioni proposte (estensione di ai_suggestions)
alter table public.ai_suggestions drop constraint ai_suggestions_kind_check;
alter table public.ai_suggestions add constraint ai_suggestions_kind_check
  check (kind in ('quote_item', 'quote_text', 'task', 'customer_update', 'insight', 'quote_draft',
                  'quote_followup', 'customer_followup', 'customer_note', 'price_review',
                  'follow_up', 'email_draft', 'appointment', 'catalog_update', 'quote_update'));
alter table public.ai_suggestions
  add column description text check (char_length(coalesce(description, '')) <= 600),
  add column conversation_id uuid,
  add column execution_status text not null default 'not_run' check (execution_status in ('not_run', 'running', 'done', 'failed')),
  add column execution_result jsonb check (execution_result is null or pg_column_size(execution_result) < 4000),
  add column executed_at timestamptz,
  add column executed_by uuid references auth.users (id) on delete set null,
  add column attempts int not null default 0;
alter table public.ai_suggestions add foreign key (conversation_id, organization_id) references public.ai_conversations (id, organization_id) on delete set null (conversation_id);
create index ai_suggestions_conv_idx on public.ai_suggestions (organization_id, conversation_id) where conversation_id is not null;

-- la decisione resta tracciata anche quando l'esecuzione avviene tramite funzione del service_role (auth.uid() nullo)
create or replace function private.ai_suggestions_decide() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'suggestion already decided' using errcode = '23514';
    end if;
    if new.status = 'rejected' and old.execution_status <> 'not_run' then
      raise exception 'suggestion is being executed' using errcode = '23514';
    end if;
    new.decided_by := coalesce((select auth.uid()), new.decided_by);
    new.decided_at := now();
  end if;
  return new;
end $$;

-- Prenota l'esecuzione di un'azione: una sola esecuzione alla volta, mai due volte (doppia conferma/click concorrenti).
-- Ritorna la riga solo a chi vince la prenotazione. Una proposta fallita si può ritentare; una completata, mai.
-- Un'esecuzione rimasta «in corso» da oltre 5 minuti (processo interrotto) può essere ripresa: gli esecutori evitano i duplicati.
create function private.ai_claim_action(p_org uuid, p_id uuid, p_user uuid) returns public.ai_suggestions
language plpgsql security definer set search_path = '' as $$
declare s public.ai_suggestions;
begin
  update public.ai_suggestions set execution_status = 'running', attempts = attempts + 1
   where id = p_id and organization_id = p_org and status = 'pending'
     and (execution_status in ('not_run', 'failed') or (execution_status = 'running' and updated_at < now() - interval '5 minutes'))
   returning * into s;
  return s;
end $$;

create function private.ai_finish_action(p_org uuid, p_id uuid, p_user uuid, p_ok boolean, p_result jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.ai_suggestions set execution_status = 'done', execution_result = p_result, executed_at = now(), executed_by = p_user, decided_by = p_user, status = 'accepted'
     where id = p_id and organization_id = p_org and execution_status = 'running';
  else
    update public.ai_suggestions set execution_status = 'failed', execution_result = p_result, executed_at = now(), executed_by = p_user
     where id = p_id and organization_id = p_org and execution_status = 'running';
  end if;
  return found;
end $$;

create function public.rpc_ai_claim_action(p_org uuid, p_id uuid, p_user uuid) returns public.ai_suggestions
language sql set search_path = '' as $$ select * from private.ai_claim_action(p_org, p_id, p_user); $$;
create function public.rpc_ai_finish_action(p_org uuid, p_id uuid, p_user uuid, p_ok boolean, p_result jsonb) returns boolean
language sql set search_path = '' as $$ select private.ai_finish_action(p_org, p_id, p_user, p_ok, p_result); $$;
revoke all on function private.ai_claim_action(uuid, uuid, uuid), private.ai_finish_action(uuid, uuid, uuid, boolean, jsonb),
  public.rpc_ai_claim_action(uuid, uuid, uuid), public.rpc_ai_finish_action(uuid, uuid, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function private.ai_claim_action(uuid, uuid, uuid), private.ai_finish_action(uuid, uuid, uuid, boolean, jsonb),
  public.rpc_ai_claim_action(uuid, uuid, uuid), public.rpc_ai_finish_action(uuid, uuid, uuid, boolean, jsonb) to service_role;

-- ============================================================ 4. insight proattivi
create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  dedupe_key text not null check (char_length(dedupe_key) between 3 and 200),
  rule text not null check (char_length(rule) between 1 and 60),
  category text not null check (category in ('opportunity', 'attention', 'analysis')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) <= 800),
  reason text not null check (char_length(reason) <= 800),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) < 8000),
  action_label text check (char_length(coalesce(action_label, '')) <= 80),
  action_href text check (action_href is null or (action_href ~ '^/[A-Za-z0-9/_?=&.%-]*$' and char_length(action_href) <= 300)),
  copilot_question text check (char_length(coalesce(copilot_question, '')) <= 500),
  status text not null default 'new' check (status in ('new', 'seen', 'done', 'dismissed')),
  generated_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users (id) on delete set null,
  unique (organization_id, dedupe_key)
);
create index ai_insights_active_idx on public.ai_insights (organization_id, expires_at desc, priority);
alter table public.ai_insights enable row level security;
create policy ai_insights_select on public.ai_insights for select to authenticated using (private.is_member(organization_id));
revoke all on public.ai_insights from public, anon, authenticated;
grant select on public.ai_insights to authenticated;
create trigger ai_insights_org_immutable before update on public.ai_insights for each row execute function private.prevent_org_change();

-- stato della generazione: serve a evitare rigenerazioni ravvicinate e concorrenti
create table public.ai_insight_state (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_run_at timestamptz not null default 'epoch',
  last_count int not null default 0
);
alter table public.ai_insight_state enable row level security;
revoke all on public.ai_insight_state from public, anon, authenticated;

-- Prenota una generazione (atomico): vero solo se l'ultima è più vecchia dell'intervallo richiesto.
create function private.ai_insights_claim(p_org uuid, p_min_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into public.ai_insight_state (organization_id) values (p_org) on conflict do nothing;
  update public.ai_insight_state set last_run_at = now()
   where organization_id = p_org and last_run_at <= now() - make_interval(secs => greatest(p_min_seconds, 0));
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- Sincronizza gli insight: aggiorna quelli ancora validi (senza perdere lo stato deciso dall'utente), crea i nuovi,
-- chiude (scadenza immediata) quelli la cui condizione non è più vera. Un insight chiuso che ricompare ritorna «nuovo».
create function private.ai_insights_sync(p_org uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  it jsonb;
  v_created int := 0; v_updated int := 0; v_closed int := 0; v_reopened int := 0;
  ex public.ai_insights;
  v_keys text[];
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'invalid items' using errcode = '22023'; end if;
  select coalesce(array_agg(e ->> 'dedupe_key'), '{}') into v_keys from jsonb_array_elements(p_items) e;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into ex from public.ai_insights where organization_id = p_org and dedupe_key = it ->> 'dedupe_key' for update;
    if not found then
      insert into public.ai_insights (organization_id, dedupe_key, rule, category, priority, title, description, reason, evidence, action_label, action_href, copilot_question, expires_at)
      values (p_org, it ->> 'dedupe_key', it ->> 'rule', it ->> 'category', coalesce(it ->> 'priority', 'normal'), it ->> 'title', it ->> 'description', it ->> 'reason',
              coalesce(it -> 'evidence', '[]'::jsonb), it ->> 'action_label', it ->> 'action_href', it ->> 'copilot_question', (it ->> 'expires_at')::timestamptz);
      v_created := v_created + 1;
    else
      update public.ai_insights set
        rule = it ->> 'rule', category = it ->> 'category', priority = coalesce(it ->> 'priority', 'normal'), title = it ->> 'title', description = it ->> 'description', reason = it ->> 'reason',
        evidence = coalesce(it -> 'evidence', '[]'::jsonb), action_label = it ->> 'action_label', action_href = it ->> 'action_href', copilot_question = it ->> 'copilot_question',
        refreshed_at = now(), expires_at = (it ->> 'expires_at')::timestamptz,
        status = case when ex.expires_at <= now() then 'new' else ex.status end,
        generated_at = case when ex.expires_at <= now() then now() else ex.generated_at end,
        status_changed_at = case when ex.expires_at <= now() then null else ex.status_changed_at end,
        status_changed_by = case when ex.expires_at <= now() then null else ex.status_changed_by end
       where id = ex.id;
      if ex.expires_at <= now() then v_reopened := v_reopened + 1; else v_updated := v_updated + 1; end if;
    end if;
  end loop;
  update public.ai_insights set expires_at = now() where organization_id = p_org and expires_at > now() and not (dedupe_key = any (v_keys));
  get diagnostics v_closed = row_count;
  update public.ai_insight_state set last_count = jsonb_array_length(p_items) where organization_id = p_org;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'reopened', v_reopened, 'closed', v_closed);
end $$;

create function private.ai_insight_set_status(p_org uuid, p_id uuid, p_status text, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('seen', 'done', 'dismissed', 'new') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.ai_insights set status = p_status, status_changed_at = now(), status_changed_by = p_user
   where id = p_id and organization_id = p_org and expires_at > now();
  return found;
end $$;

create function public.rpc_ai_insights_claim(p_org uuid, p_min_seconds int) returns boolean
language sql set search_path = '' as $$ select private.ai_insights_claim(p_org, p_min_seconds); $$;
create function public.rpc_ai_insights_sync(p_org uuid, p_items jsonb) returns jsonb
language sql set search_path = '' as $$ select private.ai_insights_sync(p_org, p_items); $$;
create function public.rpc_ai_insight_set_status(p_org uuid, p_id uuid, p_status text, p_user uuid) returns boolean
language sql set search_path = '' as $$ select private.ai_insight_set_status(p_org, p_id, p_status, p_user); $$;
revoke all on function private.ai_insights_claim(uuid, int), private.ai_insights_sync(uuid, jsonb), private.ai_insight_set_status(uuid, uuid, text, uuid),
  public.rpc_ai_insights_claim(uuid, int), public.rpc_ai_insights_sync(uuid, jsonb), public.rpc_ai_insight_set_status(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function private.ai_insights_claim(uuid, int), private.ai_insights_sync(uuid, jsonb), private.ai_insight_set_status(uuid, uuid, text, uuid),
  public.rpc_ai_insights_claim(uuid, int), public.rpc_ai_insights_sync(uuid, jsonb), public.rpc_ai_insight_set_status(uuid, uuid, text, uuid) to service_role;
