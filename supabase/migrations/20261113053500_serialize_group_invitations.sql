-- Serialize all invitation and membership additions on the group row. This
-- prevents oversubscription at the 100 member cap and frees expired invitees
-- from the partial unique pending-invitation index.

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
  v_group_id uuid;
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

  select id into v_group_id
    from public.conversations
    where id=target_conversation_id and kind='group'
    for update;
  if v_group_id is null then
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

  update public.group_invitations
    set status='expired',responded_at=now()
    where conversation_id=target_conversation_id
      and invitee_id=target_user_id
      and status='pending'
      and expires_at<=now();

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
        and expires_at>now()
      limit 1;
  end if;
  if v_invitation_id is null then
    raise exception 'Could not create a group invitation. Please retry.' using errcode='40001';
  end if;
  return v_invitation_id;
end;
$$;
revoke all on function private.create_group_invitation_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.create_group_invitation_impl(uuid,uuid) to authenticated;

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
  v_conversation_id uuid;
  v_group_id uuid;
  v_invitation public.group_invitations%rowtype;
  v_members integer;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_invitation_id is null or accept_invitation is null then
    raise exception 'An invitation and response are required.' using errcode='22023';
  end if;

  select conversation_id into v_conversation_id
    from public.group_invitations
    where id=target_invitation_id and invitee_id=v_me;
  if v_conversation_id is null then
    raise exception 'Invitation not found.' using errcode='P0002';
  end if;

  select id into v_group_id
    from public.conversations
    where id=v_conversation_id and kind='group'
    for update;
  if v_group_id is null then
    update public.group_invitations
      set status='expired',responded_at=now()
      where id=target_invitation_id and invitee_id=v_me and status='pending';
    return 'expired';
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

  select count(*) into v_members
    from public.conversation_members
    where conversation_id=v_conversation_id;
  if v_members>=100 then
    raise exception 'This group is full.' using errcode='22023';
  end if;
  if private.is_blocked_between(v_invitation.inviter_id) then
    raise exception 'You cannot join a group through an invitation from a blocked account.' using errcode='42501';
  end if;
  if exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id=v_conversation_id
      and private.is_blocked_between(cm.user_id)
  ) then
    raise exception 'This group contains an account blocked by either side.' using errcode='42501';
  end if;

  insert into public.conversation_members(conversation_id,user_id,role)
    values(v_conversation_id,v_me,'member')
    on conflict(conversation_id,user_id) do nothing;
  update public.group_invitations
    set status='accepted',responded_at=now()
    where id=target_invitation_id;
  update public.conversations
    set updated_at=now()
    where id=v_conversation_id;
  return 'accepted';
end;
$$;
revoke all on function private.respond_group_invitation_impl(uuid,boolean) from public,anon,authenticated;
grant execute on function private.respond_group_invitation_impl(uuid,boolean) to authenticated;

create or replace function private.revoke_group_invitation_impl(target_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_conversation_id uuid;
  v_group_id uuid;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;

  select conversation_id into v_conversation_id
    from public.group_invitations
    where id=target_invitation_id and status='pending';
  if v_conversation_id is null then
    raise exception 'Pending invitation not found.' using errcode='P0002';
  end if;

  select id into v_group_id
    from public.conversations
    where id=v_conversation_id and kind='group'
    for update;
  if v_group_id is null then
    raise exception 'Group not found.' using errcode='P0002';
  end if;
  if not private.is_group_admin(v_conversation_id) then
    raise exception 'Only group owners and admins can revoke invitations.' using errcode='42501';
  end if;

  perform 1
    from public.group_invitations
    where id=target_invitation_id and conversation_id=v_conversation_id and status='pending'
    for update;
  if not found then
    raise exception 'Pending invitation not found.' using errcode='P0002';
  end if;

  update public.group_invitations
    set status='revoked',responded_at=now()
    where id=target_invitation_id and status='pending';
end;
$$;
revoke all on function private.revoke_group_invitation_impl(uuid) from public,anon,authenticated;
grant execute on function private.revoke_group_invitation_impl(uuid) to authenticated;

-- Direct member additions share the same group-row lock as invitation acceptance.
create or replace function private.add_group_members_impl(target_conversation_id uuid, member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid:=auth.uid();
  v_group_id uuid;
  v_ids uuid[];
  v_count integer;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;

  select id into v_group_id
    from public.conversations
    where id=target_conversation_id and kind='group'
    for update;
  if v_group_id is null or not private.is_group_admin(target_conversation_id) then
    raise exception 'Only group admins can add members.' using errcode='42501';
  end if;

  select coalesce(array_agg(distinct x),array[]::uuid[]) into v_ids
    from unnest(coalesce(member_ids,array[]::uuid[])) x
    where x is not null and x<>v_me;
  if cardinality(v_ids)=0 then return 0; end if;

  if exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.profiles p where p.id=x)) then
    raise exception 'One or more group members do not exist.' using errcode='P0002';
  end if;
  if exists(select 1 from unnest(v_ids) x where private.is_blocked_between(x)) then
    raise exception 'A selected member is blocked.' using errcode='42501';
  end if;
  if (select count(*) from public.conversation_members cm where cm.conversation_id=target_conversation_id)
     + (select count(*) from unnest(v_ids) x where not exists(
         select 1 from public.conversation_members cm
         where cm.conversation_id=target_conversation_id and cm.user_id=x
       )) > 100 then
    raise exception 'Groups are limited to 100 members.' using errcode='22023';
  end if;

  insert into public.conversation_members(conversation_id,user_id,role)
    select target_conversation_id,x,'member'
    from unnest(v_ids) x
    on conflict(conversation_id,user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.add_group_members_impl(uuid,uuid[]) from public,anon,authenticated;
grant execute on function private.add_group_members_impl(uuid,uuid[]) to authenticated;
