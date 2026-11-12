# Cloudflare R2 media storage

ChitChat stores encrypted media bytes in the private Cloudflare R2 bucket `chitchat-media`.
Supabase remains the identity, authorization, metadata, and realtime control plane.

## Worker
- Name: `chitchat-media-api`
- Binding: `MEDIA` -> R2 bucket `chitchat-media`
- URL: `https://chitchat-media-api.alizonecontacts.workers.dev`
- Upload limit in the first implementation: 50 MiB per object.
- The bucket is private. Do not enable the public `r2.dev` domain.

## API
- `POST /v1/conversations/:conversationId/media`
  - Requires a Supabase bearer session.
  - Requires `X-ChitChat-Media-Kind: image|video|audio|file`.
  - Requires `X-Content-SHA256` of the encrypted byte stream.
  - Body must contain ciphertext bytes, never plaintext media.
- `POST /v1/avatars`
  - Requires a Supabase bearer session.
  - Stores encrypted avatar bytes and updates `profiles.avatar_path`.
- `GET /v1/media/:mediaId`
  - Requires a valid Supabase bearer session and an RLS-visible media row.
  - Returns encrypted bytes as `application/octet-stream`.
- `DELETE /v1/media/:mediaId`
  - Only the owner can delete an object.

The app must encrypt media locally through the Rust crypto layer before upload and verify
the SHA-256 digest after download. The current Rust crate does not yet implement this
encryption or hashing flow. The upload API therefore must not be enabled in the UI until
the native Rust bridge is complete.

## Secrets and credentials
The Worker uses only the Supabase project URL and publishable key as configuration.
It does not contain the Supabase service-role key or Cloudflare R2 S3 credentials.
The private R2 bucket is accessed through the Worker R2 binding.
