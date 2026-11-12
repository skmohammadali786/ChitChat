-- ChitChat profile schema. Mirrors the deployed Supabase project.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  bio text not null default '',
  avatar_path text,
  discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check(username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length check(char_length(display_name) between 2 and 40),
  constraint profiles_bio_length check(char_length(bio)<=160)
);

create unique index if not exists profiles_username_lower_unique on public.profiles(lower(username));
create index if not exists profiles_discoverable_username_idx on public.profiles(lower(username)) where discoverable;

alter table public.profiles enable row level security;
revoke all on table public.profiles from public,anon;
grant select,insert,update on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using((select auth.uid())=id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated with check((select auth.uid())=id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;

create table if not exists private.profile_search_events(
  id bigint generated always as identity primary key,
  requester_id uuid not null references auth.users(id) on delete cascade,
  searched_at timestamptz not null default now()
);
create index if not exists profile_search_events_requester_time_idx on private.profile_search_events(requester_id,searched_at desc);
alter table private.profile_search_events enable row level security;
drop policy if exists profile_search_events_no_client_access on private.profile_search_events;
create policy profile_search_events_no_client_access on private.profile_search_events for all to anon,authenticated using(false) with check(false);

create or replace function private.is_blocked_between(other_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from public.user_blocks b
  where (b.blocker_id=auth.uid() and b.blocked_id=other_user_id)
     or (b.blocker_id=other_user_id and b.blocked_id=auth.uid())
 );
$$;
revoke all on function private.is_blocked_between(uuid) from public,anon,authenticated;
grant execute on function private.is_blocked_between(uuid) to authenticated;

create or replace function private.lookup_profile_by_username_impl(search_username text)
returns table(id uuid,username text,display_name text,avatar_path text)
language plpgsql security definer set search_path=''
as $$
declare
  v_me uuid:=auth.uid();
  v_username text:=lower(trim(search_username));
  v_count integer;
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if v_username is null or v_username !~ '^[a-z0-9_]{3,20}$' then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_me::text,1));
  delete from private.profile_search_events e
   where e.requester_id=v_me and e.searched_at<now()-interval '1 minute';

  select count(*)::integer into v_count from private.profile_search_events e where e.requester_id=v_me;
  if v_count>=20 then raise exception 'Too many username lookups. Try again in a minute.' using errcode='P0001'; end if;
  insert into private.profile_search_events(requester_id) values(v_me);

  return query
    select p.id,p.username,p.display_name,p.avatar_path
    from public.profiles p
    where lower(p.username)=v_username and p.discoverable
      and p.id<>v_me and not private.is_blocked_between(p.id)
    limit 1;
end;
$$;
revoke all on function private.lookup_profile_by_username_impl(text) from public,anon,authenticated;
grant execute on function private.lookup_profile_by_username_impl(text) to authenticated;

create or replace function public.lookup_profile_by_username(search_username text)
returns table(id uuid,username text,display_name text,avatar_path text)
language sql stable security invoker set search_path=''
as $$ select * from private.lookup_profile_by_username_impl(search_username); $$;
revoke all on function public.lookup_profile_by_username(text) from public,anon;
grant execute on function public.lookup_profile_by_username(text) to authenticated;
