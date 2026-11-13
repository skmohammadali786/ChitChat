-- Preserve the authenticated message kind when the MLS wire payload is stored.
-- The message body remains opaque MLS ciphertext.

drop function if exists public.send_mls_message(uuid,uuid,uuid,text,jsonb,bigint,timestamptz);
drop function if exists private.send_mls_message_impl(uuid,uuid,uuid,text,jsonb,bigint,timestamptz);

create or replace function private.send_mls_message_impl(
 p_conversation_id uuid,
 p_device_id uuid,
 p_client_message_id uuid,
 p_message_type text,
 p_ciphertext text,
 p_crypto_header jsonb,
 p_epoch bigint,
 p_expires_at timestamptz default null
) returns uuid language plpgsql security definer
set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_message_id uuid; v_group public.conversation_mls_groups%rowtype;
begin
 if v_user_id is null then raise exception 'authentication_required'; end if;
 if p_conversation_id is null or p_device_id is null or p_client_message_id is null
 or p_message_type is null or p_message_type not in ('text','image','video','audio','file')
 or p_ciphertext is null or length(p_ciphertext) not between 1 and 1000000
 or p_crypto_header is null or jsonb_typeof(p_crypto_header) is distinct from 'object'
 or p_crypto_header->>'protocol' is distinct from 'mls'
 or p_crypto_header->>'content_type' is distinct from 'application'
 or p_crypto_header->>'message_type' is distinct from p_message_type
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
 if exists(select 1 from public.conversation_members cm where cm.conversation_id=p_conversation_id
 and not exists(select 1 from public.conversation_mls_devices md join public.devices d on d.id=md.device_id
 where md.conversation_id=p_conversation_id and md.user_id=cm.user_id and md.status='active' and d.revoked_at is null))
 then raise exception 'mls_roster_incomplete'; end if;

 insert into public.messages(conversation_id,sender_id,client_message_id,message_type,ciphertext,nonce,crypto_header,key_version,expires_at)
 values(p_conversation_id,v_user_id,p_client_message_id,p_message_type,p_ciphertext,'mls-rfc9420',p_crypto_header,1,p_expires_at)
 on conflict(sender_id,client_message_id) do nothing returning id into v_message_id;
 if v_message_id is null then
   select m.id into v_message_id from public.messages m where m.sender_id=v_user_id
   and m.client_message_id=p_client_message_id and m.conversation_id=p_conversation_id;
 end if;
 if v_message_id is null then raise exception 'mls_message_insert_failed'; end if;
 return v_message_id;
end; $$;
revoke all on function private.send_mls_message_impl(uuid,uuid,uuid,text,text,jsonb,bigint,timestamptz) from public,anon,authenticated;
grant execute on function private.send_mls_message_impl(uuid,uuid,uuid,text,text,jsonb,bigint,timestamptz) to authenticated;

create or replace function public.send_mls_message(
 p_conversation_id uuid,
 p_device_id uuid,
 p_client_message_id uuid,
 p_message_type text,
 p_ciphertext text,
 p_crypto_header jsonb,
 p_epoch bigint,
 p_expires_at timestamptz default null
) returns uuid language sql security invoker set search_path=''
as $$ select private.send_mls_message_impl(p_conversation_id,p_device_id,p_client_message_id,p_message_type,p_ciphertext,p_crypto_header,p_epoch,p_expires_at); $$;
revoke all on function public.send_mls_message(uuid,uuid,uuid,text,text,jsonb,bigint,timestamptz) from public,anon;
grant execute on function public.send_mls_message(uuid,uuid,uuid,text,text,jsonb,bigint,timestamptz) to authenticated;
