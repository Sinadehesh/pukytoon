-- Pukytoon's database (Supabase, Postgres 17): who's who, the games, the mechanics behind Studio games, the
-- asset library, likes and follows, and moderation. Row level security decides who may read and write what;
-- the functions at the end are what the app calls to publish, report and delete an account.
-- Tested by supabase/tests/database.sql.

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.user_role       as enum ('player', 'developer', 'moderator', 'admin');
create type public.visibility      as enum ('private', 'unlisted', 'public');
create type public.game_source     as enum ('code', 'url_snapshot', 'link_card', 'studio');
create type public.game_status     as enum ('draft', 'published', 'flagged', 'quarantined', 'removed');
create type public.mechanic_status as enum ('draft', 'submitted', 'testing', 'test_failed', 'in_review',
                                            'changes_requested', 'approved', 'published', 'deprecated', 'suspended');
create type public.asset_kind      as enum ('sprite', 'spritesheet', 'tileset', 'background', 'ui_frame',
                                            'font', 'palette', 'sfx', 'music');
create type public.library_list    as enum ('saved', 'favorite');
create type public.report_kind     as enum ('player_report', 'auto_flag', 'review');
create type public.report_reason   as enum ('broken', 'crashes', 'performance', 'offensive', 'ip_infringement',
                                            'malicious', 'phishing', 'spam', 'other');
create type public.report_status   as enum ('open', 'actioned', 'dismissed');

-- USERS: the public profile; email and sign-in stay in auth.users
create table public.users (
  id                    uuid primary key references auth.users (id) on delete cascade,
  handle                extensions.citext unique not null check (handle::text ~ '^[a-z0-9_]{3,24}$'),
  display_name          text not null check (char_length(display_name) between 1 and 50),
  avatar_url            text,
  bio                   text check (char_length(bio) <= 300),
  role                  public.user_role not null default 'player',
  developer_verified_at timestamptz,                 -- verified developers may submit mechanics
  trust_score           real not null default 1.0 check (trust_score between 0 and 3), -- weighs their reports
  followers_count       int not null default 0,
  following_count       int not null default 0,
  created_at            timestamptz not null default now()
);

-- MECHANICS: the core templates and, later, community ones; each version carries its manifest
create table public.mechanics (
  id                uuid primary key default gen_random_uuid(),
  key               text unique not null check (key ~ '^[a-z0-9-]{3,40}$'),   -- 'endless-runner'
  author_id         uuid references public.users (id) on delete set null,     -- null for core mechanics
  name              text not null,
  family            text not null,                    -- 'runner', 'grid-puzzle', 'physics', ...
  summary           text,
  is_core           boolean not null default false,   -- made by Pukytoon
  latest_version_id uuid,                             -- newest published version (fk below)
  games_count       int not null default 0,
  created_at        timestamptz not null default now()
);

create table public.mechanic_versions (
  id           uuid primary key default gen_random_uuid(),
  mechanic_id  uuid not null references public.mechanics (id) on delete cascade,
  semver       text not null check (semver ~ '^\d+\.\d+\.\d+$'),
  status       public.mechanic_status not null default 'draft',
  manifest     jsonb not null,       -- runtime version, params JSON Schema, picture slots, counts, rules
  bundle_hash  text,                 -- SHA-256 of the built module, for community mechanics
  changelog    text,
  test_report  jsonb,                -- summary of the latest full test run
  submitted_at timestamptz,
  reviewed_by  uuid references public.users (id) on delete set null,
  reviewed_at  timestamptz,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (mechanic_id, semver)
);
alter table public.mechanics add constraint mechanics_latest_version_fk
  foreign key (latest_version_id) references public.mechanic_versions (id) on delete set null;

-- ASSETS: pictures, UI, backgrounds, palettes, sound; the files are stored by hash
create table public.asset_packs (            -- a look: assets that belong together, and a palette
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text,
  palette     jsonb not null default '{}',   -- {"bg": "#ffe9d6", ...}
  role_map    jsonb not null default '{}',   -- slot role -> asset: {"player": "...", "music": "..."}
  is_public   boolean not null default false,
  owner_id    uuid references public.users (id) on delete set null,   -- null = the platform's library
  created_at  timestamptz not null default now()
);

