-- Never remove a conversation member while an active MLS group still
-- contains that member. This app version does not yet distribute a verified
-- Remove proposal/Commit and rotate all remaining devices' epochs.
-- Fail closed rather than leave a removed member with active group secrets.

create or replace function private.remove_group_member_impl(
  target_conversation_id uuid,
  target_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_me uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_count integer;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_user_id is null then
    raise exception 'A target member is required.' using errcode='22023';
  end if;

  select role into v_actor_role
  from public.conversation_members
  where conversation_id=target_conversation_id and user_id=v_me;

  select role into v_target_role
  from public.conversation_members
  where conversation_id=target_conversation_id and user_id=target_user_id;

  if v_actor_role is null then
    raise exception 'You are not a member of this group.' using errcode='42501';
  end if;
  if v_target_role is null or not exists (
    select 1 from public.conversations where id=target_conversation_id and kind='group'
  ) then
    raise exception 'Group member not found.' using errcode='P0002';
  end if;

  if v_me<>target_user_id and v_actor_role not in ('owner','admin') then
    raise exception 'Only group admins can remove another member.' using errcode='42501';
  end if;
  if v_target_role='owner' and v_me<>target_user_id then
    raise exception 'Transfer group ownership before removing the owner.' using errcode='42501';
  end if;

  select count(*) into v_count
  from public.conversation_members
  where conversation_id=target_conversation_id;

  if v_target_role='owner' and v_me=target_user_id and v_count>1 then
    raise exception 'Transfer group ownership before leaving.' using errcode='42501';
  end if;

  -- Deleting the last owner deletes the whole conversation and all group state.
  -- Every other removal changes the MLS cryptographic roster. Until this
  -- installation can authenticate and publish the corresponding Commit,
  -- refuse the membership mutation.
  if v_count > 1 and exists (
    select 1 from public.conversation_mls_groups
    where conversation_id=target_conversation_id and status='active'
  ) then
    raise exception 'MLS member removal is paused until a verified key-rotation Commit can be distributed to every remaining device.'
      using errcode='55000';
  end if;

  if v_target_role='owner' and v_me=target_user_id and v_count=1 then
    delete from public.conversations where id=target_conversation_id;
  else
    delete from public.conversation_members
    where conversation_id=target_conversation_id and user_id=target_user_id;
  end if;
end;
$function$;

revoke all on function private.remove_group_member_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.remove_group_member_impl(uuid,uuid) to authenticated;
