-- NEXORA 2.0 – 05 Storage: bucket privato "documents", percorso {organization_id}/{document_id}/{file}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 15728640,
  array['application/pdf', 'image/png', 'image/jpeg',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- estrae in sicurezza l'organization_id dal primo segmento del percorso
create function private.storage_org(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;
revoke all on function private.storage_org(text) from public, anon;
grant execute on function private.storage_org(text) to authenticated, service_role;

create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and private.is_member(private.storage_org(name)));
create policy documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
    and private.has_role(private.storage_org(name), array['owner', 'admin', 'member']));
create policy documents_update on storage.objects for update to authenticated
  using (bucket_id = 'documents'
    and private.has_role(private.storage_org(name), array['owner', 'admin', 'member']))
  with check (bucket_id = 'documents'
    and private.has_role(private.storage_org(name), array['owner', 'admin', 'member']));
create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
    and private.has_role(private.storage_org(name), array['owner', 'admin']));
