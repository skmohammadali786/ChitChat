-- Group invitations. Invitations are private workflow records; membership is
-- created only by the invitee accepting through a server-authorized RPC.

create table if not exists public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  responded_at timestamptz,
  constraint group_invitation_not_self check (inviter_id <> invitee_id)
);

create unique index if not exists group_invitations_one_pending_per_user
  on public.group_invitations(conversation_id, invitee_id)
  where status='pending';
create index if not exists group_invitations_inbox_idx
  on public.group_invitations(invitee_id, created_at desc)
  where status='pending';
create index if not exists group_invitations_group_idx
  on public.group_invitations(conversation_id, created_at desc)
  where status='pending';

alter table public.group_invitations enable row level security;
revoke all on public.group_invitations from public, anon, authenticated;

create or replace function private.create_group_invitation_impl(
  target_conversation_id uuid,
  target_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_existing uuid;
  v_invitation_id uuid;
  v_members integer;
  v_pending integer;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_conversation_id is null or target_user_id is null or target_user_id=v_me then
    raise exception 'Choose a valid group member to invite.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.conversations
    where id=target_conversation_id and kind='group'
  ) then
    raise exception 'Group not found.' using errcode='P0002';
  end if;
  if not private.is_group_admin(target_conversation_id) then
    raise exception 'Only group owners and admins can invite members.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=target_user_id and discoverable=true
  ) then
    raise exception 'This account is not accepting username invitations.' using errcode='P0002';
  end if;
  if private.is_blocked_between(target_user_id) then
    raise exception 'You cannot invite an account blocked by either side.' using errcode='42501';
  end if;
  if exists (
    select 1 from public.conversation_members
    where conversation_id=target_conversation_id and user_id=target_user_id
  ) then
    raise exception 'This account is already a group member.' using errcode='23505';
  end if;

  select id into v_existing
    from public.group_invitations
    where conversation_id=target_conversation_id
      and invitee_id=target_user_id
      and status='pending'
      and expires_at>now()
    limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select count(*) into v_members
    from public.conversation_members
    where conversation_id=target_conversation_id;
  select count(*) into v_pending
    from public.group_invitations
    where conversation_id=target_conversation_id
      and status='pending'
      and expires_at>now();
  if v_members + v_pending >= 100 then
    raise exception 'This group has reached its 100 member and invitation limit.' using errcode='22023';
  end if;

  insert into public.group_invitations(conversation_id,inviter_id,invitee_id)
    values(target_conversation_id,v_me,target_user_id)
    on conflict (conversation_id,invitee_id) where status='pending'
    do nothing
    returning id into v_invitation_id;

  if v_invitation_id is null then
    select id into v_invitation_id
      from public.group_invitations
      where conversation_id=target_conversation_id
        and invitee_id=target_user_id
        and status='pending'
      limit 1;
  end if;
  return v_invitation_id;
end;
$$;

revoke all on function private.create_group_invitation_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.create_group_invitation_impl(uuid,uuid) to authenticated;

