-- No client may write message envelopes until the native MLS adapter and
-- protocol-specific server acceptance checks are implemented. UI checks are
-- not a security boundary because callers can invoke the Supabase REST API.
revoke insert on public.messages from authenticated;
drop policy if exists messages_insert_member_self on public.messages;

-- Scheduled envelopes follow the same rule. The dispatcher may only process
-- envelopes created after a later MLS-aware migration restores this capability.
revoke insert on public.scheduled_messages from authenticated;
drop policy if exists scheduled_messages_insert_own on public.scheduled_messages;

comment on table public.messages is
  'Encrypted message envelopes only. Authenticated client INSERT is disabled until MLS protocol enforcement is implemented.';
comment on table public.scheduled_messages is
  'Scheduled encrypted envelopes only. Authenticated client INSERT is disabled until MLS protocol enforcement is implemented.';
