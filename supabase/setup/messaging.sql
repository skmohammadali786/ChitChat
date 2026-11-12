-- ChitChat messaging foundation
-- Run only in the dedicated ChitChat Supabase project after profiles.sql.
-- Message bodies are represented by ciphertext + nonce. Do not add plaintext
-- message columns or write plaintext content into crypto_header.


-- User blocks are private edges. A block affects exact username discovery
-- and prevents new direct-message delivery in either direction.
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;
revoke all on table public.user_blocks from anon, public;
grant select, insert, delete on table public.user_blocks to authenticated;

drop policy if exists "user_blocks_read_own" on public.user_blocks;
create policy "user_blocks_read_own"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own"
  on public.user_blocks for insert to authenticated
  with check (
    blocker_id = (select auth.uid())
    and blocked_id <> (select auth.uid())
  );

drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own"
  on public.user_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  created_by uuid not null references auth.users (id) on delete restrict,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_title_length
    check (title is null or char_length(title) between 1 and 80)
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete restrict,
  client_message_id uuid not null,
  message_type text not null check (message_type in ('text', 'image', 'video', 'audio', 'file', 'system')),
  ciphertext text not null check (char_length(ciphertext) between 1 and 1000000),
  nonce text not null check (char_length(nonce) between 1 and 256),
  crypto_header jsonb not null default '{}'::jsonb,
  key_version integer not null check (key_version > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint messages_idempotency unique (sender_id, client_message_id)
);

create index if not exists conversations_updated_at_idx
  on public.conversations (updated_at desc);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, joined_at desc);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create index if not exists messages_expiry_idx
  on public.messages (expires_at)
  where expires_at is not null;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- The helper functions below are SECURITY DEFINER because membership checks
-- must not recurse through the conversation_members RLS policy. Their
-- EXECUTE grants are revoked from PUBLIC and anon, and granted only to
-- authenticated users. Both functions validate auth.uid().

create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.conversation_members as member_row
      where member_row.conversation_id = target_conversation_id
        and member_row.user_id = auth.uid()
    );
$$;

revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;


create or replace function public.is_direct_conversation_blocked(
  target_conversation_id uuid,
  candidate_sender_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is null
    or auth.uid() <> candidate_sender_id
    or not public.is_conversation_member(target_conversation_id)
    or exists (
      select 1
      from public.conversations as conversation_row
      join public.conversation_members as other_member
        on other_member.conversation_id = conversation_row.id
       and other_member.user_id <> candidate_sender_id
      join public.user_blocks as block_row
        on (
          block_row.blocker_id = candidate_sender_id
          and block_row.blocked_id = other_member.user_id
        ) or (
          block_row.blocker_id = other_member.user_id
          and block_row.blocked_id = candidate_sender_id
        )
      where conversation_row.id = target_conversation_id
        and conversation_row.kind = 'direct'
    );
$$;
revoke all on function public.is_direct_conversation_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_direct_conversation_blocked(uuid, uuid) to authenticated;

drop policy if exists "conversations_read_members" on public.conversations;
create policy "conversations_read_members"
  on public.conversations
  for select
  to authenticated
  using (public.is_conversation_member(id));

drop policy if exists "conversations_update_creator" on public.conversations;
create policy "conversations_update_creator"
  on public.conversations
  for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy if exists "conversation_members_read_members" on public.conversation_members;
create policy "conversation_members_read_members"
  on public.conversation_members
  for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "conversation_members_update_own_read_state" on public.conversation_members;
create policy "conversation_members_update_own_read_state"
  on public.conversation_members
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "messages_read_members" on public.messages;
create policy "messages_read_members"
  on public.messages
  for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "messages_insert_as_self_member" on public.messages;
create policy "messages_insert_as_self_member"
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and message_type <> 'system'
    and public.is_conversation_member(conversation_id)
    and not public.is_direct_conversation_blocked(conversation_id, sender_id)
  );

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
  on public.messages
  for delete
  to authenticated
  using (sender_id = (select auth.uid()));

-- Least-privilege Data API access. RLS still decides which rows are visible.
grant usage on schema public to authenticated;
revoke all on table public.conversations, public.conversation_members, public.messages from anon, public;
grant select on table public.conversations to authenticated;
grant update (title) on table public.conversations to authenticated;
grant select on table public.conversation_members to authenticated;
grant update (last_read_at) on table public.conversation_members to authenticated;
grant select, delete on table public.messages to authenticated;
grant insert (
  conversation_id,
  sender_id,
  client_message_id,
  message_type,
  ciphertext,
  nonce,
  crypto_header,
  key_version,
  expires_at
) on table public.messages to authenticated;

