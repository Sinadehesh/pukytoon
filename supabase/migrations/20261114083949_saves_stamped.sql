-- Cloud saves (game_saves): every write is stamped with the database's clock, insert or update. Phones
-- compare the stamp with the one they last saw to know another phone wrote a newer save; an update that
-- kept the old stamp, or a phone's own clock, would hide it.
create function public.stamp_save() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger game_saves_stamp before insert or update on public.game_saves
  for each row execute function public.stamp_save();
