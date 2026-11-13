-- Owner-controlled group admin promotion and demotion.
-- Ownership remains a separate transfer operation and cannot be assigned here.

create or replace function private.set_group_member_role_impl(
  target_conversation_id uuid,
  target_user_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_group_id uuid;
  v_target_role text;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;

  if new_role not in ('admin','member') then
    raise exception 'Role must be admin or member.' using errcode='22023';
  end if;

  select id into v_group_id
    from public.conversations
    where id=target_conversation_id and kind='group'
    for update;

  if v_group_id is null then
    raise exception 'Group not found.' using errcode='P0002';
  end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id=target_conversation_id
      and user_id=v_me
      and role='owner'
  ) then
    raise exception 'Only the group owner can change admin roles.' using errcode='42501';
  end if;

  select role into v_target_role
    from public.conversation_members
    where conversation_id=target_conversation_id
      and user_id=target_user_id
    for update;

  if v_target_role is null then
    raise exception 'Group member not found.' using errcode='P0002';
  end if;
  if v_target_role='owner' then
    raise exception 'Transfer ownership with the dedicated owner action.' using errcode='22023';
  end if;

  update public.conversation_members
    set role=new_role
    where conversation_id=target_conversation_id
      and user_id=target_user_id;
end;
$$;

revoke all on function private.set_group_member_role_impl(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.set_group_member_role_impl(uuid,uuid,text) to authenticated;

create or replace function public.set_group_member_role(
  target_conversation_id uuid,
  target_user_id uuid,
  new_role text
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.set_group_member_role_impl(target_conversation_id,target_user_id,new_role);
$$;

revoke all on function public.set_group_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.set_group_member_role(uuid,uuid,text) to authenticated;
