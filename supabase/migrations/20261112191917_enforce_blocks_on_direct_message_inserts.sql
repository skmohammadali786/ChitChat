drop policy if exists messages_insert_member_self on public.messages;

create policy messages_insert_member_self
on public.messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and private.is_conversation_member(conversation_id)
  and not exists (
    select 1
    from public.conversations c
    join public.conversation_members other_member
      on other_member.conversation_id = c.id
     and other_member.user_id <> (select auth.uid())
    where c.id = conversation_id
      and c.kind = 'direct'
      and private.is_blocked_between(other_member.user_id)
  )
);
