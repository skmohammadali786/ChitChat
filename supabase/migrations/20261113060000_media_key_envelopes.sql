-- Store only the ciphertext envelope for a media file key. The actual file
-- key is never sent to Cloudflare or stored in plaintext in Postgres.
-- Legacy rows remain nullable until those objects are re-uploaded using the
-- authenticated Rust media wrapper.

alter table public.media_objects
  add column if not exists key_envelope text;

alter table public.media_objects
  add constraint media_objects_key_envelope_format
  check (
    key_envelope is null
    or (
      char_length(key_envelope) between 32 and 8192
      and key_envelope ~ '^[A-Za-z0-9_+/=.-]+$'
    )
  )
  not valid;

alter table public.media_objects
  validate constraint media_objects_key_envelope_format;

grant insert(key_envelope) on public.media_objects to authenticated;

comment on column public.media_objects.key_envelope is
  'Ciphertext-only envelope for the per-object media key. The Rust MLS client must encrypt it before upload; never store a raw file key here.';