create or replace function public.create_direct_conversation(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_conversation_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if target_user_id is null or target_user_id = caller_id then
    raise exception 'Choose another valid user' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as profile_row
    where profile_row.id = target_user_id
      and profile_row.discoverable = true
  ) then
    raise exception 'That account is not available for username discovery' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.user_blocks as block_row
    where (block_row.blocker_id = caller_id and block_row.blocked_id = target_user_id)
       or (block_row.blocker_id = target_user_id and block_row.blocked_id = caller_id)
  ) then
    raise exception 'This conversation is not available' using errcode = '42501';
  end if;

  -- Serialize direct-chat creation for the same pair to avoid duplicate DMs.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(caller_id::text, target_user_id::text)
      || ':' ||
      greatest(caller_id::text, target_user_id::text),
      0
    )
  );

  select conversation_row.id
    into new_conversation_id
  from public.conversations as conversation_row
  join public.conversation_members as caller_member
    on caller_member.conversation_id = conversation_row.id
   and caller_member.user_id = caller_id
  join public.conversation_members as target_member
    on target_member.conversation_id = conversation_row.id
   and target_member.user_id = target_user_id
  where conversation_row.kind = 'direct'
    and (
      select pg_catalog.count(*)
      from public.conversation_members as all_members
      where all_members.conversation_id = conversation_row.id
    ) = 2
  limit 1;

  if new_conversation_id is not null then
    return new_conversation_id;
  end if;

  insert into public.conversations (kind, created_by)
  values ('direct', caller_id)
  returning id into new_conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values
    (new_conversation_id, caller_id, 'owner'),
    (new_conversation_id, target_user_id, 'member');

  return new_conversation_id;
end;
$$;

revoke all on function public.create_direct_conversation(uuid) from public, anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;


-- Bump a conversation's ordering timestamp only after an authorized message
-- insert. The trigger function is not directly executable by app roles.
create or replace function public.touch_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;
revoke all on function public.touch_conversation_after_message() from public, anon, authenticated;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_after_message();

-- Enable INSERT events for Supabase Realtime exactly once.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;


-- Return only conversations the current authenticated account belongs to.
-- For direct chats, expose the other member's safe profile fields. Group
-- member listing will be added with the group membership controls.
create or replace function public.list_my_conversations()
returns table (
  conversation_id uuid,
  conversation_kind text,
  conversation_title text,
  updated_at timestamptz,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requester_id uuid := auth.uid();
begin
  if v_requester_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
    select
      conversation_row.id,
      conversation_row.kind,
      conversation_row.title,
      conversation_row.updated_at,
      other_member.user_id,
      other_profile.username,
      other_profile.display_name,
      other_profile.avatar_path
    from public.conversations as conversation_row
    join public.conversation_members as my_membership
      on my_membership.conversation_id = conversation_row.id
     and my_membership.user_id = v_requester_id
    left join lateral (
      select member_row.user_id
      from public.conversation_members as member_row
      where member_row.conversation_id = conversation_row.id
        and member_row.user_id <> v_requester_id
      order by member_row.joined_at asc
      limit 1
    ) as other_member on true
    left join public.profiles as other_profile
      on other_profile.id = other_member.user_id
    order by conversation_row.updated_at desc
    limit 200;
end;
$$;

revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;


-- Extend the existing exact-username lookup to hide blocked pairs in both
-- directions. This remains a narrow result set with a per-user rate limit.
create or replace function public.lookup_profile_by_username(search_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_path text
)
language plpgsql
security definer
set search_path = ''
as $$
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
     or v_normalized_username !~ '^[a-z0-9_]{3,20}$' then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_requester_id::text, 1)
  );

  delete from private.profile_search_events as search_event
   where search_event.requester_id = v_requester_id
     and search_event.searched_at < now() - interval '1 minute';

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
    select profile_row.id, profile_row.username, profile_row.display_name, profile_row.avatar_path
    from public.profiles as profile_row
    where lower(profile_row.username) = v_normalized_username
      and profile_row.discoverable = true
      and profile_row.id <> v_requester_id
      and not exists (
        select 1
        from public.user_blocks as block_row
        where (block_row.blocker_id = v_requester_id and block_row.blocked_id = profile_row.id)
           or (block_row.blocker_id = profile_row.id and block_row.blocked_id = v_requester_id)
      )
    limit 1;
end;
$$;

revoke all on function public.lookup_profile_by_username(text) from public, anon;
grant execute on function public.lookup_profile_by_username(text) to authenticated;

create or replace function public.list_my_blocks()
returns table (
  blocked_id uuid,
  username text,
  display_name text,
  avatar_path text,
  blocked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requester_id uuid := auth.uid();
begin
  if v_requester_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
    select
      block_row.blocked_id,
      profile_row.username,
      profile_row.display_name,
      profile_row.avatar_path,
      block_row.created_at
    from public.user_blocks as block_row
    left join public.profiles as profile_row
      on profile_row.id = block_row.blocked_id
    where block_row.blocker_id = v_requester_id
    order by block_row.created_at desc
    limit 200;
end;
$$;

revoke all on function public.list_my_blocks() from public, anon;
grant execute on function public.list_my_blocks() to authenticated;
