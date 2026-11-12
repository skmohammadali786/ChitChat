create or replace function private.list_group_members_impl(target_conversation_id uuid)
returns table(
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  member_role text,
  joined_at timestamptz
)
language sql stable security definer set search_path=''
as $$
  select cm.user_id,p.username,p.display_name,p.avatar_path,cm.role,cm.joined_at
  from public.conversation_members cm
  left join public.profiles p on p.id=cm.user_id
  where cm.conversation_id=target_conversation_id
    and private.is_conversation_member(target_conversation_id)
  order by case cm.role when 'owner' then 0 when 'admin' then 1 else 2 end,cm.joined_at;
$$;
revoke all on function private.list_group_members_impl(uuid) from public,anon,authenticated;
grant execute on function private.list_group_members_impl(uuid) to authenticated;
create or replace function public.list_group_members(target_conversation_id uuid)
returns table(user_id uuid,username text,display_name text,avatar_path text,member_role text,joined_at timestamptz)
language sql stable security invoker set search_path=''
as $$ select * from private.list_group_members_impl(target_conversation_id); $$;
revoke all on function public.list_group_members(uuid) from public,anon;
grant execute on function public.list_group_members(uuid) to authenticated;