create table public.assets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.users (id) on delete set null,   -- null = the platform's library
  pack_id     uuid references public.asset_packs (id) on delete set null,
  kind        public.asset_kind not null,
  name        text not null,
  file_hash   text not null,                 -- stored as assets/<hash>.<ext>
  mime        text not null,
  bytes       int not null check (bytes <= 20 * 1024 * 1024),
  meta        jsonb not null default '{}',   -- size, frames, fps, pivot, hitbox, duration, colours
  tags        text[] not null default '{}',
  roles       text[] not null default '{}',  -- slot roles it suits: player, hazard, collectible, music...
  license     text not null,                 -- 'CC0-1.0', 'CC-BY-4.0', 'platform', 'user-owned'
  attribution text,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- GAMES: one row per game; every publish is a new, unchanging version
create table public.games (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null check (slug ~ '^[a-z0-9-]{3,60}$'),   -- its share link: ?g=<slug>
  owner_id            uuid not null references public.users (id) on delete cascade,
  title               text not null check (char_length(title) between 1 and 80),
  description         text check (char_length(description) <= 2000),
  source              public.game_source not null,
  source_url          text,                  -- link cards and URL snapshots
  made_with           text,                  -- 'claude', 'gemini', 'kimi', 'studio', 'human'
  mechanic_version_id uuid references public.mechanic_versions (id),   -- Studio games
  current_version_id  uuid,                  -- fk below
  visibility          public.visibility not null default 'private',
  status              public.game_status not null default 'draft',
  orientation         text not null default 'portrait' check (orientation in ('portrait', 'landscape', 'any')),
  thumbnail_url       text,
  og_image_url        text,
  tags                text[] not null default '{}',
  likes_count         int not null default 0,
  plays_count         bigint not null default 0,
  report_score        real not null default 0,      -- weighted open reports, kept by a trigger
  search              tsvector generated always as (
                        setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
                        setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'B')) stored,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (source <> 'link_card' or source_url is not null),
  check (source <> 'studio' or mechanic_version_id is not null)
);

create table public.game_versions (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games (id) on delete cascade,
  version      int not null,
  bundle_hash  text,                 -- stored at /g/<game-id>/v/<hash>/ ; null for Studio games and links
  bundle_bytes int,
  format       text not null check (format in ('html', 'react', 'js', 'studio', 'link')),
  spec         jsonb,                -- the GameSpec, for Studio games
  smoke_test   jsonb,                -- {passed, boot_ms, errors, blocked_requests, screenshot}
  created_at   timestamptz not null default now(),
  unique (game_id, version)
);
alter table public.games add constraint games_current_version_fk
  foreign key (current_version_id) references public.game_versions (id) on delete set null;

create table public.game_version_assets (    -- which assets a version uses, for credits and takedowns
  game_version_id uuid references public.game_versions (id) on delete cascade,
  asset_id        uuid references public.assets (id),
  slot            text not null,
  primary key (game_version_id, slot)
);

