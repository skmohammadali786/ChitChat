-- Device public-key bundles are immutable once trusted. Any key or
-- fingerprint change, and any revocation, removes every peer trust assertion.
create or replace function private.invalidate_device_trust_on_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.device_trust
  where device_id=new.id;
  return new;
end;
$$;
revoke all on function private.invalidate_device_trust_on_change() from public,anon,authenticated;

drop trigger if exists devices_invalidate_trust_after_key_change on public.devices;
create trigger devices_invalidate_trust_after_key_change
  after update of identity_key_public,signed_prekey_public,signed_prekey_signature,fingerprint,key_version,revoked_at
  on public.devices
  for each row
  when (
    old.identity_key_public is distinct from new.identity_key_public
    or old.signed_prekey_public is distinct from new.signed_prekey_public
    or old.signed_prekey_signature is distinct from new.signed_prekey_signature
    or old.fingerprint is distinct from new.fingerprint
    or old.key_version is distinct from new.key_version
    or old.revoked_at is distinct from new.revoked_at
  )
  execute function private.invalidate_device_trust_on_change();

-- The Rust identity format uses unpadded base64url: 32-byte public keys
-- encode to 43 chars and 64-byte Ed25519 signatures to 86 chars.
alter table public.devices
  add constraint devices_identity_key_public_format
  check (identity_key_public ~ '^[A-Za-z0-9_-]{43}$')
  not valid;
alter table public.devices
  validate constraint devices_identity_key_public_format;

alter table public.devices
  add constraint devices_signed_prekey_public_format
  check (signed_prekey_public ~ '^[A-Za-z0-9_-]{43}$')
  not valid;
alter table public.devices
  validate constraint devices_signed_prekey_public_format;

alter table public.devices
  add constraint devices_signed_prekey_signature_format
  check (signed_prekey_signature ~ '^[A-Za-z0-9_-]{86}$')
  not valid;
alter table public.devices
  validate constraint devices_signed_prekey_signature_format;

alter table public.devices
  add constraint devices_key_version_positive
  check (key_version > 0)
  not valid;
alter table public.devices
  validate constraint devices_key_version_positive;

-- Revoke the broad UPDATE grant and grant only the column needed by the
-- current self-revocation UI. RLS devices_update_self still enforces ownership.
revoke update on public.devices from authenticated;
grant update(revoked_at) on public.devices to authenticated;
