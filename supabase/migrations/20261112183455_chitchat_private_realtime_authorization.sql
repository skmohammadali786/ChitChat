create policy chitchat_conversation_realtime_read
on realtime.messages
for select
to authenticated
using (
  case
    when (select realtime.topic()) ~ '^conversation:[0-9a-fA-F-]{36}$'
    then private.is_conversation_member(substring((select realtime.topic()) from 13)::uuid)
    else false
  end
);

create policy chitchat_conversation_realtime_write
on realtime.messages
for insert
to authenticated
with check (
  case
    when (select realtime.topic()) ~ '^conversation:[0-9a-fA-F-]{36}$'
    then private.is_conversation_member(substring((select realtime.topic()) from 13)::uuid)
    else false
  end
);
