-- Expire unanswered calls even when neither participant reopens the app.
-- call_sessions is published to Supabase Realtime, so this UPDATE also
-- propagates the final missed state to subscribed participants.

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
    set status='missed',
        ended_at=coalesce(ended_at,now()),
        end_reason=coalesce(end_reason,'no_answer')
    where status='ringing'
      and expires_at<=now();

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

revoke all on function private.expire_unanswered_call_sessions() from public,anon,authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname='chitchat-expire-unanswered-calls'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'chitchat-expire-unanswered-calls',
    '* * * * *',
    'select private.expire_unanswered_call_sessions();'
  );
end;
$$;
