-- NEXORA 2.0 – 21 email: caselle collegate (Gmail, Outlook, IMAP/SMTP), messaggi, conversazioni, allegati, bozze, modelli,
-- collegamento al CRM. Solo aggiunte (più la sostituzione di customer_delete_blockers / delete_customer_permanently /
-- customer_commercial_summary per tenere conto delle email).
-- SEGRETI: token e password NON stanno nelle tabelle esposte ma in private.email_account_secrets, cifrati dall'applicazione
-- (AES-256-GCM) e raggiungibili solo dal service_role tramite funzioni dedicate.

-- ============================================================ 1. bucket privato per gli allegati (nessuna policy: solo il server vi accede)
insert into storage.buckets (id, name, public, file_size_limit)
values ('email-attachments', 'email-attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ============================================================ 2. caselle
create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook', 'imap_smtp')),
  address text not null check (char_length(address) <= 254 and address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text check (char_length(coalesce(display_name, '')) <= 120),
  status text not null default 'connected' check (status in ('connected', 'error', 'needs_reauth', 'disconnected')),
  status_detail text check (char_length(coalesce(status_detail, '')) <= 300),
  visibility text not null default 'restricted' check (visibility in ('shared', 'restricted')),
  is_default boolean not null default false,
  signature text check (char_length(coalesce(signature, '')) <= 2000),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 2000),
  sync_cursor jsonb not null default '{}'::jsonb check (jsonb_typeof(sync_cursor) = 'object' and pg_column_size(sync_cursor) < 20000),
  last_sync_at timestamptz,
  sync_started_at timestamptz,
  last_sync_error text check (char_length(coalesce(last_sync_error, '')) <= 300),
  sync_failures int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index email_accounts_address_uniq on public.email_accounts (organization_id, lower(address)) where disconnected_at is null;
create unique index email_accounts_default_uniq on public.email_accounts (organization_id) where is_default and disconnected_at is null;

create table public.email_account_members (
  account_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id),
  foreign key (account_id, organization_id) references public.email_accounts (id, organization_id) on delete cascade
);

-- segreti cifrati dall'applicazione: tabella nello schema "private" (non esposto), accessibile solo via funzioni del service_role
create table private.email_account_secrets (
  account_id uuid primary key references public.email_accounts (id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) between 20 and 20000),
  updated_at timestamptz not null default now()
);
alter table private.email_account_secrets enable row level security;
revoke all on private.email_account_secrets from public, anon, authenticated;

create function public.rpc_email_secret_set(p_account uuid, p_ciphertext text) returns void
language sql security definer set search_path = '' as $$
  insert into private.email_account_secrets (account_id, ciphertext) values (p_account, p_ciphertext)
  on conflict (account_id) do update set ciphertext = excluded.ciphertext, updated_at = now();
$$;
create function public.rpc_email_secret_get(p_account uuid) returns text
language sql stable security definer set search_path = '' as $$
  select ciphertext from private.email_account_secrets where account_id = p_account;
$$;
create function public.rpc_email_secret_delete(p_account uuid) returns void
language sql security definer set search_path = '' as $$
  delete from private.email_account_secrets where account_id = p_account;
$$;
revoke all on function public.rpc_email_secret_set(uuid, text), public.rpc_email_secret_get(uuid), public.rpc_email_secret_delete(uuid) from public, anon, authenticated;
grant execute on function public.rpc_email_secret_set(uuid, text), public.rpc_email_secret_get(uuid), public.rpc_email_secret_delete(uuid) to service_role;

-- blocco anti-concorrenza della sincronizzazione (atomico): vero solo per chi riesce a "prenotare" la casella
create function public.rpc_email_claim_sync(p_account uuid) returns boolean
language sql security definer set search_path = '' as $$
  with c as (
    update public.email_accounts set sync_started_at = now()
    where id = p_account and disconnected_at is null and (sync_started_at is null or sync_started_at < now() - interval '3 minutes')
    returning 1)
  select exists (select 1 from c);
