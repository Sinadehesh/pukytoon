-- Checks the database's rules from the outside, as the app's users would meet them: signed out, signed in
-- as different people, as a moderator and as the test runner. Every check raises if it fails.
-- Locally:   psql -qtA -v ON_ERROR_STOP=1 -f supabase/tests/supabase-stub.sql -f supabase/migrations/<each>.sql -f supabase/tests/database.sql
-- On the project, wrapped in begin; ... rollback; so nothing stays behind.

create function pg_temp.try(q text) returns text language plpgsql as $f$
begin execute q; return 'ok'; exception when others then return 'ERR: ' || sqlerrm; end $f$;

-- Acts as someone: '' is signed out, 'service' the test runner, anything else a user id
create function pg_temp.as_user(u text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', case when u in ('', 'service') then '' else u end, false);
  perform set_config('request.jwt.claims', case when u = '' then '{"role":"anon"}'
                                                 when u = 'service' then '{"role":"service_role"}'
                                                 else json_build_object('sub', u, 'role', 'authenticated')::text end, false);
end $f$;

create function pg_temp.expect(label text, got text, want text) returns text language plpgsql as $f$
begin
  if got is null or not (got like want) then
    raise exception 'FAIL %: got %, wanted %', label, coalesce(got, 'nothing'), want;
  end if;
  return 'pass  ' || label;
end $f$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.invalid'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@test.invalid'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@test.invalid');

-- Signed out
set role anon; select pg_temp.as_user('');
select pg_temp.expect('signed out: the core mechanics are there',
  (select string_agg(m.key || '@' || v.semver, ',' order by m.key) from public.mechanics m join public.mechanic_versions v on v.id = m.latest_version_id),
  'drop-merge@1.0.0,endless-runner@1.0.0,match-3@1.0.0,whack-a-mole@1.0.0');
select pg_temp.expect('signed out: reads trust scores', pg_temp.try($$select trust_score from public.users$$), 'ERR%permission denied%');
select pg_temp.expect('signed out: publishes', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"match-3"}}', 'X')$$), 'ERR%permission denied%');
select pg_temp.expect('signed out: makes a profile', pg_temp.try($$insert into public.users (id, handle, display_name) values ('00000000-0000-0000-0000-00000000000a', 'alice', 'A')$$), 'ERR%permission denied%');
select pg_temp.expect('signed out: deletes an account', pg_temp.try($$select public.delete_my_account()$$), 'ERR%permission denied%');
reset role;

