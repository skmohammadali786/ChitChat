-- Ringing calls have a short 45-second invitation deadline. Once accepted,
-- replace that deadline with a bounded active-call lifetime so TURN credentials
-- do not inherit the ringing timeout and abandoned sessions cannot block calls.
create or replace function private.respond_call_session_impl(
  target_call_id uuid,
  accept_call boolean
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_call public.call_sessions%rowtype;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_call_id is null or accept_call is null then
    raise exception 'A call and response are required.' using errcode='22023';
  end if;

  select * into v_call
    from public.call_sessions
    where id=target_call_id and callee_id=v_me
    for update;
  if not found then
    raise exception 'Incoming call not found.' using errcode='P0002';
  end if;
  if v_call.status<>'ringing' then
    raise exception 'This call is no longer ringing.' using errcode='22023';
  end if;
  if v_call.expires_at<=now() then
    update public.call_sessions
      set status='missed',ended_at=now(),end_reason='no_answer'
      where id=target_call_id;
    return 'missed';
  end if;

  if accept_call then
    update public.call_sessions
      set status='accepted',
          answered_at=now(),
          expires_at=now()+interval '4 hours'
      where id=target_call_id;
    return 'accepted';
  end if;

  update public.call_sessions
    set status='rejected',ended_at=now(),end_reason='declined'
    where id=target_call_id;
  return 'rejected';
end;
$$;
revoke all on function private.respond_call_session_impl(uuid,boolean) from public,anon;
grant execute on function private.respond_call_session_impl(uuid,boolean) to authenticated;

-- Expire both unanswered invitations and accepted calls whose bounded session
-- lifetime elapsed. This frees the active-conversation uniqueness slot.
create or replace function private.expire_unanswered_call_sessions()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  affected_rows bigint;
begin
  update public.call_sessions
    set status=case when status='ringing' then 'missed' else 'expired' end,
        ended_at=coalesce(ended_at,now()),
        end_reason=coalesce(end_reason,case when status='ringing' then 'no_answer' else 'session_timeout' end)
    where status in ('ringing','accepted')
      and expires_at<=now();

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;
revoke all on function private.expire_unanswered_call_sessions() from public,anon,authenticated;

-- Expire a stale active session synchronously before checking whether a new
-- call may be created in the same direct conversation.
create or replace function private.create_call_session_impl(
  target_conversation_id uuid,
  target_callee_id uuid,
  requested_call_type text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_group_kind text;
  v_call_id uuid;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_conversation_id is null or target_callee_id is null or target_callee_id=v_me then
    raise exception 'Choose a valid direct conversation and recipient.' using errcode='22023';
  end if;
  if requested_call_type not in ('audio','video') then
    raise exception 'Call type must be audio or video.' using errcode='22023';
  end if;

  select kind into v_group_kind
    from public.conversations
    where id=target_conversation_id
    for update;
  if v_group_kind is null or v_group_kind<>'direct' then
    raise exception 'Calls are currently supported only in direct conversations.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id=target_conversation_id and user_id=v_me
  ) or not exists (
    select 1 from public.conversation_members
    where conversation_id=target_conversation_id and user_id=target_callee_id
  ) then
    raise exception 'Both accounts must belong to this conversation.' using errcode='42501';
  end if;
  if private.is_blocked_between(target_callee_id) then
    raise exception 'Calls are unavailable for blocked accounts.' using errcode='42501';
  end if;

  update public.call_sessions
    set status=case when status='ringing' then 'missed' else 'expired' end,
        ended_at=coalesce(ended_at,now()),
        end_reason=coalesce(end_reason,case when status='ringing' then 'no_answer' else 'session_timeout' end)
    where conversation_id=target_conversation_id
      and status in ('ringing','accepted')
      and expires_at<=now();

  if exists (
    select 1 from public.call_sessions
    where conversation_id=target_conversation_id
      and status in ('ringing','accepted')
  ) then
    raise exception 'There is already an active call in this conversation.' using errcode='23505';
  end if;

  insert into public.call_sessions(conversation_id,caller_id,callee_id,call_type)
    values(target_conversation_id,v_me,target_callee_id,requested_call_type)
    returning id into v_call_id;
  return v_call_id;
end;
$$;
revoke all on function private.create_call_session_impl(uuid,uuid,text) from public,anon;
grant execute on function private.create_call_session_impl(uuid,uuid,text) to authenticated;

comment on column public.call_sessions.expires_at is
  'Deadline for unanswered ringing requests. On acceptance it becomes the maximum active call session lifetime (4 hours).';