$$;
revoke all on function public.rpc_email_claim_sync(uuid) from public, anon, authenticated;
grant execute on function public.rpc_email_claim_sync(uuid) to service_role;

-- chi può leggere/usare una casella: condivisa con l'organizzazione, oppure creatore, oppure collaboratore autorizzato
create function private.can_use_mailbox(p_account uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.email_accounts a
    where a.id = p_account and private.is_member(a.organization_id)
      and (a.visibility = 'shared' or a.created_by = (select auth.uid())
           or exists (select 1 from public.email_account_members m where m.account_id = a.id and m.user_id = (select auth.uid())))
  );
$$;
revoke all on function private.can_use_mailbox(uuid) from public, anon;
grant execute on function private.can_use_mailbox(uuid) to authenticated;

-- ============================================================ 3. conversazioni e messaggi
create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  provider_thread_id text,
  subject text not null default '' check (char_length(subject) <= 998),
  last_message_at timestamptz not null default now(),
  message_count int not null default 0,
  unread_count int not null default 0,
  customer_id uuid,
  contact_id uuid,
  quote_id uuid,
  task_id uuid,
  follow_up_id uuid,
  link_status text not null default 'none' check (link_status in ('none', 'auto', 'suggested', 'manual')),
  link_candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(link_candidates) = 'array' and jsonb_array_length(link_candidates) <= 20),
  linked_by uuid references auth.users (id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (account_id, organization_id) references public.email_accounts (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id),
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete set null (quote_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete set null (task_id),
  foreign key (follow_up_id, organization_id) references public.follow_ups (id, organization_id) on delete set null (follow_up_id)
);
create unique index email_threads_provider_uniq on public.email_threads (account_id, provider_thread_id) where provider_thread_id is not null;
create index email_threads_list_idx on public.email_threads (organization_id, account_id, last_message_at desc);
create index email_threads_customer_idx on public.email_threads (organization_id, customer_id, last_message_at desc);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  thread_id uuid not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  provider_message_id text,
  internet_message_id text check (char_length(coalesce(internet_message_id, '')) <= 998),
  in_reply_to text check (char_length(coalesce(in_reply_to, '')) <= 998),
  references_ids text[] not null default '{}' check (cardinality(references_ids) <= 100),
  from_address text not null check (char_length(from_address) <= 254),
  from_name text check (char_length(coalesce(from_name, '')) <= 200),
  to_addrs jsonb not null default '[]'::jsonb check (jsonb_typeof(to_addrs) = 'array' and jsonb_array_length(to_addrs) <= 200),
  cc_addrs jsonb not null default '[]'::jsonb check (jsonb_typeof(cc_addrs) = 'array' and jsonb_array_length(cc_addrs) <= 200),
  bcc_addrs jsonb not null default '[]'::jsonb check (jsonb_typeof(bcc_addrs) = 'array' and jsonb_array_length(bcc_addrs) <= 200),
  subject text not null default '' check (char_length(subject) <= 998),
  snippet text check (char_length(coalesce(snippet, '')) <= 400),
  body_text text check (char_length(coalesce(body_text, '')) <= 300000),
  body_html text check (char_length(coalesce(body_html, '')) <= 600000),
  message_at timestamptz not null default now(),
  status text not null check (status in ('received', 'sending', 'sent', 'failed')),
  error text check (char_length(coalesce(error, '')) <= 300),
  idempotency_key uuid,
  is_read boolean not null default false,
  has_attachments boolean not null default false,
  sent_by uuid references auth.users (id) on delete set null,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (thread_id, organization_id) references public.email_threads (id, organization_id) on delete cascade,
  foreign key (account_id, organization_id) references public.email_accounts (id, organization_id) on delete cascade,
  check ((direction = 'inbound' and status = 'received') or direction = 'outbound')
);
create unique index email_messages_provider_uniq on public.email_messages (account_id, provider_message_id) where provider_message_id is not null;
create unique index email_messages_idem_uniq on public.email_messages (organization_id, idempotency_key) where idempotency_key is not null;
create index email_messages_thread_idx on public.email_messages (organization_id, thread_id, message_at);
create index email_messages_rfc_idx on public.email_messages (account_id, internet_message_id) where internet_message_id is not null;
create index email_messages_inbox_idx on public.email_messages (organization_id, account_id, direction, message_at desc);