-- Alice: a name, then a Studio game and a Claude link
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('alice publishes before picking a name', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"match-3"}}', 'Candy Swap')$$), 'ERR%Pick a name%');
select pg_temp.expect('alice picks a name', pg_temp.try($$insert into public.users (id, handle, display_name) values (auth.uid(), 'alice', 'Alice')$$), 'ok');
select pg_temp.expect('alice renames herself (an update, as the app does)', pg_temp.try($$update public.users set display_name = 'Alice A.', handle = 'alice' where id = auth.uid()$$), 'ok');
select pg_temp.expect('an upsert that rewrites id is refused (so the app inserts, then updates)', pg_temp.try($$insert into public.users (id, handle, display_name) values (auth.uid(), 'alice', 'Alice') on conflict (id) do update set id = excluded.id, handle = excluded.handle, display_name = excluded.display_name$$), 'ERR%permission denied%');
select pg_temp.expect('alice tries capitals in her handle', pg_temp.try($$update public.users set handle = 'Alice' where id = auth.uid()$$), 'ERR%check%');
select pg_temp.expect('alice makes herself admin', pg_temp.try($$update public.users set role = 'admin' where id = auth.uid()$$), 'ERR%permission denied%');
select pg_temp.expect('alice makes bob''s profile', pg_temp.try($$insert into public.users (id, handle, display_name) values ('00000000-0000-0000-0000-00000000000b', 'bob', 'Bob')$$), 'ERR%row-level security%');
select pg_temp.expect('alice writes a game row herself', pg_temp.try($$insert into public.games (owner_id, slug, title, source) values (auth.uid(), 'sneaky', 'Sneaky', 'code')$$), 'ERR%permission denied%');
select pg_temp.expect('alice publishes a Studio game', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"match-3","version":"1.0.0"},"params":{"cols":7},"theme":{"pack":"sweets"},"meta":{"title":"Candy Swap"}}', 'Candy Swap', 'Match-3 · Sweet Shop')$$), 'ok');
select pg_temp.expect('it has a share slug', (select slug from public.games where title = 'Candy Swap'), 'candy-swap-______');
select pg_temp.expect('it is public and published', (select visibility || '/' || status from public.games where title = 'Candy Swap'), 'public/published');
select pg_temp.expect('its version 1 holds the spec', (select v.version || ':' || (v.spec -> 'mechanic' ->> 'key') from public.games g join public.game_versions v on v.id = g.current_version_id where g.title = 'Candy Swap'), '1:match-3');
select pg_temp.expect('alice publishes it again, changed', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"match-3"}}', 'Candy Swap 2', null, (select id from public.games where title = 'Candy Swap'))$$), 'ok');
select pg_temp.expect('same game, version 2, new name', (select string_agg(v.version || ':' || g.title, ',') from public.games g join public.game_versions v on v.id = g.current_version_id where g.source = 'studio'), '2:Candy Swap 2');
select pg_temp.expect('a game type that does not exist', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"my-own-code"}}', 'X')$$), 'ERR%Unknown game type%');
select pg_temp.expect('something that is not a spec', pg_temp.try($$select public.publish_studio_game('{"spec":2}', 'X')$$), 'ERR%not a Creator Studio game%');
select pg_temp.expect('a spec that is too big', pg_temp.try(format('select public.publish_studio_game(%L::jsonb, %L)', json_build_object('spec', 1, 'mechanic', json_build_object('key', 'match-3'), 'pad', repeat('x', 9000)), 'Big')), 'ERR%too big%');
select pg_temp.expect('a blank name', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"match-3"}}', '   ')$$), 'ERR%Give the game a name%');
select pg_temp.expect('a name in another alphabet still gets a slug', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"whack-a-mole"}}', 'بازی من')$$), 'ok');
select pg_temp.expect('...which is game-<code>', (select slug from public.games where title = 'بازی من'), 'game-______');
select pg_temp.expect('alice shares a Claude link', pg_temp.try($$select public.publish_link_game('https://claude.ai/public/artifacts/abc-123', 'Moon Jumper')$$), 'ok');
select pg_temp.expect('it is a Claude link card', (select made_with || '/' || source from public.games where title = 'Moon Jumper'), 'claude/link_card');
select pg_temp.expect('the same link again gives the same game', pg_temp.try($$select public.publish_link_game('https://claude.ai/public/artifacts/abc-123', 'Moon Jumper')$$) || (select count(*) from public.games where source = 'link_card'), 'ok1');
select pg_temp.expect('a link to any other site', pg_temp.try($$select public.publish_link_game('https://evil.example/free-coins', 'Free coins')$$), 'ERR%Only Claude, Gemini and Kimi%');
select pg_temp.expect('a link dressed up as Claude', pg_temp.try($$select public.publish_link_game('https://claude.ai@evil.example/x', 'Sneaky')$$), 'ERR%Only Claude, Gemini and Kimi%');
select pg_temp.expect('which links count', concat_ws(',', public.link_source('https://g.co/gemini/share/xyz'), public.link_source('https://gemini.google.com/share/1'),
  public.link_source('https://www.kimi.com/x'), coalesce(public.link_source('http://claude.ai/x'), 'http-no'), coalesce(public.link_source('https://g.co/maps'), 'g.co-no'),
  coalesce(public.link_source('https://claude.ai.evil.example/'), 'lookalike-no')), 'gemini,gemini,kimi,http-no,g.co-no,lookalike-no');
select pg_temp.expect('alice renames her game', pg_temp.try($$update public.games set title = 'Candy Swap!' where title = 'Candy Swap 2'$$), 'ok');
select pg_temp.expect('alice sets its status herself', pg_temp.try($$update public.games set status = 'published' where title = 'Candy Swap!'$$), 'ERR%permission denied%');
select pg_temp.expect('alice reads report scores', pg_temp.try($$select report_score from public.games$$), 'ERR%permission denied%');
select pg_temp.expect('alice likes her game', pg_temp.try($$insert into public.user_libraries (user_id, game_id, list) select auth.uid(), id, 'favorite' from public.games where title = 'Candy Swap!'$$), 'ok');
reset role;

