-- Authenticated MLS bootstrap and message transport.
-- Public device material and opaque ciphertext only. Private keys never leave device.

create or replace function public.publish_my_mls_device(
  p_device_id uuid,p_device_label text,p_platform text,p_identity_key_public text,
  p_signed_prekey_public text,p_signed_prekey_signature text,p_fingerprint text,
  p_key_version integer,p_key_package text
) returns void language plpgsql security definer
set search_path = pg_catalog, public, auth as $$
declare v_user_id uuid := auth.uid();
begin
 if v_user_id is null then raise exception 'authentication_required'; end if;
 if p_device_id is null or p_device_label is null or length(p_device_label) not between 1 and 80
 or p_platform is null or p_platform not in ('android','ios')
 or p_identity_key_public is null or length(p_identity_key_public) not between 32 and 512
 or p_signed_prekey_public is null or length(p_signed_prekey_public) not between 32 and 512
 or p_signed_prekey_signature is null or length(p_signed_prekey_signature) not between 32 and 512
 or p_fingerprint is null or p_fingerprint !~ '^[0-9]{10}$'
 or p_key_version is distinct from 1
 or p_key_package is null or length(p_key_package) not between 32 and 65536
 or p_key_package !~ '^[A-Za-z0-9_-]+$'
 then raise exception 'invalid_mls_device_payload'; end if;

 insert into public.devices(id,user_id,device_label,platform,identity_key_public,signed_prekey_public,signed_prekey_signature,key_version,fingerprint,last_seen_at,revoked_at)
 values(p_device_id,v_user_id,p_device_label,p_platform,p_identity_key_public,p_signed_prekey_public,p_signed_prekey_signature,p_key_version,p_fingerprint,now(),null)
 on conflict(id) do update set device_label=excluded.device_label,platform=excluded.platform,
 identity_key_public=excluded.identity_key_public,signed_prekey_public=excluded.signed_prekey_public,
 signed_prekey_signature=excluded.signed_prekey_signature,key_version=excluded.key_version,
 fingerprint=excluded.fingerprint,last_seen_at=now()
 where public.devices.user_id=v_user_id and public.devices.revoked_at is null;

 if not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=v_user_id and d.revoked_at is null)
 then raise exception 'device_not_owned_or_revoked'; end if;

 insert into public.mls_key_packages(device_id,user_id,key_package,key_version,expires_at)
 values(p_device_id,v_user_id,p_key_package,1,now()+interval '7 days')
 on conflict(device_id) do update set key_package=excluded.key_package,key_version=excluded.key_version,
 expires_at=excluded.expires_at,created_at=now()
 where public.mls_key_packages.user_id=v_user_id;
end; $$;

create or replace function public.register_my_conversation_mls_group(
 p_conversation_id uuid,p_mls_group_id text,p_device_id uuid,p_ciphersuite text,p_epoch bigint
) returns void language plpgsql security definer
set search_path = pg_catalog, public, auth, private as $$
declare v_user_id uuid := auth.uid();
begin
 if v_user_id is null then raise exception 'authentication_required'; end if;
 if p_conversation_id is null or p_mls_group_id is null or length(p_mls_group_id) not between 1 and 512
 or p_ciphersuite is distinct from 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'
 or p_epoch is distinct from 0 or not private.is_conversation_member(p_conversation_id)
 or not exists(select 1 from public.conversations c where c.id=p_conversation_id and c.created_by=v_user_id)
 or not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=v_user_id and d.revoked_at is null)
 then raise exception 'mls_group_registration_not_authorized'; end if;

 insert into public.conversation_mls_groups(conversation_id,mls_group_id,ciphersuite,protocol_version,epoch,status,created_by)
 values(p_conversation_id,p_mls_group_id,p_ciphersuite,1,0,'active',v_user_id)
 on conflict(conversation_id) do nothing;

 if not exists(select 1 from public.conversation_mls_groups g where g.conversation_id=p_conversation_id
 and g.mls_group_id=p_mls_group_id and g.created_by=v_user_id and g.status='active')
 then raise exception 'conversation_mls_group_already_initialized'; end if;

 insert into public.conversation_mls_devices(conversation_id,device_id,user_id,leaf_index,status,joined_epoch)
 values(p_conversation_id,p_device_id,v_user_id,0,'active',0)
 on conflict(conversation_id,device_id) do update set status='active',updated_at=now()
 where public.conversation_mls_devices.user_id=v_user_id;
