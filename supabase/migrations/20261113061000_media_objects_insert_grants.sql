-- The media Worker authenticates with the user's JWT and inserts one
-- metadata row after storing ciphertext in private R2. Restore the narrowly
-- scoped column INSERT grants required by that API. RLS continues to require
-- owner_id=auth.uid() and conversation membership for non-avatar media.

grant insert (
  owner_id,
  conversation_id,
  media_kind,
  object_key,
  content_type,
  size_bytes,
  content_sha256,
  crypto_version,
  key_envelope,
  encrypted
) on public.media_objects to authenticated;
