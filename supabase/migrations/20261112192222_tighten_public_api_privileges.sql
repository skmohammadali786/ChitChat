-- Remove broad API grants from exposed tables. RLS does not protect TRUNCATE,
-- and table-wide UPDATE can expose privileged columns such as group roles.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

-- Tighten defaults for the migration owner (normally postgres).
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- User profile CRUD, with row ownership enforced by RLS.
grant select, insert, update on public.profiles to authenticated;

-- Conversation membership and conversation records are read-only to clients.
-- All membership, role, title, and read-state mutations use private RPCs.
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select on public.devices to authenticated;
grant select on public.media_objects to authenticated;
grant select on public.message_receipts to authenticated;

-- Message inserts/deletes remain constrained by their RLS policies.
grant select, insert, delete on public.messages to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;

-- User-owned settings and scheduled-message envelopes.
grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update on public.conversation_user_settings to authenticated;
grant select, insert, update on public.push_devices to authenticated;
grant select, insert, update on public.scheduled_messages to authenticated;

-- Exposed RPCs are invoker wrappers. Their private implementations enforce membership and role checks.
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
grant execute on function public.list_group_members(uuid) to authenticated;
grant execute on function public.list_my_conversations() to authenticated;
grant execute on function public.lookup_profile_by_username(text) to authenticated;
grant execute on function public.mark_conversation_read(uuid, timestamptz) to authenticated;
grant execute on function public.mark_message_delivered(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.rename_group_conversation(uuid, text) to authenticated;
grant execute on function public.report_message(uuid, text, text) to authenticated;
grant execute on function public.transfer_group_owner(uuid, uuid) to authenticated;

-- Remove obsolete direct-mutation policies. Mutations use private RPCs.
drop policy if exists conversation_members_update_own_read_state on public.conversation_members;
drop policy if exists conversations_update_creator on public.conversations;
drop policy if exists conversation_user_settings_delete_own on public.conversation_user_settings;
drop policy if exists scheduled_messages_delete_own on public.scheduled_messages;
drop policy if exists media_objects_delete_owner on public.media_objects;
drop policy if exists push_devices_delete_own on public.push_devices;