create table public.game_saves (             -- cloud saves written through the bridge
  user_id    uuid references public.users (id) on delete cascade,
  game_id    uuid references public.games (id) on delete cascade,
  data       jsonb not null check (pg_column_size(data) <= 262144),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table public.game_daily_stats (       -- rolled up from the runtime's reports; drives automatic flags
  game_id           uuid references public.games (id) on delete cascade,
  day               date not null,
  sessions          int not null default 0,
  load_failures     int not null default 0,
  error_sessions    int not null default 0,
  watchdog_timeouts int not null default 0,
  csp_violations    int not null default 0,
  primary key (game_id, day)
);

-- SOCIAL
create table public.follows (
  follower_id uuid references public.users (id) on delete cascade,
  followee_id uuid references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table public.user_libraries (         -- 'favorite' is the public like; 'saved' is a private play-later
  user_id    uuid references public.users (id) on delete cascade,
  game_id    uuid references public.games (id) on delete cascade,
  list       public.library_list not null,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id, list)
);
-- Someone's own games need no rows: they're the games whose owner_id is theirs.

-- MODERATION
create table public.moderation_cases (       -- one open case per target and queue; reports attach to it
  id                  bigint generated always as identity primary key,
  game_id             uuid references public.games (id) on delete cascade,
  mechanic_version_id uuid references public.mechanic_versions (id) on delete cascade,
  asset_id            uuid references public.assets (id) on delete cascade,
  user_id             uuid references public.users (id) on delete cascade,
  queue               text not null check (queue in ('security', 'broken', 'content', 'ip', 'mechanic_review')),
  priority            smallint not null default 3 check (priority between 1 and 4),   -- 1 = act within the hour
  score               real not null default 0,
  status              text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  assigned_to         uuid references public.users (id) on delete set null,
  resolution          text,
  opened_at           timestamptz not null default now(),
  resolved_at         timestamptz,
  check (num_nonnulls(game_id, mechanic_version_id, asset_id, user_id) = 1)
);

create table public.reviews_reports (        -- every signal about a target: player reports, automatic flags, reviews
  id                  bigint generated always as identity primary key,
  kind                public.report_kind not null,
  game_id             uuid references public.games (id) on delete cascade,
  game_version_id     uuid references public.game_versions (id) on delete set null,   -- context only
  mechanic_version_id uuid references public.mechanic_versions (id) on delete cascade,
  asset_id            uuid references public.assets (id) on delete cascade,
  reported_user_id    uuid references public.users (id) on delete cascade,
  reporter_id         uuid references public.users (id) on delete set null,   -- null for automatic flags
  reason              public.report_reason,          -- required unless it's a review
  details             text check (char_length(details) <= 1000),
  evidence            jsonb not null default '{}',   -- error, screenshot, device, test run
  weight              real not null default 1,       -- the reporter's trust when they filed it
  case_id             bigint references public.moderation_cases (id) on delete set null,
  status              public.report_status not null default 'open',
  decision            text check (decision in ('approve', 'request_changes', 'hide', 'quarantine', 'remove', 'dismiss')),
  created_at          timestamptz not null default now(),
  check (num_nonnulls(game_id, mechanic_version_id, asset_id, reported_user_id) = 1),
  check (kind <> 'auto_flag' or reporter_id is null),
  check (kind <> 'review' or decision is not null),
  check (kind = 'review' or reason is not null)
);

create table public.sandbox_test_runs (
  id                  bigint generated always as identity primary key,
  mechanic_version_id uuid references public.mechanic_versions (id) on delete cascade,
  game_version_id     uuid references public.game_versions (id) on delete cascade,
  suite               text not null check (suite in ('static', 'smoke', 'full', 'regression')),
  status              text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'error')),
  metrics             jsonb not null default '{}',   -- boot_ms, p95_frame_ms, heap_growth_mb, errors, blocked_requests
  artifacts           jsonb not null default '{}',   -- where the screenshots, video and logs are
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),
  check (num_nonnulls(mechanic_version_id, game_version_id) = 1)
);

-- INDEXES
create index games_feed         on public.games (published_at desc) where visibility = 'public' and status = 'published';
create index games_owner        on public.games (owner_id, created_at desc);
create index games_mechanic     on public.games (mechanic_version_id) where mechanic_version_id is not null;
create index games_current      on public.games (current_version_id);
create index games_source_url   on public.games (source_url) where source_url is not null;
create index games_search       on public.games using gin (search);
create index games_tags         on public.games using gin (tags);
create index assets_library     on public.assets (kind, created_at desc) where is_public;
create index assets_owner       on public.assets (owner_id);
create index assets_pack        on public.assets (pack_id);
create index assets_tags        on public.assets using gin (tags);
create index assets_name_trgm   on public.assets using gin (name extensions.gin_trgm_ops);
create index asset_packs_owner  on public.asset_packs (owner_id);
create index version_assets_asset on public.game_version_assets (asset_id);
create index follows_followee   on public.follows (followee_id, created_at desc);
create index libraries_game     on public.user_libraries (game_id);
create index mechanics_author   on public.mechanics (author_id);
create index mechanics_latest   on public.mechanics (latest_version_id);
create index mech_versions_q    on public.mechanic_versions (status, submitted_at) where status in ('submitted', 'in_review');
create index mech_versions_reviewer on public.mechanic_versions (reviewed_by);
create unique index one_open_case on public.moderation_cases
  (queue, coalesce(game_id, mechanic_version_id, asset_id, user_id)) where status <> 'resolved';
