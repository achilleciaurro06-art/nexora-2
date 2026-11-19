-- NEXORA 2.0 – 06 RPC privilegiate.
-- Implementazione in "private" (SECURITY DEFINER); wrapper in "public" visibili alla Data API
-- ma eseguibili SOLO dal service_role (cioè dal codice server).

create function private.slugify(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(p), '[^a-z0-9]+', '-', 'g')), ''), 'azienda');
$$;

create function private.create_activation_code(
  p_code_hash text, p_expires_at timestamptz, p_max_uses int, p_bound_email text, p_note text, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into private.activation_codes (code_hash, expires_at, max_uses, bound_email, note, created_by)
  values (p_code_hash, p_expires_at, p_max_uses, lower(p_bound_email), p_note, p_created_by)
  returning id into v;
  return v;
end $$;

-- Controllo preliminare (senza consumare il codice)
create function private.check_activation_code(p_code_hash text, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.activation_codes c
    where c.code_hash = p_code_hash and c.expires_at > now() and c.used_count < c.max_uses
      and (c.bound_email is null or c.bound_email = lower(p_email))
  );
$$;

-- Consuma il codice e crea organizzazione + owner + quota in un'unica transazione
create function private.redeem_activation_code(
  p_code_hash text, p_email text, p_org_name text, p_user_id uuid, p_full_name text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c private.activation_codes;
  v_org uuid;
  v_slug text;
begin
  select * into c from private.activation_codes where code_hash = p_code_hash for update;
  if not found or c.expires_at <= now() or c.used_count >= c.max_uses
     or (c.bound_email is not null and c.bound_email <> lower(p_email)) then
    raise exception 'invalid activation code' using errcode = 'P0001';
  end if;

  v_slug := private.slugify(p_org_name) || '-' || substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6);
  insert into public.organizations (name, slug) values (p_org_name, v_slug) returning id into v_org;
  insert into public.memberships (organization_id, user_id, role) values (v_org, p_user_id, 'owner');
  insert into public.ai_quotas (organization_id) values (v_org);
  update public.profiles
     set full_name = coalesce(nullif(p_full_name, ''), full_name),
         default_organization_id = v_org
   where id = p_user_id;
  update private.activation_codes set used_count = used_count + 1 where id = c.id;
  return v_org;
end $$;

-- Accettazione invito
create function private.accept_invitation(p_token_hash text, p_user_id uuid, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.invitations;
begin
  select * into i from public.invitations where token_hash = p_token_hash for update;
  if not found or i.accepted_at is not null or i.expires_at <= now() or i.email <> lower(p_email) then
    raise exception 'invalid invitation' using errcode = 'P0001';
  end if;
  insert into public.memberships (organization_id, user_id, role)
  values (i.organization_id, p_user_id, i.role)
  on conflict (organization_id, user_id) do nothing;
  update public.invitations set accepted_at = now() where id = i.id;
  update public.profiles set default_organization_id = coalesce(default_organization_id, i.organization_id)
   where id = p_user_id;
  return i.organization_id;
end $$;

-- Quota AI: prenota token in modo atomico (rolling mensile)
create function private.ai_reserve_tokens(p_org uuid, p_tokens bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare q public.ai_quotas;
begin
  select * into q from public.ai_quotas where organization_id = p_org for update;
  if not found then return false; end if;
  if q.period_start < date_trunc('month', current_date)::date then
    update public.ai_quotas set period_start = date_trunc('month', current_date)::date,
      tokens_used = 0, updated_at = now() where organization_id = p_org;
    q.tokens_used := 0;
  end if;
  if q.tokens_used + p_tokens > q.monthly_token_limit then return false; end if;
  update public.ai_quotas set tokens_used = tokens_used + p_tokens, updated_at = now()
   where organization_id = p_org;
  return true;
end $$;

revoke all on function private.create_activation_code(text, timestamptz, int, text, text, uuid),
  private.check_activation_code(text, text),
  private.redeem_activation_code(text, text, text, uuid, text),
  private.accept_invitation(text, uuid, text),
  private.ai_reserve_tokens(uuid, bigint) from public, anon, authenticated;
grant execute on function private.create_activation_code(text, timestamptz, int, text, text, uuid),
  private.check_activation_code(text, text),
  private.redeem_activation_code(text, text, text, uuid, text),
  private.accept_invitation(text, uuid, text),
  private.ai_reserve_tokens(uuid, bigint) to service_role;

-- wrapper pubblici (SECURITY INVOKER) eseguibili solo dal service_role
create function public.rpc_create_activation_code(
  p_code_hash text, p_expires_at timestamptz, p_max_uses int, p_bound_email text, p_note text, p_created_by uuid
) returns uuid language sql set search_path = '' as $$
  select private.create_activation_code(p_code_hash, p_expires_at, p_max_uses, p_bound_email, p_note, p_created_by);
$$;
create function public.rpc_check_activation_code(p_code_hash text, p_email text) returns boolean
language sql set search_path = '' as $$ select private.check_activation_code(p_code_hash, p_email); $$;
create function public.rpc_redeem_activation_code(
  p_code_hash text, p_email text, p_org_name text, p_user_id uuid, p_full_name text
) returns uuid language sql set search_path = '' as $$
  select private.redeem_activation_code(p_code_hash, p_email, p_org_name, p_user_id, p_full_name);
$$;
create function public.rpc_accept_invitation(p_token_hash text, p_user_id uuid, p_email text) returns uuid
language sql set search_path = '' as $$ select private.accept_invitation(p_token_hash, p_user_id, p_email); $$;
create function public.rpc_ai_reserve_tokens(p_org uuid, p_tokens bigint) returns boolean
language sql set search_path = '' as $$ select private.ai_reserve_tokens(p_org, p_tokens); $$;

revoke all on function public.rpc_create_activation_code(text, timestamptz, int, text, text, uuid),
  public.rpc_check_activation_code(text, text),
  public.rpc_redeem_activation_code(text, text, text, uuid, text),
  public.rpc_accept_invitation(text, uuid, text),
  public.rpc_ai_reserve_tokens(uuid, bigint) from public, anon, authenticated;
grant execute on function public.rpc_create_activation_code(text, timestamptz, int, text, text, uuid),
  public.rpc_check_activation_code(text, text),
  public.rpc_redeem_activation_code(text, text, text, uuid, text),
  public.rpc_accept_invitation(text, uuid, text),
  public.rpc_ai_reserve_tokens(uuid, bigint) to service_role;
