-- NEXORA 2.0 – 12 audit: le modifiche alle sole righe di un preventivo ora lasciano traccia.
-- Prima: modificare solo le righe lasciava invariata la testata del preventivo, quindi nessuna riga di audit.
-- Ora ogni variazione delle righe aggiorna quotes.items_updated_at (campo tracciato dall'audit); le raffiche di
-- aggiornamenti identici dello stesso utente (es. salvataggio di un preventivo con molte righe) vengono collassate.

alter table public.quotes add column items_updated_at timestamptz;

create or replace function private.recalc_quote(p_quote uuid) returns void
language sql security definer set search_path = '' as $$
  update public.quotes q set
    subtotal_cents = coalesce(t.net, 0),
    vat_cents = coalesce(t.vat, 0),
    total_cents = coalesce(t.net, 0) + coalesce(t.vat, 0),
    items_updated_at = now()
  from (
    select sum(line_net_cents) as net,
           sum(round(line_net_cents * vat_rate / 100))::bigint as vat
    from public.quote_items where quote_id = p_quote
  ) t
  where q.id = p_quote;
$$;

create or replace function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_fields text[];
  v_actor uuid := (select auth.uid());
  v_entity_id uuid := (v_row ->> 'id')::uuid;
begin
  v_org := case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
                else (v_row ->> 'organization_id')::uuid end;
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = v_org) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_fields
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'subtotal_cents', 'vat_cents', 'total_cents');
    if v_fields is null then return null; end if;
    -- collassa le raffiche identiche (stesso utente, stessa entità, stessi campi, entro 5 secondi)
    if exists (
      select 1 from public.audit_logs a
      where a.organization_id is not distinct from v_org and a.entity = tg_table_name and a.entity_id = v_entity_id
        and a.action = 'update' and a.actor_id is not distinct from v_actor and a.changed_fields is not distinct from v_fields
        and a.created_at > now() - interval '5 seconds'
    ) then
      return null;
    end if;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, changed_fields)
  values (v_org, v_actor, lower(tg_op), tg_table_name, v_entity_id, v_fields);
  return null;
end $$;