create table public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id uuid not null,
  filename text not null check (char_length(filename) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 150),
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  check (storage_path like organization_id::text || '/%'),
  foreign key (message_id, organization_id) references public.email_messages (id, organization_id) on delete cascade
);
create index email_attachments_msg_idx on public.email_attachments (organization_id, message_id);

-- bozze: private dell'autore
create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid,
  mode text not null default 'new' check (mode in ('new', 'reply', 'reply_all', 'forward')),
  thread_id uuid,
  reply_to_message_id uuid,
  customer_id uuid,
  quote_id uuid,
  to_addrs jsonb not null default '[]'::jsonb check (jsonb_typeof(to_addrs) = 'array' and jsonb_array_length(to_addrs) <= 200),
  cc_addrs jsonb not null default '[]'::jsonb check (jsonb_typeof(cc_addrs) = 'array' and jsonb_array_length(cc_addrs) <= 200),
  bcc_addrs jsonb not null default '[]'::jsonb check (jsonb_typeof(bcc_addrs) = 'array' and jsonb_array_length(bcc_addrs) <= 200),
  subject text not null default '' check (char_length(subject) <= 998),
  body_html text not null default '' check (char_length(body_html) <= 300000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 20),
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object' and pg_column_size(options) < 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, organization_id) references public.email_accounts (id, organization_id) on delete cascade,
  foreign key (thread_id, organization_id) references public.email_threads (id, organization_id) on delete set null (thread_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (quote_id, organization_id) references public.quotes (id, organization_id) on delete set null (quote_id)
);
create index email_drafts_author_idx on public.email_drafts (organization_id, author_id, updated_at desc);

