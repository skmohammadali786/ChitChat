create or replace function private.report_message_impl(
  target_message_id uuid,
  target_reason text,
  report_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_report_id uuid;
  v_conversation uuid;
  v_sender uuid;
  v_recent_count integer;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_reason not in ('spam','harassment','impersonation','unsafe_content','other') then
    raise exception 'Choose a supported report reason' using errcode='22023';
  end if;
  if char_length(coalesce(report_details,'')) > 2000 then
    raise exception 'Report details cannot exceed 2000 characters' using errcode='22001';
  end if;

  select m.conversation_id,m.sender_id
    into v_conversation,v_sender
  from public.messages m
  where m.id=target_message_id;

  if v_conversation is null
    or v_sender=v_me
    or not private.is_conversation_member(v_conversation) then
    raise exception 'Message not found' using errcode='P0002';
  end if;

  select count(*) into v_recent_count
  from private.message_reports mr
  where mr.reporter_id=v_me
    and mr.created_at > now() - interval '1 hour';
  if v_recent_count >= 5 then
    raise exception 'You have reached the report limit. Try again later.' using errcode='P0001';
  end if;

  insert into private.message_reports(
    reporter_id,message_id,conversation_id,reason,details
  )
  values(
    v_me,target_message_id,v_conversation,target_reason,coalesce(report_details,'')
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke all on function private.report_message_impl(uuid,text,text) from public,anon,authenticated;
grant execute on function private.report_message_impl(uuid,text,text) to authenticated;
