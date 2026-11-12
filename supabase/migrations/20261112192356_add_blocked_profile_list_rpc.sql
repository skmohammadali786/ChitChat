create or replace function private.list_my_blocked_users_impl()
returns table(
  blocked_id uuid,
  username text,
  display_name text,
  avatar_path text,
  created_at timestamp with time zone
)
language sql
stable
security definer
set search_path=''
as $$
  select b.blocked_id, p.username, p.display_name, p.avatar_path, b.created_at
  from public.user_blocks b
  left join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

revoke all on function private.list_my_blocked_users_impl() from public, anon, authenticated;
grant execute on function private.list_my_blocked_users_impl() to authenticated;

create or replace function public.list_my_blocked_users()
returns table(
  blocked_id uuid,
  username text,
  display_name text,
  avatar_path text,
  created_at timestamp with time zone
)
language sql
stable
security invoker
set search_path=''
as $$
  select * from private.list_my_blocked_users_impl();
$$;

revoke all on function public.list_my_blocked_users() from public, anon, authenticated;
grant execute on function public.list_my_blocked_users() to authenticated;
