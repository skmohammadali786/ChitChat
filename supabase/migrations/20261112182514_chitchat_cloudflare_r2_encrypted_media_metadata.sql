-- Encrypted media metadata for private Cloudflare R2 storage.
-- Binary bytes are never stored in Supabase Storage or Postgres.

create or replace function private.is_profile_discoverable(target_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id=target_user_id and p.discoverable=true
  );
$$;
revoke all on function private.is_profile_discoverable(uuid) from public,anon,authenticated;
grant execute on function private.is_profile_discoverable(uuid) to authenticated;

create table public.media_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  media_kind text not null check(media_kind in ('avatar','image','video','audio','file')),
  object_key text not null unique,
  content_type text not null default 'application/octet-stream' check(content_type='application/octet-stream'),
  size_bytes bigint not null check(size_bytes between 1 and 52428800),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  encrypted boolean not null default true check(encrypted=true),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint media_scope_valid check (
    (media_kind='avatar' and conversation_id is null)
    or (media_kind<>'avatar' and conversation_id is not null)
  )
);
create index media_objects_conversation_created_idx on public.media_objects(conversation_id,created_at desc) where conversation_id is not null;
create index media_objects_owner_created_idx on public.media_objects(owner_id,created_at desc);
create index media_objects_expiry_idx on public.media_objects(expires_at) where expires_at is not null;
alter table public.media_objects enable row level security;
revoke all on public.media_objects from public,anon;
grant select,delete on public.media_objects to authenticated;
grant insert(owner_id,conversation_id,media_kind,object_key,content_type,size_bytes,content_sha256,encrypted) on public.media_objects to authenticated;
create policy media_objects_select_authorized on public.media_objects for select to authenticated using (
  owner_id=(select auth.uid())
  or (conversation_id is not null and private.is_conversation_member(conversation_id))
  or (media_kind='avatar' and private.is_profile_discoverable(owner_id))
);
create policy media_objects_insert_owner on public.media_objects for insert to authenticated with check (
  owner_id=(select auth.uid())
  and (
    (media_kind='avatar' and conversation_id is null)
    or (media_kind<>'avatar' and conversation_id is not null and private.is_conversation_member(conversation_id))
  )
);
create policy media_objects_delete_owner on public.media_objects for delete to authenticated using(owner_id=(select auth.uid()));
comment on table public.media_objects is 'Encrypted media metadata. Object bytes are stored in private Cloudflare R2; Supabase stores authorization metadata only.';
comment on column public.media_objects.object_key is 'Opaque R2 object key. Never a public URL.';
comment on column public.media_objects.content_sha256 is 'SHA-256 digest of encrypted bytes, computed before upload by the client.';
comment on column public.media_objects.encrypted is 'Client assertion. Actual end-to-end encryption must be enforced by the Rust client before upload.';