create index cases_game         on public.moderation_cases (game_id);
create index cases_mech_version on public.moderation_cases (mechanic_version_id);
create index cases_asset        on public.moderation_cases (asset_id);
create index cases_user         on public.moderation_cases (user_id);
create index cases_assignee     on public.moderation_cases (assigned_to);
create unique index one_open_report_per_reporter on public.reviews_reports
  (reporter_id, coalesce(game_id, mechanic_version_id, asset_id, reported_user_id)) where kind = 'player_report' and status = 'open';
create index reports_case       on public.reviews_reports (case_id);
create index reports_game       on public.reviews_reports (game_id);
create index reports_game_version on public.reviews_reports (game_version_id);
create index reports_mech_version on public.reviews_reports (mechanic_version_id);
create index reports_asset      on public.reviews_reports (asset_id);
create index reports_user       on public.reviews_reports (reported_user_id);
create index test_runs_mech_version on public.sandbox_test_runs (mechanic_version_id);
create index test_runs_game_version on public.sandbox_test_runs (game_version_id);
create index saves_game         on public.game_saves (game_id);

-- COUNTERS kept by triggers
create function public.count_favorites() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.list = 'favorite' then
    update public.games set likes_count = likes_count + 1 where id = new.game_id;
  elsif tg_op = 'DELETE' and old.list = 'favorite' then
    update public.games set likes_count = greatest(likes_count - 1, 0) where id = old.game_id;
  end if;
  return null;
end $$;
create trigger user_libraries_count after insert or delete on public.user_libraries
  for each row execute function public.count_favorites();

create function public.count_follows() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.users set followers_count = followers_count + 1 where id = new.followee_id;
    update public.users set following_count = following_count + 1 where id = new.follower_id;
  else
    update public.users set followers_count = greatest(followers_count - 1, 0) where id = old.followee_id;
    update public.users set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  end if;
  return null;
end $$;
create trigger follows_count after insert or delete on public.follows
  for each row execute function public.count_follows();

-- ROW LEVEL SECURITY
-- The service key, or a direct database session with no user token (migrations, scheduled jobs)
create function public.is_service() returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or (session_user = 'postgres' and nullif(current_setting('request.jwt.claims', true), '') is null)
$$;

create function public.is_moderator() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users where id = auth.uid() and role in ('moderator', 'admin'))
$$;

alter table public.users               enable row level security;
alter table public.mechanics           enable row level security;
alter table public.mechanic_versions   enable row level security;
alter table public.asset_packs         enable row level security;
alter table public.assets              enable row level security;
alter table public.games               enable row level security;
alter table public.game_versions       enable row level security;
alter table public.game_version_assets enable row level security;
alter table public.game_saves          enable row level security;
alter table public.game_daily_stats    enable row level security;
alter table public.follows             enable row level security;
alter table public.user_libraries      enable row level security;
alter table public.moderation_cases    enable row level security;
alter table public.reviews_reports     enable row level security;
alter table public.sandbox_test_runs   enable row level security;

-- Supabase gives every new table to anon and authenticated: take it all back, then hand out reading, and
-- writing only the columns people own. Status, counters, roles and scores are written by the functions below.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
revoke select on public.users, public.games from anon, authenticated;   -- not their trust and report scores
grant select (id, handle, display_name, avatar_url, bio, role, developer_verified_at, followers_count,
              following_count, created_at) on public.users to anon, authenticated;