create or replace function public.create_group_invitation(
  target_conversation_id uuid,
  target_user_id uuid
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_group_invitation_impl(target_conversation_id,target_user_id);
$$;
revoke all on function public.create_group_invitation(uuid,uuid) from public,anon;
grant execute on function public.create_group_invitation(uuid,uuid) to authenticated;

create or replace function private.list_group_invitations_impl(target_conversation_id uuid)
returns table(
  invitation_id uuid,
  invitee_id uuid,
  invitee_username text,
  invitee_display_name text,
  status text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if not private.is_group_admin(target_conversation_id) then
    raise exception 'Only group owners and admins can view pending invitations.' using errcode='42501';
  end if;

  return query
    select gi.id,gi.invitee_id,p.username,p.display_name,gi.status,gi.created_at,gi.expires_at
    from public.group_invitations gi
    join public.profiles p on p.id=gi.invitee_id
    where gi.conversation_id=target_conversation_id
      and gi.status='pending'
      and gi.expires_at>now()
    order by gi.created_at desc;
end;
$$;
revoke all on function private.list_group_invitations_impl(uuid) from public,anon,authenticated;
grant execute on function private.list_group_invitations_impl(uuid) to authenticated;

create or replace function public.list_group_invitations(target_conversation_id uuid)
returns table(
  invitation_id uuid,
  invitee_id uuid,
  invitee_username text,
  invitee_display_name text,
  status text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
security invoker
set search_path=''
as $$
  select * from private.list_group_invitations_impl(target_conversation_id);
$$;
revoke all on function public.list_group_invitations(uuid) from public,anon;
grant execute on function public.list_group_invitations(uuid) to authenticated;

create or replace function private.list_my_group_invitations_impl()
returns table(
  invitation_id uuid,
  conversation_id uuid,
  conversation_title text,
  inviter_id uuid,
  inviter_username text,
  inviter_display_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;

  return query
    select gi.id,gi.conversation_id,c.title,gi.inviter_id,p.username,p.display_name,gi.created_at,gi.expires_at
    from public.group_invitations gi
    join public.conversations c on c.id=gi.conversation_id and c.kind='group'
    join public.profiles p on p.id=gi.inviter_id
    where gi.invitee_id=auth.uid()
      and gi.status='pending'
      and gi.expires_at>now()
    order by gi.created_at desc;
end;
$$;
revoke all on function private.list_my_group_invitations_impl() from public,anon,authenticated;
grant execute on function private.list_my_group_invitations_impl() to authenticated;

create or replace function public.list_my_group_invitations()
returns table(
  invitation_id uuid,
  conversation_id uuid,
  conversation_title text,
  inviter_id uuid,
  inviter_username text,
  inviter_display_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
security invoker
set search_path=''
as $$
  select * from private.list_my_group_invitations_impl();
$$;
revoke all on function public.list_my_group_invitations() from public,anon;
grant execute on function public.list_my_group_invitations() to authenticated;

create or replace function private.respond_group_invitation_impl(
  target_invitation_id uuid,
  accept_invitation boolean
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_invitation public.group_invitations%rowtype;
  v_members integer;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_invitation_id is null or accept_invitation is null then
    raise exception 'An invitation and response are required.' using errcode='22023';
  end if;

  select * into v_invitation
    from public.group_invitations
    where id=target_invitation_id and invitee_id=v_me
    for update;
  if not found then
    raise exception 'Invitation not found.' using errcode='P0002';
  end if;
  if v_invitation.status<>'pending' then
    raise exception 'This invitation is no longer pending.' using errcode='22023';
  end if;
  if v_invitation.expires_at<=now() then
    update public.group_invitations
      set status='expired',responded_at=now()
      where id=target_invitation_id;
    return 'expired';
  end if;

  if not accept_invitation then
    update public.group_invitations
      set status='declined',responded_at=now()
      where id=target_invitation_id;
    return 'declined';
  end if;

  if not exists (
    select 1 from public.conversations
    where id=v_invitation.conversation_id and kind='group'
  ) then
    update public.group_invitations
      set status='expired',responded_at=now()
      where id=target_invitation_id;
    return 'expired';
  end if;

  select count(*) into v_members
    from public.conversation_members
    where conversation_id=v_invitation.conversation_id;
  if v_members>=100 then
    raise exception 'This group is full.' using errcode='22023';
  end if;
  if private.is_blocked_between(v_invitation.inviter_id) then
    raise exception 'You cannot join a group through an invitation from a blocked account.' using errcode='42501';
  end if;
  if exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id=v_invitation.conversation_id
      and private.is_blocked_between(cm.user_id)
  ) then
    raise exception 'This group contains an account blocked by either side.' using errcode='42501';
  end if;

  insert into public.conversation_members(conversation_id,user_id,role)
    values(v_invitation.conversation_id,v_me,'member')
    on conflict(conversation_id,user_id) do nothing;
  update public.group_invitations
    set status='accepted',responded_at=now()
    where id=target_invitation_id;
  update public.conversations
    set updated_at=now()
    where id=v_invitation.conversation_id;
  return 'accepted';
end;
$$;
revoke all on function private.respond_group_invitation_impl(uuid,boolean) from public,anon,authenticated;
grant execute on function private.respond_group_invitation_impl(uuid,boolean) to authenticated;

create or replace function public.respond_group_invitation(
  target_invitation_id uuid,
  accept_invitation boolean
)
returns text
language sql
security invoker
set search_path=''
as $$
  select private.respond_group_invitation_impl(target_invitation_id,accept_invitation);
$$;
revoke all on function public.respond_group_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_group_invitation(uuid,boolean) to authenticated;

create or replace function private.revoke_group_invitation_impl(target_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  select conversation_id into v_conversation_id
    from public.group_invitations
    where id=target_invitation_id and status='pending'
    for update;
  if v_conversation_id is null then
    raise exception 'Pending invitation not found.' using errcode='P0002';
  end if;
  if not private.is_group_admin(v_conversation_id) then
    raise exception 'Only group owners and admins can revoke invitations.' using errcode='42501';
  end if;
  update public.group_invitations
    set status='revoked',responded_at=now()
    where id=target_invitation_id and status='pending';
end;
$$;
revoke all on function private.revoke_group_invitation_impl(uuid) from public,anon,authenticated;
grant execute on function private.revoke_group_invitation_impl(uuid) to authenticated;

create or replace function public.revoke_group_invitation(target_invitation_id uuid)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.revoke_group_invitation_impl(target_invitation_id);
$$;
revoke all on function public.revoke_group_invitation(uuid) from public,anon;
grant execute on function public.revoke_group_invitation(uuid) to authenticated;
