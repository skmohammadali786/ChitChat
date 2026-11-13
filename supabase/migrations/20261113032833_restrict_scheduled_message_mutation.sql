-- Clients may create and read their own scheduled envelopes, but may only
-- cancel them through a narrowly scoped server function. They cannot rewrite
-- ciphertext, timing, sender or conversation fields after insertion.
revoke update on public.scheduled_messages from authenticated;
drop policy if exists scheduled_messages_update_own on public.scheduled_messages;

create or replace function private.cancel_scheduled_message_impl(
  target_scheduled_message_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;

  update public.scheduled_messages
  set status='cancelled', failure_code=null
  where id=target_scheduled_message_id
    and sender_id=v_me
    and status='pending';

  if not found then
    raise exception 'Scheduled message is unavailable or no longer pending' using errcode='P0002';
  end if;
end;
$$;

revoke all on function private.cancel_scheduled_message_impl(uuid) from public,anon,authenticated;
grant execute on function private.cancel_scheduled_message_impl(uuid) to authenticated;

create or replace function public.cancel_scheduled_message(target_scheduled_message_id uuid)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.cancel_scheduled_message_impl(target_scheduled_message_id);
$$;

revoke all on function public.cancel_scheduled_message(uuid) from public,anon;
grant execute on function public.cancel_scheduled_message(uuid) to authenticated;
