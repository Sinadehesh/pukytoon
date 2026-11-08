-- is_moderator only reads profile columns everyone can read, so it can run as whoever calls it instead of
-- as the owner (Supabase's advisor flags owner-rights functions that signed-out visitors can call).
-- The functions that do run as the owner, on purpose, are the app's way of writing what people can't write
-- directly: publish_studio_game, publish_link_game, delete_my_account and transition_mechanic_version.
create or replace function public.is_moderator() returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.users where id = auth.uid() and role in ('moderator', 'admin'))
$$;