-- modelli e firme
create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  subject text not null default '' check (char_length(subject) <= 300),
  body_html text not null default '' check (char_length(body_html) <= 20000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index email_templates_name_uniq on public.email_templates (organization_id, lower(name));
create table public.email_user_signatures (
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  signature text not null default '' check (char_length(signature) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create function private.seed_email_templates(p_org uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.email_templates (organization_id, name, subject, body_html) values
    (p_org, 'Primo contatto', 'Presentazione {{azienda}}', '<p>Buongiorno {{referente}},</p><p>mi presento: sono {{mittente}} di {{azienda}}. Vorrei capire se possiamo esservi utili e fissare una breve chiamata.</p><p>Resto a disposizione.</p>'),
    (p_org, 'Invio preventivo', 'Preventivo {{numero_preventivo}}', '<p>Buongiorno {{referente}},</p><p>in allegato trova il preventivo {{numero_preventivo}} come d''accordo. Per qualsiasi dubbio o modifica sono a disposizione.</p><p>Cordiali saluti</p>'),
    (p_org, 'Follow-up dopo preventivo', 'Preventivo {{numero_preventivo}}: ha avuto modo di vederlo?', '<p>Buongiorno {{referente}},</p><p>volevo sapere se ha avuto modo di valutare il preventivo {{numero_preventivo}} che le ho inviato. Se desidera chiarimenti o modifiche, ne parliamo volentieri.</p><p>Cordiali saluti</p>'),
    (p_org, 'Richiesta di informazioni', 'Richiesta di informazioni', '<p>Buongiorno {{referente}},</p><p>per preparare al meglio la nostra proposta avremmo bisogno di alcune informazioni: ...</p><p>Grazie per la collaborazione.</p>'),
    (p_org, 'Risposta a un cliente', 'Re: {{oggetto}}', '<p>Buongiorno {{referente}},</p><p>grazie per il messaggio. ...</p><p>Cordiali saluti</p>'),
    (p_org, 'Ringraziamento', 'Grazie', '<p>Buongiorno {{referente}},</p><p>la ringrazio per la fiducia accordata a {{azienda}}. Restiamo a disposizione per qualsiasi necessità.</p><p>Cordiali saluti</p>')
  on conflict do nothing;
$$;
revoke all on function private.seed_email_templates(uuid) from public, anon, authenticated;
select private.seed_email_templates(id) from public.organizations;
create function private.organizations_seed_email_templates() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.seed_email_templates(new.id); return null; end $$;
create trigger organizations_seed_email_templates after insert on public.organizations for each row execute function private.organizations_seed_email_templates();

-- ============================================================ 4. controlli e automatismi
create function private.email_messages_prepare() returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_text := lower(coalesce(new.from_address, '') || ' ' || coalesce(new.from_name, '') || ' ' || coalesce(new.subject, '') || ' ' || coalesce(new.snippet, '')
    || ' ' || coalesce(new.to_addrs::text, '') || ' ' || coalesce(new.cc_addrs::text, ''));
  return new;
end $$;
create trigger email_messages_prepare before insert or update on public.email_messages for each row execute function private.email_messages_prepare();

-- la conversazione riassume i suoi messaggi (numero, ultimo messaggio, non letti)
create function private.email_threads_refresh() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_thread uuid := coalesce(new.thread_id, old.thread_id); v_org uuid := coalesce(new.organization_id, old.organization_id);
begin
  update public.email_threads t set
    message_count = s.n, last_message_at = coalesce(s.last_at, t.last_message_at), unread_count = s.unread,
    subject = case when t.subject = '' then coalesce(s.first_subject, '') else t.subject end
  from (select count(*) as n, max(message_at) as last_at, count(*) filter (where direction = 'inbound' and not is_read) as unread,
               (array_agg(subject order by message_at))[1] as first_subject
        from public.email_messages where thread_id = v_thread and organization_id = v_org) s
  where t.id = v_thread and t.organization_id = v_org;
  return null;
end $$;
create trigger email_messages_refresh_thread after insert or update of is_read, message_at or delete on public.email_messages for each row execute function private.email_threads_refresh();

-- coerenza dei collegamenti di una conversazione; un collegamento fatto da un utente è "manuale"
create function private.email_threads_link_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cust uuid;
begin
  if tg_op = 'UPDATE' and (new.customer_id, new.contact_id, new.quote_id, new.task_id, new.follow_up_id) is not distinct from (old.customer_id, old.contact_id, old.quote_id, old.task_id, old.follow_up_id) then
    return new;
  end if;
  if new.customer_id is null then new.contact_id := null; end if;
  if new.contact_id is not null and not exists (select 1 from public.customer_contacts k where k.id = new.contact_id and k.organization_id = new.organization_id and k.customer_id = new.customer_id) then
    raise exception 'contact does not belong to the customer' using errcode = '23514';
  end if;
  if new.quote_id is not null and not exists (select 1 from public.quotes q where q.id = new.quote_id and q.organization_id = new.organization_id and (new.customer_id is null or q.customer_id = new.customer_id)) then
    raise exception 'quote does not belong to the customer' using errcode = '23514';
  end if;
  if new.task_id is not null and new.customer_id is not null then
    select customer_id into v_cust from public.tasks where id = new.task_id and organization_id = new.organization_id;
    if v_cust is not null and v_cust <> new.customer_id then raise exception 'task does not belong to the customer' using errcode = '23514'; end if;
  end if;
  if new.follow_up_id is not null and new.customer_id is not null then
    select customer_id into v_cust from public.follow_ups where id = new.follow_up_id and organization_id = new.organization_id;
    if v_cust is not null and v_cust <> new.customer_id then raise exception 'follow-up does not belong to the customer' using errcode = '23514'; end if;
  end if;
  if (select auth.uid()) is not null then
    -- collegamento fatto da una persona
    if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) and exists (
         select 1 from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id and (c.archived_at is not null or c.deleted_at is not null)) then
      raise exception 'customer is archived' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id or new.contact_id is distinct from old.contact_id then
      new.link_status := case when new.customer_id is null then 'none' else 'manual' end;
      new.link_candidates := '[]'::jsonb;
      new.linked_by := case when new.customer_id is null then null else (select auth.uid()) end;
      new.linked_at := case when new.customer_id is null then null else now() end;
    end if;
  end if;
  return new;
end $$;
create trigger email_threads_link_guard before insert or update on public.email_threads for each row execute function private.email_threads_link_guard();

-- cronologia del cliente
alter table public.activity_events drop constraint activity_events_entity_check;
alter table public.activity_events add constraint activity_events_entity_check
  check (entity in ('customer', 'contact', 'quote', 'task', 'document', 'note', 'appointment', 'call', 'follow_up', 'email'));
create function private.email_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_t public.email_threads;
begin
  if tg_table_name = 'email_messages' then
    if new.status not in ('received', 'sent') then return null; end if;
    if tg_op = 'UPDATE' and old.status = new.status then return null; end if;
    select * into v_t from public.email_threads where id = new.thread_id;
    if v_t.customer_id is null then return null; end if;
    insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id)
    values (new.organization_id, v_t.customer_id, 'email', new.thread_id, case new.direction when 'inbound' then 'received' else 'sent' end,
            case new.direction when 'inbound' then 'Email ricevuta: ' else 'Email inviata: ' end || left(coalesce(nullif(new.subject, ''), '(senza oggetto)'), 120), new.sent_by);
  else
    if new.customer_id is not null and (tg_op = 'INSERT' or old.customer_id is distinct from new.customer_id) and new.message_count > 0 then
      insert into public.activity_events (organization_id, customer_id, entity, entity_id, event, summary, actor_id)
      values (new.organization_id, new.customer_id, 'email', new.id, 'linked', 'Conversazione email collegata: ' || left(coalesce(nullif(new.subject, ''), '(senza oggetto)'), 120), (select auth.uid()));
    end if;
  end if;
  return null;
end $$;
create trigger email_messages_activity after insert or update of status on public.email_messages for each row execute function private.email_activity();
create trigger email_threads_activity after update of customer_id on public.email_threads for each row execute function private.email_activity();
revoke all on function private.email_messages_prepare(), private.email_threads_refresh(), private.email_threads_link_guard(), private.email_activity() from public, anon, authenticated;

-- ============================================================ 5. RLS (nessuna policy permissiva)
alter table public.email_accounts enable row level security;
alter table public.email_account_members enable row level security;
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_attachments enable row level security;
alter table public.email_drafts enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_user_signatures enable row level security;

create policy email_accounts_select on public.email_accounts for select to authenticated
  using (private.can_use_mailbox(id) or private.has_role(organization_id, array['owner', 'admin']));
create policy email_accounts_update on public.email_accounts for update to authenticated
  using (created_by = (select auth.uid()) or private.has_role(organization_id, array['owner', 'admin']))
  with check (created_by = (select auth.uid()) or private.has_role(organization_id, array['owner', 'admin']));
revoke insert, update, delete, truncate on public.email_accounts from authenticated;
grant update (display_name, signature, visibility) on public.email_accounts to authenticated;

create policy email_members_select on public.email_account_members for select to authenticated
  using (private.can_use_mailbox(account_id) or private.has_role(organization_id, array['owner', 'admin']));
create policy email_members_insert on public.email_account_members for insert to authenticated
  with check (exists (select 1 from public.email_accounts a where a.id = account_id and a.organization_id = email_account_members.organization_id
                      and (a.created_by = (select auth.uid()) or private.has_role(a.organization_id, array['owner', 'admin']))));
create policy email_members_delete on public.email_account_members for delete to authenticated
  using (exists (select 1 from public.email_accounts a where a.id = account_id and (a.created_by = (select auth.uid()) or private.has_role(a.organization_id, array['owner', 'admin']))));
revoke update, truncate on public.email_account_members from authenticated;
create trigger email_members_check_user before insert on public.email_account_members for each row execute function private.check_member_ref('user_id');

create policy email_threads_select on public.email_threads for select to authenticated using (private.can_use_mailbox(account_id));
create policy email_threads_update on public.email_threads for update to authenticated
  using (private.can_use_mailbox(account_id) and private.has_role(organization_id, array['owner', 'admin', 'member']))
  with check (private.can_use_mailbox(account_id) and private.has_role(organization_id, array['owner', 'admin', 'member']));
revoke insert, update, delete, truncate on public.email_threads from authenticated;
grant update (customer_id, contact_id, quote_id, task_id, follow_up_id) on public.email_threads to authenticated;

create policy email_messages_select on public.email_messages for select to authenticated using (private.can_use_mailbox(account_id));
create policy email_messages_update on public.email_messages for update to authenticated
  using (private.can_use_mailbox(account_id) and private.has_role(organization_id, array['owner', 'admin', 'member']))
  with check (private.can_use_mailbox(account_id) and private.has_role(organization_id, array['owner', 'admin', 'member']));
revoke insert, update, delete, truncate on public.email_messages from authenticated;
grant update (is_read) on public.email_messages to authenticated;

create policy email_attachments_select on public.email_attachments for select to authenticated
  using (exists (select 1 from public.email_messages m where m.id = message_id and m.organization_id = email_attachments.organization_id and private.can_use_mailbox(m.account_id)));
revoke insert, update, delete, truncate on public.email_attachments from authenticated;

create policy email_drafts_all on public.email_drafts for all to authenticated
  using (author_id = (select auth.uid()) and private.has_role(organization_id, array['owner', 'admin', 'member']))
  with check (author_id = (select auth.uid()) and private.has_role(organization_id, array['owner', 'admin', 'member'])
              and (account_id is null or private.can_use_mailbox(account_id)));
revoke truncate on public.email_drafts from authenticated;

create policy email_templates_select on public.email_templates for select to authenticated using (private.is_member(organization_id));
create policy email_templates_insert on public.email_templates for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin', 'member']) and created_by = (select auth.uid()));
create policy email_templates_update on public.email_templates for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin', 'member'])) with check (private.has_role(organization_id, array['owner', 'admin', 'member']));
create policy email_templates_delete on public.email_templates for delete to authenticated using (private.has_role(organization_id, array['owner', 'admin']));
revoke truncate on public.email_templates from authenticated;

create policy email_signatures_own on public.email_user_signatures for all to authenticated
  using (user_id = (select auth.uid()) and private.is_member(organization_id)) with check (user_id = (select auth.uid()) and private.is_member(organization_id));
revoke truncate on public.email_user_signatures from authenticated;

do $$
declare t text;
begin
  foreach t in array array['email_accounts', 'email_threads', 'email_messages', 'email_drafts', 'email_templates', 'email_user_signatures']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['email_accounts', 'email_threads', 'email_messages', 'email_drafts', 'email_templates']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.prevent_org_change()', t || '_org_immutable', t);
  end loop;
  foreach t in array array['email_accounts', 'email_account_members', 'email_templates']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- casella predefinita (una per organizzazione): solo titolare/amministratori
create function public.set_default_email_account(p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.email_accounts where id = p_account and disconnected_at is null;
  if v_org is null then raise exception 'account not found' using errcode = 'P0002'; end if;
  if not private.has_role(v_org, array['owner', 'admin']) then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.email_accounts set is_default = false where organization_id = v_org and is_default;
  update public.email_accounts set is_default = true where id = p_account;
end $$;
revoke all on function public.set_default_email_account(uuid) from public, anon;
grant execute on function public.set_default_email_account(uuid) to authenticated;

-- abbinamento indirizzo -> cliente/referente (indirizzi esatti, mai somiglianze)
create function public.email_match_addresses(p_org uuid, p_addresses text[]) returns table (address text, customer_id uuid, contact_id uuid, customer_name text, archived boolean)
language sql stable set search_path = '' as $$
  select a.addr, c.id, null::uuid, c.name, (c.archived_at is not null)
  from unnest(p_addresses) a(addr)
  join public.customers c on c.organization_id = p_org and c.deleted_at is null and c.email is not null and lower(c.email) = lower(a.addr)
  union
  select a.addr, c.id, k.id, c.name, (c.archived_at is not null)
  from unnest(p_addresses) a(addr)
  join public.customer_contacts k on k.organization_id = p_org and k.email is not null and lower(k.email) = lower(a.addr)
  join public.customers c on c.id = k.customer_id and c.organization_id = p_org and c.deleted_at is null;
$$;
revoke all on function public.email_match_addresses(uuid, text[]) from public, anon;
grant execute on function public.email_match_addresses(uuid, text[]) to authenticated, service_role;

-- ============================================================ 6. eliminazione cliente e ultimo contatto: tengono conto delle email
create or replace function public.customer_delete_blockers(p_customer uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when exists (select 1 from public.customers c where c.id = p_customer) then jsonb_build_object(
    'quotes', (select count(*) from public.quotes q where q.customer_id = p_customer),
    'invoices', (select count(*) from public.quote_billings b where b.customer_id = p_customer),
    'documents', (select count(*) from public.documents d where d.customer_id = p_customer),
    'tasks', (select count(*) from public.tasks t where t.customer_id = p_customer),
    'appointments', (select count(*) from public.appointments x where x.customer_id = p_customer),
    'calls', (select count(*) from public.call_logs x where x.customer_id = p_customer),
    'follow_ups', (select count(*) from public.follow_ups x where x.customer_id = p_customer),
    'emails', (select count(*) from public.email_threads x where x.customer_id = p_customer),
    'contacts', (select count(*) from public.customer_contacts k where k.customer_id = p_customer),
    'notes', (select count(*) from public.customer_notes n where n.customer_id = p_customer)) end;
$$;
revoke all on function public.customer_delete_blockers(uuid) from public, anon;
grant execute on function public.customer_delete_blockers(uuid) to authenticated;

-- Eliminazione fisica: solo titolare/amministratori, solo se il cliente è già archiviato e non ha preventivi, fatture,
-- documenti né attività. Referenti, note e cronologia del cliente vengono eliminati con lui; l'audit resta.
create or replace function public.delete_customer_permanently(p_customer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  b jsonb;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if not private.has_role(c.organization_id, array['owner', 'admin']) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if c.archived_at is null then
    raise exception 'customer must be archived first' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'quotes', (select count(*) from public.quotes q where q.customer_id = p_customer),
    'invoices', (select count(*) from public.quote_billings x where x.customer_id = p_customer),
    'documents', (select count(*) from public.documents d where d.customer_id = p_customer),
    'tasks', (select count(*) from public.tasks t where t.customer_id = p_customer),
    'appointments', (select count(*) from public.appointments x where x.customer_id = p_customer),
    'calls', (select count(*) from public.call_logs x where x.customer_id = p_customer),
    'follow_ups', (select count(*) from public.follow_ups x where x.customer_id = p_customer),
    'emails', (select count(*) from public.email_threads x where x.customer_id = p_customer)) into b;
  if (b ->> 'quotes')::int + (b ->> 'invoices')::int + (b ->> 'documents')::int + (b ->> 'tasks')::int
     + (b ->> 'appointments')::int + (b ->> 'calls')::int + (b ->> 'follow_ups')::int + (b ->> 'emails')::int > 0 then
    raise exception 'customer has linked records' using errcode = 'P0001', detail = b::text;
  end if;
  delete from public.customers where id = p_customer and organization_id = c.organization_id;
  -- dopo: l'eliminazione a cascata dei referenti genera a sua volta eventi di cronologia
  delete from public.activity_events where organization_id = c.organization_id and customer_id = p_customer;
end $$;
revoke all on function public.delete_customer_permanently(uuid) from public, anon;
grant execute on function public.delete_customer_permanently(uuid) to authenticated;

create or replace function public.customer_commercial_summary(p_customer uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_org uuid;
  r jsonb;
begin
  select organization_id into v_org from public.customers where id = p_customer;  -- RLS: null se non visibile
  if v_org is null then return null; end if;
  select jsonb_build_object(
    'issued_count', count(*) filter (where status <> 'draft'),
    'issued_cents', coalesce(sum(total_cents) filter (where status <> 'draft'), 0),
    'accepted_count', count(*) filter (where status = 'accepted'),
    'accepted_cents', coalesce(sum(total_cents) filter (where status = 'accepted'), 0),
    'rejected_count', count(*) filter (where status = 'rejected'),
    'rejected_cents', coalesce(sum(total_cents) filter (where status = 'rejected'), 0),
    'expired_count', count(*) filter (where status = 'expired'),
    'expired_cents', coalesce(sum(total_cents) filter (where status = 'expired'), 0),
    'open_count', count(*) filter (where status = 'sent'),
    'open_cents', coalesce(sum(total_cents) filter (where status = 'sent'), 0),
    'draft_count', count(*) filter (where status = 'draft'),
    'draft_cents', coalesce(sum(total_cents) filter (where status = 'draft'), 0),
    'avg_issued_cents', case when count(*) filter (where status <> 'draft') > 0
        then round(sum(total_cents) filter (where status <> 'draft') / count(*) filter (where status <> 'draft')) else 0 end,
    'conversion_pct', case when count(*) filter (where status in ('accepted', 'rejected')) > 0
        then round(100.0 * count(*) filter (where status = 'accepted') / count(*) filter (where status in ('accepted', 'rejected'))) end)
  into r
  from public.quotes where customer_id = p_customer and organization_id = v_org and deleted_at is null;
  return r || jsonb_build_object(
    'invoiced_count', (select count(*) from public.quote_billings b where b.customer_id = p_customer),
    'invoiced_cents', (select coalesce(sum(amount_cents), 0) from public.quote_billings b where b.customer_id = p_customer),
    'collected_cents', (select coalesce(sum(amount_cents), 0) from public.quote_billings b where b.customer_id = p_customer and b.payment_status = 'paid'),
    'accepted_invoiced_cents', (select coalesce(sum(b.amount_cents), 0) from public.quote_billings b join public.quotes q on q.id = b.quote_id where b.customer_id = p_customer and q.status = 'accepted'),
    'last_activity_at', (select max(created_at) from public.activity_events e where e.organization_id = v_org and e.customer_id = p_customer),
    'last_contact_at', (select max(t) from (
        select max(created_at) as t from public.customer_notes n where n.organization_id = v_org and n.customer_id = p_customer
        union all select max(completed_at) from public.tasks k where k.organization_id = v_org and k.customer_id = p_customer and k.completed_at is not null and k.deleted_at is null
        union all select max(created_at) from public.activity_events e where e.organization_id = v_org and e.customer_id = p_customer and e.event in ('status_sent', 'status_accepted', 'status_rejected')
        union all select max(called_at) from public.call_logs c where c.organization_id = v_org and c.customer_id = p_customer and c.outcome in ('answered', 'interested', 'not_interested', 'callback', 'other')
        union all select max(starts_at) from public.appointments a where a.organization_id = v_org and a.customer_id = p_customer and a.status = 'completed' and a.deleted_at is null
        union all select max(m.message_at) from public.email_messages m join public.email_threads t on t.id = m.thread_id where t.customer_id = p_customer and m.organization_id = v_org and m.status in ('received', 'sent')) x));
end $$;
