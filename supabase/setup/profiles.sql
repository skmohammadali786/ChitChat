-- ChitChat profile schema
-- Run once in the SQL Editor of the dedicated ChitChat Supabase project.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  bio text not null default '',
  avatar_url text,
  discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length
    check (char_length(display_name) between 2 and 40),
  constraint profiles_bio_length
    check (char_length(bio) <= 160)
);

alter table public.profiles
  add column if not exists discoverable boolean not null default true;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));

-- Store discovery rate-limit events in a schema that is not exposed through
-- Supabase's public Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.profile_search_events (
  id bigint generated always as identity primary key,
  requester_id uuid not null references auth.users (id) on delete cascade,
  searched_at timestamptz not null default now()
);

create index if not exists profile_search_events_requester_time_idx
  on private.profile_search_events (requester_id, searched_at desc);

alter table private.profile_search_events enable row level security;

create or replace function public.lookup_profile_by_username(search_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text
)
language plpgsql
security definer
set search_path = ''
as $
declare
  v_requester_id uuid := auth.uid();
  v_normalized_username text := lower(trim(search_username));
  v_recent_searches integer;
begin
  if v_requester_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_normalized_username is null
     or char_length(v_normalized_username) < 3
     or char_length(v_normalized_username) > 20
     or v_normalized_username !~ '^[a-z0-9_]+

alter table public.profiles enable row level security;

-- Do not expose profile rows to anonymous clients.
revoke all on table public.profiles from anon, public;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
 then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_requester_id::text, 1)
  );

  delete from private.profile_search_events
   where profile_search_events.requester_id = v_requester_id
     and profile_search_events.searched_at < now() - interval '1 minute';

  select pg_catalog.count(*)::integer
    into v_recent_searches
  from private.profile_search_events as search_event
  where search_event.requester_id = v_requester_id;

  if v_recent_searches >= 20 then
    raise exception 'Too many username lookups. Try again in a minute.'
      using errcode = 'P0001';
  end if;

  insert into private.profile_search_events (requester_id)
  values (v_requester_id);

  return query
    select profile_row.id, profile_row.username, profile_row.display_name, profile_row.avatar_url
    from public.profiles as profile_row
    where lower(profile_row.username) = v_normalized_username
      and profile_row.discoverable = true
      and profile_row.id <> v_requester_id
    limit 1;
end;
$;

revoke all on function public.lookup_profile_by_username(text) from public, anon;
grant execute on function public.lookup_profile_by_username(text) to authenticated;

alter table public.profiles enable row level security;

-- Do not expose profile rows to anonymous clients.
revoke all on table public.profiles from anon, public;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
