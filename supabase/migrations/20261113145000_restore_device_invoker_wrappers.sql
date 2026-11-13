-- Public RPC wrappers are SECURITY INVOKER. The private implementation
-- functions are SECURITY DEFINER, live in the non-exposed private schema and
-- independently validate auth.uid(), ownership, and conversation membership.
grant execute on function private.revoke_my_device_impl(uuid) to authenticated;
grant execute on function private.list_peer_devices_impl(uuid,uuid) to authenticated;
grant execute on function private.trust_peer_device_impl(uuid,text) to authenticated;
grant execute on function private.untrust_peer_device_impl(uuid) to authenticated;

create or replace function public.revoke_my_device(target_device_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.revoke_my_device_impl(target_device_id); $$;
revoke all on function public.revoke_my_device(uuid) from public,anon;
grant execute on function public.revoke_my_device(uuid) to authenticated;

create or replace function public.list_peer_devices(
  target_conversation_id uuid,
  target_user_id uuid
)
returns table(
  device_id uuid,
  user_id uuid,
  device_label text,
  platform text,
  identity_key_public text,
  signed_prekey_public text,
  signed_prekey_signature text,
  fingerprint text,
  key_version integer,
  created_at timestamptz,
  last_seen_at timestamptz,
  trusted boolean,
  trusted_at timestamptz
)
language sql security invoker set search_path=''
as $$ select * from private.list_peer_devices_impl(target_conversation_id,target_user_id); $$;
revoke all on function public.list_peer_devices(uuid,uuid) from public,anon;
grant execute on function public.list_peer_devices(uuid,uuid) to authenticated;

create or replace function public.trust_peer_device(
  target_device_id uuid,
  expected_fingerprint text
)
returns timestamptz language sql security invoker set search_path=''
as $$ select private.trust_peer_device_impl(target_device_id,expected_fingerprint); $$;
revoke all on function public.trust_peer_device(uuid,text) from public,anon;
grant execute on function public.trust_peer_device(uuid,text) to authenticated;

create or replace function public.untrust_peer_device(target_device_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.untrust_peer_device_impl(target_device_id); $$;
revoke all on function public.untrust_peer_device(uuid) from public,anon;
grant execute on function public.untrust_peer_device(uuid) to authenticated;