grant select (id, slug, owner_id, title, description, source, source_url, made_with, mechanic_version_id,
              current_version_id, visibility, status, orientation, thumbnail_url, og_image_url, tags,
              likes_count, plays_count, search, published_at, created_at, updated_at) on public.games to anon, authenticated;
grant insert (id, handle, display_name, avatar_url, bio) on public.users to authenticated;
grant update (handle, display_name, avatar_url, bio) on public.users to authenticated;
grant update (title, description, visibility, orientation, thumbnail_url, tags) on public.games to authenticated;
grant delete on public.games to authenticated;
grant insert, delete on public.follows, public.user_libraries to authenticated;
grant insert, update, delete on public.game_saves to authenticated;
grant insert (kind, game_id, game_version_id, mechanic_version_id, asset_id, reported_user_id,
              reporter_id, reason, details, evidence) on public.reviews_reports to authenticated;
grant insert (owner_id, pack_id, kind, name, file_hash, mime, bytes, meta, tags, roles, license, attribution)
  on public.assets to authenticated;
grant insert (mechanic_id, semver, manifest, changelog) on public.mechanic_versions to authenticated;
grant update (manifest, changelog) on public.mechanic_versions to authenticated;
grant insert (key, author_id, name, family, summary) on public.mechanics to authenticated;
-- Games are created through publish_studio_game and publish_link_game, which check what's in them.

create policy users_read   on public.users for select using (true);
create policy users_insert on public.users for insert to authenticated with check (id = (select auth.uid()));
create policy users_update on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy games_read on public.games for select using (
  (visibility <> 'private' and status in ('published', 'flagged'))
  or owner_id = (select auth.uid()) or (select public.is_moderator()));
create policy games_update on public.games for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy games_delete on public.games for delete to authenticated using (owner_id = (select auth.uid()));

create policy versions_read on public.game_versions for select using (
  exists (select 1 from public.games g where g.id = game_id));   -- visible when its game is
create policy version_assets_read on public.game_version_assets for select using (
  exists (select 1 from public.game_versions v where v.id = game_version_id));

create policy saves_own on public.game_saves for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy stats_owner on public.game_daily_stats for select using (
  exists (select 1 from public.games g where g.id = game_id and g.owner_id = (select auth.uid()))
  or (select public.is_moderator()));

create policy follows_read   on public.follows for select using (true);
create policy follows_write  on public.follows for insert to authenticated with check (follower_id = (select auth.uid()));
create policy follows_delete on public.follows for delete to authenticated using (follower_id = (select auth.uid()));

create policy libraries_own_read   on public.user_libraries for select to authenticated using (user_id = (select auth.uid()));
create policy libraries_own_write  on public.user_libraries for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.games g where g.id = game_id));   -- games they can see
create policy libraries_own_delete on public.user_libraries for delete to authenticated using (user_id = (select auth.uid()));

create policy assets_read on public.assets for select using (
  is_public or owner_id = (select auth.uid()) or (select public.is_moderator()));
create policy assets_insert on public.assets for insert to authenticated with check (owner_id = (select auth.uid()));
create policy packs_read on public.asset_packs for select using (
  is_public or owner_id = (select auth.uid()) or (select public.is_moderator()));

create policy mechanics_read on public.mechanics for select using (
  latest_version_id is not null or author_id = (select auth.uid()) or (select public.is_moderator()));
create policy mechanics_insert on public.mechanics for insert to authenticated with check (
  author_id = (select auth.uid())
  and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.developer_verified_at is not null));
create policy mech_versions_read on public.mechanic_versions for select using (
  status in ('published', 'deprecated')
  or exists (select 1 from public.mechanics m where m.id = mechanic_id and m.author_id = (select auth.uid()))
  or (select public.is_moderator()));
create policy mech_versions_insert on public.mechanic_versions for insert to authenticated with check (
  exists (select 1 from public.mechanics m where m.id = mechanic_id and m.author_id = (select auth.uid())));
