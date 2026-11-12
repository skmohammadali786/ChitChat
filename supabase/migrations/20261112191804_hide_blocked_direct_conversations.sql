create or replace function private.list_my_conversations_impl()
returns table(
  conversation_id uuid,
  conversation_kind text,
  conversation_title text,
  updated_at timestamp with time zone,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_path text
)
language sql
stable
security definer
set search_path=''
as $$
  select
    c.id,
    c.kind,
    c.title,
    c.updated_at,
    other_member.user_id,
    p.username,
    p.display_name,
    p.avatar_path
  from public.conversations c
  join public.conversation_members mine
    on mine.conversation_id = c.id and mine.user_id = auth.uid()
  left join lateral (
    select m.user_id
    from public.conversation_members m
    where m.conversation_id = c.id and m.user_id <> auth.uid()
    order by m.joined_at asc
    limit 1
  ) other_member on true
  left join public.profiles p on p.id = other_member.user_id
  where c.kind <> 'direct'
     or other_member.user_id is null
     or not private.is_blocked_between(other_member.user_id)
  order by c.updated_at desc
  limit 200;
$$;
