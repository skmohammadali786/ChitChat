-- Per-user, per-device trust assertions. The client only writes a trust
-- record after the local Rust verifier checks the signed device bundle and
-- the user confirms the matching fingerprint over a second channel.

create table if not exists public.device_trust (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  device_owner_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null check(fingerprint ~ '^[0-9]{10}$'),
  verified_at timestamptz not null default now(),
  primary key(user_id,device_id),
  constraint device_trust_not_self check(user_id<>device_owner_id)
);

create index if not exists device_trust_owner_idx on public.device_trust(device_owner_id);
alter table public.device_trust enable row level security;
revoke all on public.device_trust from public,anon,authenticated;

create or replace function private.list_peer_devices_impl(
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
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_conversation_id is null or target_user_id is null or target_user_id=auth.uid() then
    raise exception 'Choose a valid peer account and conversation.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id=target_conversation_id and user_id=auth.uid()
  ) or not exists (
    select 1 from public.conversation_members
    where conversation_id=target_conversation_id and user_id=target_user_id
  ) then
    raise exception 'Both accounts must belong to this conversation.' using errcode='42501';
  end if;
  if private.is_blocked_between(target_user_id) then
    raise exception 'Device verification is unavailable for blocked accounts.' using errcode='42501';
  end if;

  return query
    select
      d.id,d.user_id,d.device_label,d.platform,d.identity_key_public,
      d.signed_prekey_public,d.signed_prekey_signature,d.fingerprint,
      d.key_version,d.created_at,d.last_seen_at,
      (t.device_id is not null and t.fingerprint=d.fingerprint),
      case when t.fingerprint=d.fingerprint then t.verified_at else null end
    from public.devices d
    left join public.device_trust t
      on t.device_id=d.id and t.user_id=auth.uid()
    where d.user_id=target_user_id and d.revoked_at is null
    order by d.last_seen_at desc;
end;
$$;
revoke all on function private.list_peer_devices_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.list_peer_devices_impl(uuid,uuid) to authenticated;

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
language sql
security invoker
set search_path=''
as $$
  select * from private.list_peer_devices_impl(target_conversation_id,target_user_id);
$$;
revoke all on function public.list_peer_devices(uuid,uuid) from public,anon;
grant execute on function public.list_peer_devices(uuid,uuid) to authenticated;

create or replace function private.trust_peer_device_impl(
  target_device_id uuid,
  expected_fingerprint text
)
returns timestamptz
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_fingerprint text;
  v_verified_at timestamptz;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_device_id is null or expected_fingerprint is null
     or expected_fingerprint !~ '^[0-9]{10}$' then
    raise exception 'A valid device and ten-digit fingerprint are required.' using errcode='22023';
  end if;

  select d.user_id,d.fingerprint into v_owner,v_fingerprint
    from public.devices d
    where d.id=target_device_id and d.revoked_at is null
    for update;
  if v_owner is null or v_fingerprint is null then
    raise exception 'Active device with a signed fingerprint not found.' using errcode='P0002';
  end if;
  if v_owner=v_me then
    raise exception 'You cannot verify your own device.' using errcode='22023';
  end if;
  if v_fingerprint<>expected_fingerprint then
    raise exception 'The device fingerprint changed. Verify the new code first.' using errcode='22023';
  end if;
  if private.is_blocked_between(v_owner) then
    raise exception 'Device verification is unavailable for blocked accounts.' using errcode='42501';
  end if;
  if not exists (
    select 1
    from public.conversation_members mine
    join public.conversation_members peer
      on peer.conversation_id=mine.conversation_id
    where mine.user_id=v_me and peer.user_id=v_owner
  ) then
    raise exception 'You must share a conversation before verifying this device.' using errcode='42501';
  end if;

  insert into public.device_trust(user_id,device_id,device_owner_id,fingerprint,verified_at)
    values(v_me,target_device_id,v_owner,v_fingerprint,now())
    on conflict(user_id,device_id) do update
      set device_owner_id=excluded.device_owner_id,
          fingerprint=excluded.fingerprint,
          verified_at=excluded.verified_at
    returning verified_at into v_verified_at;

  return v_verified_at;
end;
$$;
revoke all on function private.trust_peer_device_impl(uuid,text) from public,anon,authenticated;
grant execute on function private.trust_peer_device_impl(uuid,text) to authenticated;

create or replace function public.trust_peer_device(
  target_device_id uuid,
  expected_fingerprint text
)
returns timestamptz
language sql
security invoker
set search_path=''
as $$
  select private.trust_peer_device_impl(target_device_id,expected_fingerprint);
$$;
revoke all on function public.trust_peer_device(uuid,text) from public,anon;
grant execute on function public.trust_peer_device(uuid,text) to authenticated;

create or replace function private.untrust_peer_device_impl(target_device_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  delete from public.device_trust
    where user_id=auth.uid() and device_id=target_device_id;
end;
$$;
revoke all on function private.untrust_peer_device_impl(uuid) from public,anon,authenticated;
grant execute on function private.untrust_peer_device_impl(uuid) to authenticated;

create or replace function public.untrust_peer_device(target_device_id uuid)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.untrust_peer_device_impl(target_device_id);
$$;
revoke all on function public.untrust_peer_device(uuid) from public,anon;
grant execute on function public.untrust_peer_device(uuid) to authenticated;