create policy mech_versions_edit on public.mechanic_versions for update to authenticated using (
  status in ('draft', 'changes_requested')
  and exists (select 1 from public.mechanics m where m.id = mechanic_id and m.author_id = (select auth.uid())));
-- A version moves past draft only through transition_mechanic_version.

create policy reports_file on public.reviews_reports for insert to authenticated with check (
  kind = 'player_report' and reporter_id = (select auth.uid()));
create policy reports_read on public.reviews_reports for select using (
  reporter_id = (select auth.uid()) or (select public.is_moderator()));
create policy cases_read on public.moderation_cases for select using ((select public.is_moderator()));
create policy test_runs_read on public.sandbox_test_runs for select using (
  (select public.is_moderator())
  or exists (select 1 from public.mechanic_versions v join public.mechanics m on m.id = v.mechanic_id
             where v.id = mechanic_version_id and m.author_id = (select auth.uid()))
  or exists (select 1 from public.game_versions v join public.games g on g.id = v.game_id
             where v.id = game_version_id and g.owner_id = (select auth.uid())));

-- MECHANIC STATUS CHANGES: the only way a version moves past draft
create function public.transition_mechanic_version(version_id uuid, to_status public.mechanic_status, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v         record;
  is_author boolean;
  is_mod    boolean := public.is_moderator();
  is_svc    boolean := public.is_service();
begin
  select mv.status, mv.mechanic_id, m.author_id into v
    from public.mechanic_versions mv join public.mechanics m on m.id = mv.mechanic_id
   where mv.id = version_id for update of mv;
  if not found then raise exception 'no such mechanic version'; end if;
  is_author := v.author_id is not distinct from auth.uid() and auth.uid() is not null;

  if not (
       (v.status in ('draft', 'changes_requested', 'test_failed') and to_status = 'submitted' and is_author)
    or (v.status = 'submitted'  and to_status = 'testing'                          and is_svc)   -- the test runner
    or (v.status = 'testing'    and to_status in ('in_review', 'test_failed')      and is_svc)
    or (v.status = 'in_review'  and to_status in ('approved', 'changes_requested') and is_mod and not is_author)
    or (v.status = 'approved'   and to_status = 'published'                        and (is_author or is_mod))
    or (v.status = 'published'  and to_status = 'deprecated'                       and (is_author or is_mod))
    or (v.status = 'published'  and to_status = 'suspended'                        and (is_mod or is_svc))   -- automatic flag
    or (v.status = 'suspended'  and to_status = 'in_review'                        and is_mod)
  ) then
    raise exception 'mechanic version cannot go from % to % for this user', v.status, to_status;
  end if;

  update public.mechanic_versions set
    status       = to_status,
    submitted_at = case when to_status = 'submitted' then now() else submitted_at end,
    reviewed_by  = case when to_status in ('approved', 'changes_requested') then auth.uid() else reviewed_by end,
    reviewed_at  = case when to_status in ('approved', 'changes_requested') then now() else reviewed_at end,
    published_at = case when to_status = 'published' then now() else published_at end
  where id = version_id;

  if to_status = 'published' then
    update public.mechanics set latest_version_id = version_id where id = v.mechanic_id;
  end if;
  if to_status in ('approved', 'changes_requested') then
    insert into public.reviews_reports (kind, mechanic_version_id, reporter_id, details, decision)
    values ('review', version_id, auth.uid(), note, case when to_status = 'approved' then 'approve' else 'request_changes' end);
  end if;
end $$;

-- PUBLISHING
-- A share-link slug from a name: 'Barnyard Merge' -> 'barnyard-merge-3f9a1c'
create function public.make_slug(name text) returns text language sql volatile set search_path = '' as $$
  select coalesce(nullif(trim(both '-' from left(regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g'), 40)), ''), 'game')
         || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
$$;

-- Which AI made a link's game: 'claude', 'gemini', 'kimi', or null for any other site (as js/runtime.js
-- tells them apart). Only https, and no user name or port in the address.
create function public.link_source(url text) returns text language sql immutable set search_path = '' as $$
  select case
    when host is null then null
    when host ~ '(^|\.)(claude\.ai|claude\.site|claude\.com|claudeusercontent\.com)$' then 'claude'
    when host ~ '(^|\.)(gemini\.google\.com|gemini\.google|aistudio\.google\.com)$'
      or (host = 'g.co' and path like '/gemini%') then 'gemini'
    when host ~ '(^|\.)(kimi\.com|kimi\.ai|moonshot\.cn)$' then 'kimi'
  end
  from (select case when a ~ '^[a-z0-9.-]+$' then a end as host, p as path
          from (select lower(substring(url from '^https://([^/?#]*)')) as a,
                       coalesce(substring(url from '^https://[^/?#]*(/[^?#]*)'), '/') as p) parts) u
$$;

create function public.check_can_publish(me uuid, name text) returns text language plpgsql stable set search_path = '' as $$
declare clean text := btrim(coalesce(name, ''));
begin
  if me is null then raise exception 'Sign in to publish' using errcode = '42501'; end if;
  if not exists (select 1 from public.users u where u.id = me) then
    raise exception 'Pick a name before you publish' using errcode = 'P0001', hint = 'profile';
  end if;
  if char_length(clean) not between 1 and 80 then raise exception 'Give the game a name (up to 80 letters)'; end if;
  if (select count(*) from public.game_versions v join public.games g on g.id = v.game_id
       where g.owner_id = me and v.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You have published a lot in the last hour. Try again later.';
  end if;
  return clean;
end $$;

-- Publishes a Creator Studio game to everyone, or a new version of one of yours (game = its id).
-- A Studio game is only data (mechanic, settings, look, rules), which the runtime checks again when it plays.
create function public.publish_studio_game(spec jsonb, name text, blurb text default null, game uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     uuid := auth.uid();
  clean  text;
  mv     uuid;
  g      public.games%rowtype;
  next_v int := 1;
  ver    uuid;
  tries  int := 0;
begin
  clean := public.check_can_publish(me, name);
  if jsonb_typeof(spec) is distinct from 'object' or spec ->> 'spec' is distinct from '1'
     or jsonb_typeof(spec -> 'mechanic') is distinct from 'object' then
    raise exception 'That is not a Creator Studio game';
  end if;
  if octet_length(spec::text) > 8192 then raise exception 'This game is too big to publish'; end if;
  if char_length(blurb) > 200 then raise exception 'The description is too long'; end if;

  select coalesce((select v.id from public.mechanic_versions v
                    where v.mechanic_id = m.id and v.semver = spec -> 'mechanic' ->> 'version' and v.status = 'published'),
                  m.latest_version_id)
    into mv from public.mechanics m where m.key = spec -> 'mechanic' ->> 'key';
  if mv is null then raise exception 'Unknown game type: %', spec -> 'mechanic' ->> 'key'; end if;

  if game is null then
    loop
      begin
        insert into public.games (slug, owner_id, title, description, source, made_with, mechanic_version_id,
                                  visibility, status, published_at)
        values (public.make_slug(clean), me, clean, blurb, 'studio', 'studio', mv, 'public', 'published', now())
        returning * into g;
        exit;
      exception when unique_violation then
        tries := tries + 1;
        if tries > 5 then raise; end if;
      end;
    end loop;
  else
    select * into g from public.games x where x.id = game and x.owner_id = me for update;
    if not found or g.source <> 'studio' then raise exception 'That game is not yours to change'; end if;
    if g.status in ('quarantined', 'removed') then raise exception 'This game was taken down, so it can''t be changed'; end if;
    select coalesce(max(v.version), 0) + 1 into next_v from public.game_versions v where v.game_id = g.id;
  end if;

  insert into public.game_versions (game_id, version, format, spec, bundle_bytes)
  values (g.id, next_v, 'studio', spec, octet_length(spec::text)) returning id into ver;
  update public.games x set current_version_id = ver, title = clean, description = coalesce(blurb, x.description),
         mechanic_version_id = mv, updated_at = now()
   where x.id = g.id;
  return jsonb_build_object('id', g.id, 'slug', g.slug, 'version', next_v);
end $$;

-- Shares a Claude, Gemini or Kimi link with everyone. The same link twice gives back the same game.
create function public.publish_link_game(url text, name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  clean text;
  src   text := public.link_source(url);
  g     public.games%rowtype;
  ver   uuid;
  tries int := 0;
begin
  clean := public.check_can_publish(me, name);
  if src is null or char_length(url) > 500 or url ~ '\s' then
    raise exception 'Only Claude, Gemini and Kimi links can be shared with everyone for now';
  end if;
  select * into g from public.games x
   where x.source = 'link_card' and x.source_url = url
     and (x.owner_id = me or (x.visibility <> 'private' and x.status in ('published', 'flagged')))
   order by (x.owner_id = me) desc limit 1;
  if found then
    if g.owner_id <> me then raise exception 'Someone already shared this game: it''s in the feed'; end if;
    return jsonb_build_object('id', g.id, 'slug', g.slug, 'version', 1);
  end if;
  loop
    begin
      insert into public.games (slug, owner_id, title, source, source_url, made_with, visibility, status, published_at)
      values (public.make_slug(clean), me, clean, 'link_card', url, src, 'public', 'published', now())
      returning * into g;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
  insert into public.game_versions (game_id, version, format) values (g.id, 1, 'link') returning id into ver;
  update public.games x set current_version_id = ver where x.id = g.id;
  return jsonb_build_object('id', g.id, 'slug', g.slug, 'version', 1);
end $$;

-- REPORTS: a player's report counts as much as their trust score; open reports adding up to 3 take a game
-- out of the feed until someone reviews it, and every report joins the open case for its game.
create function public.report_weight() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'player_report' then
    new.weight := coalesce((select u.trust_score from public.users u where u.id = new.reporter_id), 1);
  end if;
  return new;
end $$;
create trigger reviews_reports_weight before insert on public.reviews_reports
  for each row execute function public.report_weight();

create function public.report_tally() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  total real;
  q     text;
  c     bigint;
begin
  if new.kind <> 'player_report' or new.game_id is null then return null; end if;
  select coalesce(sum(r.weight), 0) into total from public.reviews_reports r
   where r.game_id = new.game_id and r.kind = 'player_report' and r.status = 'open';
  q := case when new.reason in ('malicious', 'phishing') then 'security'
            when new.reason = 'ip_infringement' then 'ip'
            when new.reason in ('broken', 'crashes', 'performance') then 'broken'
            else 'content' end;
  select mc.id into c from public.moderation_cases mc
   where mc.game_id = new.game_id and mc.queue = q and mc.status <> 'resolved';
  if c is null then
    insert into public.moderation_cases (game_id, queue, priority, score)
    values (new.game_id, q, case when q = 'security' then 1 else 3 end, total) returning id into c;
  else
    update public.moderation_cases set score = total where id = c;
  end if;
  update public.reviews_reports set case_id = c where id = new.id;
  update public.games set report_score = total,
         status = case when total >= 3 and status in ('published', 'flagged') then 'quarantined'::public.game_status
                       else status end
   where id = new.game_id;
  return null;
end $$;
create trigger reviews_reports_tally after insert on public.reviews_reports
  for each row execute function public.report_tally();

-- ACCOUNTS: deleting yours removes your profile, your games, likes, follows and saves
create function public.delete_my_account() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- Who may call what. Supabase lets everyone call new functions, so close them first.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_service(), public.is_moderator(), public.make_slug(text), public.link_source(text)
  to anon, authenticated, service_role;
grant execute on function public.transition_mechanic_version(uuid, public.mechanic_status, text),
                          public.publish_studio_game(jsonb, text, text, uuid),
                          public.publish_link_game(text, text),
                          public.delete_my_account()
  to authenticated, service_role;
grant execute on function public.check_can_publish(uuid, text) to service_role;