-- Bob, and the others, see Alice's games but can't change them
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('bob picks a name', pg_temp.try($$insert into public.users (id, handle, display_name) values (auth.uid(), 'bob', 'Bob')$$), 'ok');
select pg_temp.expect('bob takes alice''s name', pg_temp.try($$update public.users set handle = 'alice' where id = auth.uid()$$), 'ERR%duplicate%');
select pg_temp.expect('bob sees alice''s three games', (select count(*)::text from public.games), '3');
select pg_temp.expect('bob renames one', pg_temp.try($$update public.games set title = 'Mine now' where title = 'Moon Jumper'$$) || (select title from public.games where source = 'link_card'), 'okMoon Jumper');
select pg_temp.expect('bob deletes one', pg_temp.try($$delete from public.games where title = 'Moon Jumper'$$) || (select count(*) from public.games), 'ok3');
select pg_temp.expect('bob publishes over hers', pg_temp.try($$select public.publish_studio_game('{"spec":1,"mechanic":{"key":"match-3"}}', 'Hijack', null, (select id from public.games where title = 'Candy Swap!'))$$), 'ERR%not yours%');
select pg_temp.expect('bob shares her link', pg_temp.try($$select public.publish_link_game('https://claude.ai/public/artifacts/abc-123', 'My Moon')$$), 'ERR%already shared%');
select pg_temp.expect('bob likes Candy Swap', pg_temp.try($$insert into public.user_libraries (user_id, game_id, list) select auth.uid(), id, 'favorite' from public.games where title = 'Candy Swap!'$$), 'ok');
select pg_temp.expect('two likes now', (select likes_count::text from public.games where title = 'Candy Swap!'), '2');
select pg_temp.expect('bob likes it twice', pg_temp.try($$insert into public.user_libraries (user_id, game_id, list) select auth.uid(), id, 'favorite' from public.games where title = 'Candy Swap!'$$), 'ERR%duplicate%');
select pg_temp.expect('bob sees only his own likes', (select count(*)::text from public.user_libraries), '1');
select pg_temp.expect('bob likes as alice', pg_temp.try($$insert into public.user_libraries (user_id, game_id, list) select '00000000-0000-0000-0000-00000000000a', id, 'favorite' from public.games where title = 'Moon Jumper'$$), 'ERR%row-level security%');
select pg_temp.expect('bob reports Moon Jumper', pg_temp.try($$insert into public.reviews_reports (kind, game_id, reporter_id, reason, details) select 'player_report', id, auth.uid(), 'offensive', 'rude words' from public.games where title = 'Moon Jumper'$$), 'ok');
select pg_temp.expect('bob reports it twice', pg_temp.try($$insert into public.reviews_reports (kind, game_id, reporter_id, reason) select 'player_report', id, auth.uid(), 'spam' from public.games where title = 'Moon Jumper'$$), 'ERR%duplicate%');
select pg_temp.expect('bob files an automatic flag', pg_temp.try($$insert into public.reviews_reports (kind, game_id, reason) select 'auto_flag', id, 'crashes' from public.games where title = 'Moon Jumper'$$), 'ERR%row-level security%');
select pg_temp.expect('bob reports as alice', pg_temp.try($$insert into public.reviews_reports (kind, game_id, reporter_id, reason) select 'player_report', id, '00000000-0000-0000-0000-00000000000a', 'spam' from public.games where title = 'Moon Jumper'$$), 'ERR%row-level security%');
select pg_temp.expect('bob reads moderation cases', (select count(*)::text from public.moderation_cases), '0');
reset role;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('cara picks a name', pg_temp.try($$insert into public.users (id, handle, display_name) values (auth.uid(), 'cara', 'Cara')$$), 'ok');
select pg_temp.expect('cara reports Moon Jumper', pg_temp.try($$insert into public.reviews_reports (kind, game_id, reporter_id, reason) select 'player_report', id, auth.uid(), 'offensive' from public.games where title = 'Moon Jumper'$$), 'ok');
select pg_temp.expect('two reports: still in the feed', (select count(*)::text from public.games where title = 'Moon Jumper'), '1');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect('dan picks a name', pg_temp.try($$insert into public.users (id, handle, display_name) values (auth.uid(), 'dan', 'Dan')$$), 'ok');
select pg_temp.expect('dan reports Moon Jumper', pg_temp.try($$insert into public.reviews_reports (kind, game_id, reporter_id, reason) select 'player_report', id, auth.uid(), 'spam' from public.games where title = 'Moon Jumper'$$), 'ok');
select pg_temp.expect('three reports: out of the feed', (select count(*)::text from public.games where title = 'Moon Jumper'), '0');
select pg_temp.expect('dan likes it anyway', pg_temp.try($$insert into public.user_libraries (user_id, game_id, list) select auth.uid(), id, 'favorite' from public.games where source = 'link_card'$$), 'ok');
select pg_temp.expect('...which likes nothing, as he can''t see it', (select count(*)::text from public.user_libraries), '0');
reset role;
select pg_temp.expect('taken down, with one case holding all three reports',
  (select status::text from public.games where title = 'Moon Jumper') || ' ' || (select count(*) || ' case, score ' || max(score) from public.moderation_cases)
  || ', ' || (select count(*) from public.reviews_reports where case_id is not null) || ' reports', 'quarantined 1 case, score 3, 3 reports');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('alice still sees her taken-down game', (select status::text from public.games where title = 'Moon Jumper'), 'quarantined');
