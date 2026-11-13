-- Authenticated direct-call sessions and private Realtime signaling.
-- SDP and ICE payloads are not persisted to Postgres. They are sent only over
-- a participant-authorized private Realtime topic.

create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  call_type text not null check(call_type in ('audio','video')),
  status text not null default 'ringing'
    check(status in ('ringing','accepted','rejected','cancelled','ended','missed','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  answered_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  constraint call_session_not_self check(caller_id<>callee_id),
  constraint call_session_end_reason_length check(end_reason is null or char_length(end_reason)<=80)
);

create unique index if not exists call_sessions_one_active_per_conversation
  on public.call_sessions(conversation_id)
  where status in ('ringing','accepted');
create index if not exists call_sessions_caller_recent_idx
  on public.call_sessions(caller_id,created_at desc);
create index if not exists call_sessions_callee_recent_idx
  on public.call_sessions(callee_id,created_at desc)
  where status in ('ringing','accepted');

alter table public.call_sessions enable row level security;
revoke all on public.call_sessions from public,anon,authenticated;
grant select on public.call_sessions to authenticated;

create policy call_sessions_select_participant
  on public.call_sessions
  for select
  to authenticated
  using ((select auth.uid())=caller_id or (select auth.uid())=callee_id);

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
    set status=case when expires_at<=now() then 'missed' else status end,
        ended_at=case when expires_at<=now() then now() else ended_at end,
        end_reason=case when expires_at<=now() then 'no_answer' else end_reason end
    where conversation_id=target_conversation_id
      and status='ringing'
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
revoke all on function private.create_call_session_impl(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.create_call_session_impl(uuid,uuid,text) to authenticated;

create or replace function public.create_call_session(
  target_conversation_id uuid,
  target_callee_id uuid,
  requested_call_type text
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_call_session_impl(target_conversation_id,target_callee_id,requested_call_type);
$$;
revoke all on function public.create_call_session(uuid,uuid,text) from public,anon;
grant execute on function public.create_call_session(uuid,uuid,text) to authenticated;

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
      set status='accepted',answered_at=now()
      where id=target_call_id;
    return 'accepted';
  end if;

  update public.call_sessions
    set status='rejected',ended_at=now(),end_reason='declined'
    where id=target_call_id;
  return 'rejected';
end;
$$;
revoke all on function private.respond_call_session_impl(uuid,boolean) from public,anon,authenticated;
grant execute on function private.respond_call_session_impl(uuid,boolean) to authenticated;

create or replace function public.respond_call_session(target_call_id uuid, accept_call boolean)
returns text
language sql
security invoker
set search_path=''
as $$
  select private.respond_call_session_impl(target_call_id,accept_call);
$$;
revoke all on function public.respond_call_session(uuid,boolean) from public,anon;
grant execute on function public.respond_call_session(uuid,boolean) to authenticated;

create or replace function private.end_call_session_impl(target_call_id uuid, requested_reason text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_status text;
  v_caller uuid;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_call_id is null or requested_reason is null or char_length(requested_reason)>80 then
    raise exception 'Call end details are invalid.' using errcode='22023';
  end if;

  select status,caller_id into v_status,v_caller
    from public.call_sessions
    where id=target_call_id and (caller_id=v_me or callee_id=v_me)
    for update;
  if not found then
    raise exception 'Call not found.' using errcode='P0002';
  end if;
  if v_status not in ('ringing','accepted') then
    return;
  end if;

  update public.call_sessions
    set status=case when v_status='ringing' and v_caller=v_me then 'cancelled' else 'ended' end,
        ended_at=now(),
        end_reason=requested_reason
    where id=target_call_id;
end;
$$;
revoke all on function private.end_call_session_impl(uuid,text) from public,anon,authenticated;
grant execute on function private.end_call_session_impl(uuid,text) to authenticated;

create or replace function public.end_call_session(target_call_id uuid, requested_reason text)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.end_call_session_impl(target_call_id,requested_reason);
$$;
revoke all on function public.end_call_session(uuid,text) from public,anon;
grant execute on function public.end_call_session(uuid,text) to authenticated;

create or replace function private.list_my_call_sessions_impl()
returns setof public.call_sessions
language sql
security definer
set search_path=''
as $$
  select cs.*
  from public.call_sessions cs
  where auth.uid() is not null
    and (cs.caller_id=auth.uid() or cs.callee_id=auth.uid())
  order by cs.created_at desc
  limit 100;
$$;
revoke all on function private.list_my_call_sessions_impl() from public,anon,authenticated;
grant execute on function private.list_my_call_sessions_impl() to authenticated;

create or replace function public.list_my_call_sessions()
returns setof public.call_sessions
language sql
security invoker
set search_path=''
as $$
  select * from private.list_my_call_sessions_impl();
$$;
revoke all on function public.list_my_call_sessions() from public,anon;
grant execute on function public.list_my_call_sessions() to authenticated;

-- Private call:<uuid> topics are readable/writable only while the caller or
-- callee is a participant in a ringing/accepted session. SDP and ICE are
-- broadcast-only and never stored in the call_sessions row.
create policy chitchat_call_realtime_read
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when (select realtime.topic()) ~ '^call:[0-9a-fA-F-]{36}$'
      then exists (
        select 1 from public.call_sessions cs
        where cs.id=substring((select realtime.topic()) from 6)::uuid
          and (cs.caller_id=(select auth.uid()) or cs.callee_id=(select auth.uid()))
          and cs.status in ('ringing','accepted')
      )
      else false
    end
  );

create policy chitchat_call_realtime_write
  on realtime.messages
  for insert
  to authenticated
  with check (
    case
      when (select realtime.topic()) ~ '^call:[0-9a-fA-F-]{36}$'
      then exists (
        select 1 from public.call_sessions cs
        where cs.id=substring((select realtime.topic()) from 6)::uuid
          and (cs.caller_id=(select auth.uid()) or cs.callee_id=(select auth.uid()))
          and cs.status in ('ringing','accepted')
      )
      else false
    end
  );

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_catalog.pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='call_sessions'
     ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end
$$;
