-- NEXORA 2.0 – 15 correzione: l'elenco dei membri non funzionava.
-- Le query "memberships -> profiles(full_name)" (tabella Membri, assegnatari delle attività, storico, audit) richiedono che
-- l'API conosca la relazione; il database dichiarava solo memberships.user_id -> auth.users, non verso profiles, quindi
-- l'API rispondeva con errore (PGRST200) e l'elenco risultava vuoto.
-- Si completano i profili eventualmente mancanti (additivo) e si dichiara la relazione.

insert into public.profiles (id)
select u.id from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

alter table public.memberships
  add constraint memberships_user_profile_fkey foreign key (user_id) references public.profiles (id) on delete cascade;
