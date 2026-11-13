-- Persist the public fingerprint alongside the signed device key bundle.
-- Legacy device records stay nullable until they are re-registered by a build
-- that can create and verify device identities locally.

alter table public.devices
  add column if not exists fingerprint text;

alter table public.devices
  add constraint devices_fingerprint_format
  check (fingerprint is null or fingerprint ~ '^[0-9]{10}$')
  not valid;

alter table public.devices
  validate constraint devices_fingerprint_format;

grant insert(fingerprint) on public.devices to authenticated;
