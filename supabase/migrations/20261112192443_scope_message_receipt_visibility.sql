drop policy if exists message_receipts_select_conversation_member on public.message_receipts;

create policy message_receipts_select_recipient_or_sender
on public.message_receipts
for select
to authenticated
using (
  recipient_id = (select auth.uid())
  or exists (
    select 1
    from public.messages m
    where m.id = message_receipts.message_id
      and m.sender_id = (select auth.uid())
  )
);
