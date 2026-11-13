-- Allow a signed-in member to report a conversation or a member without
-- exposing the private moderation table through the Data API.
alter table private.message_reports
  add column if not exists target_user_id uuid references auth.users(id) on delete set null;

create index if not exists message_reports_reporter_created_idx
  on private.message_reports(reporter_id, created_at desc);

create or replace function private.report_conversation_impl(
  target_conversation_id uuid,
  target_user_id uuid,
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
  v_member_count integer;
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
  if not private.is_conversation_member(target_conversation_id) then
    raise exception 'Conversation not found' using errcode='P0002';
  end if;

  select count(*) into v_member_count
  from public.conversation_members cm
  where cm.conversation_id=target_conversation_id;

  if target_user_id is not null then
    if target_user_id = v_me or not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id=target_conversation_id and cm.user_id=target_user_id
    ) then
      raise exception 'The reported account is not part of this conversation' using errcode='22023';
    end if;
  elsif v_member_count < 2 then
    raise exception 'Conversation is not reportable' using errcode='22023';
  end if;

  select count(*) into v_recent_count
  from private.message_reports mr
  where mr.reporter_id=v_me
    and mr.created_at > now() - interval '1 hour';
  if v_recent_count >= 5 then
    raise exception 'You have reached the report limit. Try again later.' using errcode='P0001';
  end if;

  insert into private.message_reports(
    reporter_id, conversation_id, target_user_id, reason, details
  )
  values (
    v_me, target_conversation_id, target_user_id, target_reason, coalesce(report_details,'')
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke all on function private.report_conversation_impl(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.report_conversation_impl(uuid,uuid,text,text) to authenticated;

create or replace function public.report_conversation(
  target_conversation_id uuid,
  target_user_id uuid,
  target_reason text,
  report_details text default ''
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.report_conversation_impl(
    target_conversation_id,target_user_id,target_reason,report_details
  );
$$;

revoke all on function public.report_conversation(uuid,uuid,text,text) from public,anon;
grant execute on function public.report_conversation(uuid,uuid,text,text) to authenticated;