select pg_temp.expect('search finds "candy"', (select string_agg(title, ',') from public.games where search @@ to_tsquery('simple', 'candy:*')), 'Candy Swap!');
reset role;

-- Community mechanics: a verified developer submits one, the test runner and a moderator move it along
update public.users set developer_verified_at = now(), role = 'developer' where handle = 'bob';
update public.users set role = 'moderator' where handle = 'cara';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('alice (not verified) adds a mechanic', pg_temp.try($$insert into public.mechanics (key, author_id, name, family) values ('my-runner', auth.uid(), 'My Runner', 'runner')$$), 'ERR%row-level security%');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('bob adds a mechanic', pg_temp.try($$insert into public.mechanics (key, author_id, name, family) values ('lane-runner', auth.uid(), 'Lane Runner', 'runner')$$), 'ok');
select pg_temp.expect('bob adds version 1.0.0', pg_temp.try($$insert into public.mechanic_versions (mechanic_id, semver, manifest) select id, '1.0.0', '{"runtime": 1}' from public.mechanics where key = 'lane-runner'$$), 'ok');
select pg_temp.expect('bob submits it', pg_temp.try($$select public.transition_mechanic_version((select v.id from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), 'submitted')$$), 'ok');
select pg_temp.expect('bob marks it tested himself', pg_temp.try($$select public.transition_mechanic_version((select v.id from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), 'testing')$$), 'ERR%cannot go from submitted to testing%');
select pg_temp.expect('bob edits it while it is submitted', pg_temp.try($$update public.mechanic_versions set changelog = 'sneaky' where semver = '1.0.0' and mechanic_id = (select id from public.mechanics where key = 'lane-runner')$$)
  || coalesce((select changelog from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), ', unchanged'), 'ok, unchanged');
reset role;
set role service_role; select pg_temp.as_user('service');
select pg_temp.expect('the test runner starts testing', pg_temp.try($$select public.transition_mechanic_version((select v.id from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), 'testing')$$), 'ok');
select pg_temp.expect('...and passes it to review', pg_temp.try($$select public.transition_mechanic_version((select v.id from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), 'in_review')$$), 'ok');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('bob approves his own', pg_temp.try($$select public.transition_mechanic_version((select v.id from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), 'approved')$$), 'ERR%cannot go from in_review to approved%');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('cara (moderator) approves', pg_temp.try($$select public.transition_mechanic_version((select v.id from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), 'approved', 'Nice runner')$$), 'ok');
select pg_temp.expect('cara sees the reports', (select count(*)::text from public.reviews_reports where kind = 'player_report'), '3');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('bob publishes it', pg_temp.try($$select public.transition_mechanic_version((select v.id from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id where m.key = 'lane-runner'), 'published')$$), 'ok');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect('dan sees it published', (select string_agg(m.key, ',' order by m.key) from public.mechanics m where m.key = 'lane-runner' and m.latest_version_id is not null), 'lane-runner');
reset role;

-- Deleting an account takes its games, likes and follows with it; reports others filed stay
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('bob follows alice', pg_temp.try($$insert into public.follows (follower_id, followee_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000a')$$), 'ok');
select pg_temp.expect('bob deletes his account', pg_temp.try($$select public.delete_my_account()$$), 'ok');
reset role;
select pg_temp.expect('bob is gone; his report stays, unsigned; his mechanic stays, authorless; alice''s likes and followers drop',
  (select count(*) from public.users where handle = 'bob') || ' ' || (select count(*) from public.reviews_reports where reporter_id is null and kind = 'player_report')
  || ' ' || (select count(*) from public.mechanics where key = 'lane-runner' and author_id is null)
  || ' ' || (select likes_count from public.games where title = 'Candy Swap!') || ' ' || (select followers_count from public.users where handle = 'alice'),
  '0 1 1 1 0');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('alice deletes her account', pg_temp.try($$select public.delete_my_account()$$), 'ok');
reset role;
select pg_temp.expect('her profile, games, versions and cases are gone',
  (select count(*) from public.users where handle = 'alice') || '/' || (select count(*) from public.games) || '/' || (select count(*) from public.game_versions)
  || '/' || (select count(*) from public.moderation_cases), '0/0/0/0');

select 'every check passed';
