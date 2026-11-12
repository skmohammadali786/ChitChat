alter table public.media_objects
  add column crypto_version integer not null default 1
  check (crypto_version > 0);

comment on column public.media_objects.crypto_version is
  'Version of the client-side Rust media encryption format used for this object.';
