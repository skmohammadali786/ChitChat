-- ChitChat messaging foundation
-- Run only in the dedicated ChitChat Supabase project after profiles.sql.
-- Message bodies are represented by ciphertext + nonce. Do not add plaintext
-- message columns or write plaintext content into crypto_header.

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
    and public.is_conversation_member(conversation_id)
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
    select 1 from public.profiles as profile_row where profile_row.id = target_user_id
  ) then
    raise exception 'That profile does not exist' using errcode = 'P0002';
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
as $
begin
  update public.conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$;

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
  other_avatar_url text
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
      other_profile.avatar_url
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
