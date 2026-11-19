-- NEXORA 2.0 – 14 rimozione di un cliente in un'unica operazione atomica.
-- Rimuovere (archiviare) un cliente nasconde anche i suoi preventivi ancora aperti (bozza/inviato): non hanno più
-- senso se il cliente è perso e non devono restare in pipeline, follow-up, notifiche e statistiche.
-- Preventivi accettati/rifiutati/scaduti e attività restano nello storico. Nessun dato viene cancellato fisicamente.
-- SECURITY INVOKER: vale la RLS dell'utente; in più il ruolo owner/admin è verificato qui, non solo nell'app.

create function public.remove_customer(p_customer uuid) returns int
language plpgsql set search_path = '' as $$
declare
  v_org uuid;
  v_quotes int;
begin
  select organization_id into v_org from public.customers where id = p_customer and deleted_at is null;
  if v_org is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_org, array['owner', 'admin']) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.quotes set deleted_at = now()
   where customer_id = p_customer and organization_id = v_org and deleted_at is null and status in ('draft', 'sent');
  get diagnostics v_quotes = row_count;

  update public.customers set deleted_at = now() where id = p_customer and organization_id = v_org;
  return v_quotes;
end $$;

revoke all on function public.remove_customer(uuid) from public, anon;
grant execute on function public.remove_customer(uuid) to authenticated;
