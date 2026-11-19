-- NEXORA 2.0 – 04 RLS: default-deny su ogni tabella, policy per ruolo, privilegi di colonna.

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.documents enable row level security;
alter table public.ai_quotas enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.audit_logs enable row level security;
alter table private.activation_codes enable row level security;
alter table private.platform_admins enable row level security;
alter table private.quote_counters enable row level security;

-- ---------------------------------------------------------------- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (private.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_role(id, array['owner', 'admin']))
  with check (private.has_role(id, array['owner', 'admin']));
revoke insert, update, delete on public.organizations from authenticated;
grant update (name, vat_number, settings) on public.organizations to authenticated;

-- ---------------------------------------------------------------- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, locale, default_organization_id) on public.profiles to authenticated;

-- ---------------------------------------------------------------- memberships (creazione solo lato server)
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(organization_id));
create policy memberships_update on public.memberships for update to authenticated
  using (
    private.has_role(organization_id, array['owner'])
    or (private.has_role(organization_id, array['admin']) and role <> 'owner')
  )
  with check (
    private.has_role(organization_id, array['owner'])
    or (private.has_role(organization_id, array['admin']) and role <> 'owner')
  );
create policy memberships_delete on public.memberships for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_role(organization_id, array['owner'])
    or (private.has_role(organization_id, array['admin']) and role <> 'owner')
  );
revoke insert, update, delete on public.memberships from authenticated;
grant update (role) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;

-- ---------------------------------------------------------------- invitations
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin']) and invited_by = (select auth.uid()));
create policy invitations_delete on public.invitations for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));
revoke update on public.invitations from authenticated;

-- ---------------------------------------------------------------- tabelle operative: schema standard
do $$
declare t text;
begin
  foreach t in array array['customers','customer_contacts','quotes','quote_items','tasks','reminders','documents']
  loop
    execute format($f$create policy %1$I on public.%2$I for select to authenticated
      using (private.is_member(organization_id))$f$, t || '_select', t);
    execute format($f$create policy %1$I on public.%2$I for insert to authenticated
      with check (private.has_role(organization_id, array['owner','admin','member']))$f$, t || '_insert', t);
    execute format($f$create policy %1$I on public.%2$I for update to authenticated
      using (private.has_role(organization_id, array['owner','admin','member']))
      with check (private.has_role(organization_id, array['owner','admin','member']))$f$, t || '_update', t);
    execute format($f$create policy %1$I on public.%2$I for delete to authenticated
      using (private.has_role(organization_id, array['owner','admin']))$f$, t || '_delete', t);
  end loop;
end $$;
-- numerazione e totali sono gestiti dal database: privilegi di colonna espliciti su quotes
revoke insert, update on public.quotes from authenticated;
grant insert (id, organization_id, customer_id, title, status, issue_date, valid_until, notes, terms, created_by)
  on public.quotes to authenticated;
grant update (customer_id, title, status, issue_date, valid_until, notes, terms, deleted_at)
  on public.quotes to authenticated;

-- ---------------------------------------------------------------- AI
create policy ai_quotas_select on public.ai_quotas for select to authenticated
  using (private.is_member(organization_id));
revoke insert, update, delete on public.ai_quotas from authenticated;

create policy ai_usage_select on public.ai_usage for select to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']) or user_id = (select auth.uid()));
revoke insert, update, delete on public.ai_usage from authenticated;

create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (user_id = (select auth.uid()) and private.is_member(organization_id));
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated
  with check (user_id = (select auth.uid()) and private.has_role(organization_id, array['owner', 'admin', 'member']));
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated
  using (user_id = (select auth.uid()));

create policy ai_messages_select on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c
    where c.id = conversation_id and c.organization_id = ai_messages.organization_id
      and c.user_id = (select auth.uid())));
create policy ai_messages_insert on public.ai_messages for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin', 'member'])
    and exists (select 1 from public.ai_conversations c
      where c.id = conversation_id and c.organization_id = ai_messages.organization_id
        and c.user_id = (select auth.uid())));

create policy ai_suggestions_select on public.ai_suggestions for select to authenticated
  using (private.is_member(organization_id));
create policy ai_suggestions_insert on public.ai_suggestions for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin', 'member'])
    and created_by = (select auth.uid()) and status = 'pending');
create policy ai_suggestions_update on public.ai_suggestions for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin', 'member']))
  with check (private.has_role(organization_id, array['owner', 'admin', 'member']));
revoke update on public.ai_suggestions from authenticated;
grant update (status) on public.ai_suggestions to authenticated;

-- ---------------------------------------------------------------- audit: sola lettura per owner/admin
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
