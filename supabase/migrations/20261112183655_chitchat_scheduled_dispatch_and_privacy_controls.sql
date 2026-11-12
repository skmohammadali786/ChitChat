create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.mark_conversation_read_impl(target_conversation_id uuid, read_through timestamptz default now())
returns integer language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_count integer; v_show_read_receipts boolean:=true;
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not private.is_conversation_member(target_conversation_id) then raise exception 'Conversation not found' using errcode='P0002'; end if;
  select coalesce(s.show_read_receipts,true) into v_show_read_receipts from public.user_settings s where s.user_id=v_me;
  if v_show_read_receipts then
    update public.message_receipts r set delivered_at=coalesce(r.delivered_at,now()),read_at=coalesce(r.read_at,now())
    from public.messages m where r.message_id=m.id and r.recipient_id=v_me
      and m.conversation_id=target_conversation_id and m.created_at<=coalesce(read_through,now()) and r.read_at is null;
  else
    update public.message_receipts r set delivered_at=coalesce(r.delivered_at,now())
    from public.messages m where r.message_id=m.id and r.recipient_id=v_me
      and m.conversation_id=target_conversation_id and m.created_at<=coalesce(read_through,now()) and r.delivered_at is null;
  end if;
  get diagnostics v_count = row_count;
  update public.conversation_members set last_read_at=greatest(coalesce(last_read_at,'epoch'::timestamptz),coalesce(read_through,now()))
  where conversation_id=target_conversation_id and user_id=v_me;
  return v_count;
end;
$$;
revoke all on function private.mark_conversation_read_impl(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.mark_conversation_read_impl(uuid,timestamptz) to authenticated;

create or replace function private.dispatch_due_scheduled_messages()
returns integer language plpgsql security definer set search_path=''
as $$
declare v_job record; v_kind text; v_sent integer:=0;
begin
  for v_job in
    select sm.* from public.scheduled_messages sm
    where sm.status='pending' and sm.send_at<=now()
    order by sm.send_at limit 100 for update skip locked
  loop
    begin
      select c.kind into v_kind from public.conversations c where c.id=v_job.conversation_id;
      if v_kind is null or not exists(
        select 1 from public.conversation_members cm
        where cm.conversation_id=v_job.conversation_id and cm.user_id=v_job.sender_id
      ) then
        update public.scheduled_messages set status='failed',failure_code='sender_not_member' where id=v_job.id;
        continue;
      end if;
      if v_kind='direct' and exists(
        select 1 from public.conversation_members other_member
        join public.user_blocks b on (b.blocker_id=v_job.sender_id and b.blocked_id=other_member.user_id)
          or (b.blocker_id=other_member.user_id and b.blocked_id=v_job.sender_id)
        where other_member.conversation_id=v_job.conversation_id and other_member.user_id<>v_job.sender_id
      ) then
        update public.scheduled_messages set status='failed',failure_code='conversation_unavailable' where id=v_job.id;
        continue;
      end if;
      insert into public.messages(conversation_id,sender_id,client_message_id,message_type,ciphertext,nonce,crypto_header,key_version)
      values(v_job.conversation_id,v_job.sender_id,v_job.client_message_id,v_job.message_type,v_job.ciphertext,v_job.nonce,v_job.crypto_header,v_job.key_version)
      on conflict(sender_id,client_message_id) do nothing;
      update public.scheduled_messages set status='sent',sent_at=now(),failure_code=null where id=v_job.id;
      v_sent:=v_sent+1;
    exception when others then
      update public.scheduled_messages set status='failed',failure_code='dispatch_error' where id=v_job.id;
    end;
  end loop;
  return v_sent;
end;
$$;
revoke all on function private.dispatch_due_scheduled_messages() from public,anon,authenticated;

drop policy if exists chitchat_conversation_realtime_write on realtime.messages;
create policy chitchat_conversation_realtime_write on realtime.messages for insert to authenticated
with check (
 case
  when (select realtime.topic()) ~ '^conversation:[0-9a-fA-F-]{36}$'
   and private.is_conversation_member(substring((select realtime.topic()) from 13)::uuid)
  then case
   when extension='presence' then exists(select 1 from public.user_settings s where s.user_id=(select auth.uid()) and s.show_online_status)
   when extension='broadcast' then exists(select 1 from public.user_settings s where s.user_id=(select auth.uid()) and s.show_typing_status)
   else true
  end
  else false
 end
);

do $$
begin
 if exists(select 1 from cron.job where jobname='chitchat-dispatch-scheduled-messages') then
  perform cron.unschedule(jobid) from cron.job where jobname='chitchat-dispatch-scheduled-messages';
 end if;
 perform cron.schedule('chitchat-dispatch-scheduled-messages','* * * * *','select private.dispatch_due_scheduled_messages();');
end
$$;