end; $$;

create or replace function public.send_mls_message(
 p_conversation_id uuid,p_device_id uuid,p_client_message_id uuid,p_ciphertext text,
 p_crypto_header jsonb,p_epoch bigint,p_expires_at timestamptz default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth, private as $$
declare v_user_id uuid := auth.uid(); v_message_id uuid; v_group public.conversation_mls_groups%rowtype;
begin
 if v_user_id is null then raise exception 'authentication_required'; end if;
 if p_conversation_id is null or p_device_id is null or p_client_message_id is null
 or p_ciphertext is null or length(p_ciphertext) not between 1 and 1000000
 or p_crypto_header is null or jsonb_typeof(p_crypto_header) is distinct from 'object'
 or p_crypto_header->>'protocol' is distinct from 'mls'
 or p_crypto_header->>'content_type' is distinct from 'application'
 or p_crypto_header->>'sender_device_id' is distinct from p_device_id::text
 or (p_expires_at is not null and p_expires_at<=now())
 then raise exception 'invalid_mls_message_envelope'; end if;
 if not private.is_conversation_member(p_conversation_id) then raise exception 'conversation_membership_required'; end if;
 select * into v_group from public.conversation_mls_groups g where g.conversation_id=p_conversation_id and g.status='active' for share;
 if not found or v_group.mls_group_id is distinct from p_crypto_header->>'group_id'
 or v_group.epoch is distinct from p_epoch or coalesce((p_crypto_header->>'epoch')::bigint,-1)<>p_epoch
 then raise exception 'mls_group_or_epoch_mismatch'; end if;
 if not exists(select 1 from public.conversation_mls_devices d join public.devices dev on dev.id=d.device_id
 where d.conversation_id=p_conversation_id and d.device_id=p_device_id and d.user_id=v_user_id
 and d.status='active' and dev.revoked_at is null)
 then raise exception 'active_mls_device_membership_required'; end if;

 insert into public.messages(conversation_id,sender_id,client_message_id,message_type,ciphertext,nonce,crypto_header,key_version,expires_at)
 values(p_conversation_id,v_user_id,p_client_message_id,'text',p_ciphertext,'mls-rfc9420',p_crypto_header,1,p_expires_at)
 on conflict(sender_id,client_message_id) do nothing returning id into v_message_id;
 if v_message_id is null then
 select m.id into v_message_id from public.messages m where m.sender_id=v_user_id
 and m.client_message_id=p_client_message_id and m.conversation_id=p_conversation_id;
 end if;
 if v_message_id is null then raise exception 'mls_message_insert_failed'; end if;
 return v_message_id;
end; $$;

revoke all on function public.publish_my_mls_device(uuid,text,text,text,text,text,text,integer,text) from public,anon;
revoke all on function public.register_my_conversation_mls_group(uuid,text,uuid,text,bigint) from public,anon;
revoke all on function public.send_mls_message(uuid,uuid,uuid,text,jsonb,bigint,timestamptz) from public,anon;
grant execute on function public.publish_my_mls_device(uuid,text,text,text,text,text,text,integer,text) to authenticated;
grant execute on function public.register_my_conversation_mls_group(uuid,text,uuid,text,bigint) to authenticated;
grant execute on function public.send_mls_message(uuid,uuid,uuid,text,jsonb,bigint,timestamptz) to authenticated;
