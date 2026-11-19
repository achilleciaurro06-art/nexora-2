-- NEXORA 2.0 – 08 salvataggio atomico dei preventivi (testata + righe in un'unica transazione).
-- SECURITY INVOKER: la RLS dell'utente chiamante resta attiva; la numerazione non lascia buchi in caso di errore.

create function public.save_quote(
  p_quote uuid, p_org uuid, p_customer uuid, p_title text, p_issue_date date,
  p_valid_until date, p_notes text, p_terms text, p_items jsonb
) returns uuid
language plpgsql set search_path = '' as $$
declare v uuid := p_quote;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a quote needs at least one item' using errcode = '22023';
  end if;

  if v is null then
    insert into public.quotes (organization_id, customer_id, title, issue_date, valid_until, notes, terms, created_by)
    values (p_org, p_customer, p_title, coalesce(p_issue_date, current_date), p_valid_until, p_notes, p_terms, (select auth.uid()))
    returning id into v;
  else
    update public.quotes
       set customer_id = p_customer, title = p_title, issue_date = coalesce(p_issue_date, issue_date),
           valid_until = p_valid_until, notes = p_notes, terms = p_terms
     where id = v and organization_id = p_org and status = 'draft';
    if not found then
      raise exception 'quote not found or not editable' using errcode = 'P0002';
    end if;
    delete from public.quote_items where quote_id = v and organization_id = p_org;
  end if;

  insert into public.quote_items
    (organization_id, quote_id, position, description, quantity, unit_price_cents, discount_percent, vat_rate)
  select p_org, v, (t.ord - 1)::int,
         t.e ->> 'description',
         coalesce((t.e ->> 'quantity')::numeric, 1),
         coalesce((t.e ->> 'unit_price_cents')::bigint, 0),
         coalesce((t.e ->> 'discount_percent')::numeric, 0),
         coalesce((t.e ->> 'vat_rate')::numeric, 22)
  from jsonb_array_elements(p_items) with ordinality as t(e, ord);

  return v;
end $$;

revoke all on function public.save_quote(uuid, uuid, uuid, text, date, date, text, text, jsonb) from public, anon;
grant execute on function public.save_quote(uuid, uuid, uuid, text, date, date, text, text, jsonb) to authenticated;
