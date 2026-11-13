-- Private Realtime invitation notifications. Invitation table reads remain
-- denied to clients; event payloads contain only opaque IDs and status.
create policy chitchat_group_invitation_inbox_read
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when (select realtime.topic()) ~ '^group-invitations:[0-9a-fA-F-]{36}$'
      then split_part((select realtime.topic()), ':', 2)::uuid=(select auth.uid())
      else false
    end
  );

create policy chitchat_group_invitation_admin_read
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when (select realtime.topic()) ~ '^group-invitations-admin:[0-9a-fA-F-]{36}$'
      then private.is_group_admin(split_part((select realtime.topic()), ':', 2)::uuid)
      else false
    end
  );

create or replace function private.broadcast_group_invitation_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'invitation_id', new.id,
      'conversation_id', new.conversation_id,
      'status', new.status
    ),
    'group-invitation-inbox-updated',
    'group-invitations:' || new.invitee_id::text,
    true
  );

  perform realtime.send(
    jsonb_build_object(
      'invitation_id', new.id,
      'conversation_id', new.conversation_id,
      'status', new.status
    ),
    'group-invitation-admin-updated',
    'group-invitations-admin:' || new.conversation_id::text,
    true
  );

  return new;
end;
$$;
revoke all on function private.broadcast_group_invitation_change() from public,anon,authenticated;

drop trigger if exists group_invitation_private_broadcast on public.group_invitations;
create trigger group_invitation_private_broadcast
  after insert or update of status on public.group_invitations
  for each row
  execute function private.broadcast_group_invitation_change();
