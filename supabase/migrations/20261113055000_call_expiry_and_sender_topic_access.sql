-- Allow the initiator of a live call to subscribe to the recipient's
-- private inbox topic in order to send the invitation broadcast. Only the
-- two participants in a still-ringing call can read this topic.
drop policy if exists chitchat_user_call_inbox_read on realtime.messages;
create policy chitchat_user_call_inbox_read
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when (select realtime.topic()) ~ '^user-calls:[0-9a-fA-F-]{36}$'
      then
        substring((select realtime.topic()) from 12)::uuid=(select auth.uid())
        or exists (
          select 1 from public.call_sessions cs
          where cs.callee_id=substring((select realtime.topic()) from 12)::uuid
            and cs.caller_id=(select auth.uid())
            and cs.status='ringing'
            and cs.expires_at>now()
        )
      else false
    end
  );

-- Expired calls should be terminal in history even if neither client returns
-- to the app to answer. This function is invoked when a participant loads
-- their own call list.
create or replace function private.list_my_call_sessions_impl()
returns setof public.call_sessions
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;

  update public.call_sessions
    set status='missed',
        ended_at=coalesce(ended_at,now()),
        end_reason=coalesce(end_reason,'no_answer')
    where status='ringing'
      and expires_at<=now()
      and (caller_id=auth.uid() or callee_id=auth.uid());

  return query
    select cs.*
    from public.call_sessions cs
    where cs.caller_id=auth.uid() or cs.callee_id=auth.uid()
    order by cs.created_at desc
    limit 100;
end;
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
