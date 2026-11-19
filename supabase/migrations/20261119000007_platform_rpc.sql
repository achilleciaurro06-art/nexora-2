-- NEXORA 2.0 – 07 RPC per la console di piattaforma (solo service_role).

create function private.is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins where user_id = p_user);
$$;

create function private.list_activation_codes() returns table (
  id uuid, bound_email text, expires_at timestamptz, max_uses int, used_count int, note text, created_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select id, bound_email, expires_at, max_uses, used_count, note, created_at
  from private.activation_codes order by created_at desc limit 200;
$$;

revoke all on function private.is_platform_admin(uuid), private.list_activation_codes() from public, anon, authenticated;
grant execute on function private.is_platform_admin(uuid), private.list_activation_codes() to service_role;

create function public.rpc_is_platform_admin(p_user uuid) returns boolean
language sql set search_path = '' as $$ select private.is_platform_admin(p_user); $$;
create function public.rpc_list_activation_codes() returns table (
  id uuid, bound_email text, expires_at timestamptz, max_uses int, used_count int, note text, created_at timestamptz
) language sql set search_path = '' as $$ select * from private.list_activation_codes(); $$;

revoke all on function public.rpc_is_platform_admin(uuid), public.rpc_list_activation_codes() from public, anon, authenticated;
grant execute on function public.rpc_is_platform_admin(uuid), public.rpc_list_activation_codes() to service_role;
