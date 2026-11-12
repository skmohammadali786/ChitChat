create or replace function private.mark_conversation_read_impl(target_conversation_id uuid, read_through timestamptz default now())
returns integer language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_count integer; v_show_read_receipts boolean;
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not private.is_conversation_member(target_conversation_id) then raise exception 'Conversation not found' using errcode='P0002'; end if;
  v_show_read_receipts := coalesce(
    (select s.show_read_receipts from public.user_settings s where s.user_id=v_me),
    true
  );
  if v_show_read_receipts then
    update public.message_receipts r
      set delivered_at=coalesce(r.delivered_at,now()),read_at=coalesce(r.read_at,now())
      from public.messages m
      where r.message_id=m.id and r.recipient_id=v_me
        and m.conversation_id=target_conversation_id
        and m.created_at<=coalesce(read_through,now())
        and r.read_at is null;
  else
    update public.message_receipts r
      set delivered_at=coalesce(r.delivered_at,now())
      from public.messages m
      where r.message_id=m.id and r.recipient_id=v_me
        and m.conversation_id=target_conversation_id
        and m.created_at<=coalesce(read_through,now())
        and r.delivered_at is null;
  end if;
  get diagnostics v_count = row_count;
  update public.conversation_members
    set last_read_at=greatest(coalesce(last_read_at,'epoch'::timestamptz),coalesce(read_through,now()))
    where conversation_id=target_conversation_id and user_id=v_me;
  return v_count;
end;
$$;
revoke all on function private.mark_conversation_read_impl(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.mark_conversation_read_impl(uuid,timestamptz) to authenticated;

drop policy if exists chitchat_conversation_realtime_write on realtime.messages;
create policy chitchat_conversation_realtime_write on realtime.messages for insert to authenticated
with check (
 case
  when (select realtime.topic()) ~ '^conversation:[0-9a-fA-F-]{36}$'
   and private.is_conversation_member(substring((select realtime.topic()) from 13)::uuid)
  then case
   when extension='presence' then coalesce(
     (select s.show_online_status from public.user_settings s where s.user_id=(select auth.uid())),true)
   when extension='broadcast' then coalesce(
     (select s.show_typing_status from public.user_settings s where s.user_id=(select auth.uid())),true)
   else true
  end
  else false
 end
);
