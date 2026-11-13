-- Private account inbox topics allow callers to ring a callee without
-- disclosing a call session to unrelated Realtime subscribers.

create policy chitchat_user_call_inbox_read
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when (select realtime.topic()) ~ '^user-calls:[0-9a-fA-F-]{36}$'
      then substring((select realtime.topic()) from 12)::uuid=(select auth.uid())
      else false
    end
  );

create policy chitchat_user_call_inbox_write
  on realtime.messages
  for insert
  to authenticated
  with check (
    case
      when (select realtime.topic()) ~ '^user-calls:[0-9a-fA-F-]{36}$'
      then exists (
        select 1 from public.call_sessions cs
        where cs.callee_id=substring((select realtime.topic()) from 12)::uuid
          and cs.caller_id=(select auth.uid())
          and cs.status='ringing'
          and cs.expires_at>now()
      )
      else false
    end
  );
