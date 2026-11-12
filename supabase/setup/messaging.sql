-- ChitChat messaging and identity schema.
-- Apply after supabase/setup/profiles.sql. Mirrors the deployed project schema.
-- The private schema stays outside the Data API exposed schema list. This grant
-- lets invoker wrappers call the security-definer implementations inside it.
grant usage on schema private to authenticated;

create table if not exists public.user_blocks (
 blocker_id uuid not null references auth.users(id) on delete cascade,
 blocked_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_id,blocked_id),
 constraint user_blocks_not_self check(blocker_id<>blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from public,anon;
grant select,insert,delete on public.user_blocks to authenticated;
drop policy if exists blocks_select_own on public.user_blocks;
create policy blocks_select_own on public.user_blocks for select to authenticated using(blocker_id=(select auth.uid()));
drop policy if exists blocks_insert_own on public.user_blocks;
create policy blocks_insert_own on public.user_blocks for insert to authenticated with check(blocker_id=(select auth.uid()) and blocked_id<>(select auth.uid()));
drop policy if exists blocks_delete_own on public.user_blocks;
create policy blocks_delete_own on public.user_blocks for delete to authenticated using(blocker_id=(select auth.uid()));
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);

create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('direct','group')),
 created_by uuid not null references auth.users(id) on delete restrict,
 title text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint conversations_title_length check(title is null or char_length(title) between 1 and 80)
);
create index if not exists conversations_created_by_idx on public.conversations(created_by);

create table if not exists public.conversation_members (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in ('owner','admin','member')),
 joined_at timestamptz not null default now(),
 last_read_at timestamptz,
 primary key(conversation_id,user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id,joined_at desc);

create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete restrict,
 client_message_id uuid not null,
 message_type text not null check(message_type in ('text','image','video','audio','file','system')),
 ciphertext text not null check(char_length(ciphertext) between 1 and 1000000),
 nonce text not null check(char_length(nonce) between 1 and 256),
 crypto_header jsonb not null default '{}'::jsonb,
 key_version integer not null check(key_version>0),
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 constraint messages_idempotency unique(sender_id,client_message_id)
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at desc);
create index if not exists messages_expiry_idx on public.messages(expires_at) where expires_at is not null;

create table if not exists public.devices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 device_label text not null check(char_length(device_label) between 1 and 80),
 platform text not null check(platform in ('android','ios')),
 identity_key_public text not null,
 signed_prekey_public text not null,
 signed_prekey_signature text not null,
 key_version integer not null default 1 check(key_version>0),
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now()
);
create index if not exists devices_user_active_idx on public.devices(user_id,created_at desc) where revoked_at is null;

create table if not exists public.message_reactions (
 message_id uuid not null references public.messages(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 reaction text not null check(reaction in ('❤️','😂','😮','😢','👍','👎','🔥','🎉')),
 created_at timestamptz not null default now(),
 primary key(message_id,user_id,reaction)
);
create index if not exists message_reactions_user_idx on public.message_reactions(user_id);

create table if not exists private.message_reports (
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid not null references auth.users(id) on delete cascade,
 message_id uuid references public.messages(id) on delete set null,
 conversation_id uuid references public.conversations(id) on delete set null,
 reason text not null check(reason in ('spam','harassment','threats','nudity','impersonation','other')),
 details text not null default '',
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 constraint report_details_length check(char_length(details)<=1000)
);
alter table private.message_reports enable row level security;
drop policy if exists message_reports_no_client_access on private.message_reports;
create policy message_reports_no_client_access on private.message_reports for all to anon,authenticated using(false) with check(false);
create index if not exists message_reports_reporter_idx on private.message_reports(reporter_id);
create index if not exists message_reports_message_idx on private.message_reports(message_id);
create index if not exists message_reports_conversation_idx on private.message_reports(conversation_id);

-- Security-definer helpers are isolated in the non-exposed private schema.
create or replace function private.is_conversation_member(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid() is not null and exists(
  select 1 from public.conversation_members m
  where m.conversation_id=target_conversation_id and m.user_id=auth.uid()
 );
$$;
revoke all on function private.is_conversation_member(uuid) from public,anon,authenticated;
grant execute on function private.is_conversation_member(uuid) to authenticated;

create or replace function private.is_blocked_between(other_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from public.user_blocks b
  where (b.blocker_id=auth.uid() and b.blocked_id=other_user_id)
     or (b.blocker_id=other_user_id and b.blocked_id=auth.uid())
 );
$$;
revoke all on function private.is_blocked_between(uuid) from public,anon,authenticated;
grant execute on function private.is_blocked_between(uuid) to authenticated;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.devices enable row level security;
alter table public.message_reactions enable row level security;
revoke all on public.conversations,public.conversation_members,public.messages,public.devices,public.message_reactions from public,anon;
grant select on public.conversations,public.conversation_members,public.messages,public.devices,public.message_reactions to authenticated;
grant update(title) on public.conversations to authenticated;
grant update(last_read_at) on public.conversation_members to authenticated;
grant insert(conversation_id,sender_id,client_message_id,message_type,ciphertext,nonce,crypto_header,key_version,expires_at) on public.messages to authenticated;
grant delete on public.messages to authenticated;
grant insert(user_id,device_label,platform,identity_key_public,signed_prekey_public,signed_prekey_signature,key_version) on public.devices to authenticated;
grant update(device_label,last_seen_at,revoked_at) on public.devices to authenticated;
grant insert(message_id,user_id,reaction) on public.message_reactions to authenticated;
grant delete on public.message_reactions to authenticated;

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations for select to authenticated using(private.is_conversation_member(id));
drop policy if exists conversations_update_creator on public.conversations;
create policy conversations_update_creator on public.conversations for update to authenticated using(created_by=(select auth.uid())) with check(created_by=(select auth.uid()));
drop policy if exists conversation_members_select_member on public.conversation_members;
create policy conversation_members_select_member on public.conversation_members for select to authenticated using(private.is_conversation_member(conversation_id));
drop policy if exists conversation_members_update_self on public.conversation_members;
create policy conversation_members_update_self on public.conversation_members for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated using(private.is_conversation_member(conversation_id));
drop policy if exists messages_insert_self_member on public.messages;
create policy messages_insert_self_member on public.messages for insert to authenticated with check(sender_id=(select auth.uid()) and private.is_conversation_member(conversation_id));
drop policy if exists messages_delete_self on public.messages;
create policy messages_delete_self on public.messages for delete to authenticated using(sender_id=(select auth.uid()));
drop policy if exists devices_select_self on public.devices;
create policy devices_select_self on public.devices for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists devices_insert_self on public.devices;
create policy devices_insert_self on public.devices for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists devices_update_self on public.devices;
create policy devices_update_self on public.devices for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists reactions_select_member on public.message_reactions;
create policy reactions_select_member on public.message_reactions for select to authenticated using(exists(select 1 from public.messages m where m.id=message_id and private.is_conversation_member(m.conversation_id)));
drop policy if exists reactions_insert_self_member on public.message_reactions;
create policy reactions_insert_self_member on public.message_reactions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.messages m where m.id=message_id and private.is_conversation_member(m.conversation_id)));
drop policy if exists reactions_delete_self on public.message_reactions;
create policy reactions_delete_self on public.message_reactions for delete to authenticated using(user_id=(select auth.uid()));

create or replace function private.lookup_profile_by_username_impl(search_username text)
returns table(id uuid,username text,display_name text,avatar_path text)
language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_username text:=lower(trim(search_username)); v_count integer;
begin
 if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if v_username is null or v_username !~ '^[a-z0-9_]{3,20}$' then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_me::text,1));
 delete from private.profile_search_events e where e.requester_id=v_me and e.searched_at<now()-interval '1 minute';
 select count(*)::integer into v_count from private.profile_search_events e where e.requester_id=v_me;
 if v_count>=20 then raise exception 'Too many lookups. Try again in a minute.' using errcode='P0001'; end if;
 insert into private.profile_search_events(requester_id) values(v_me);
 return query select p.id,p.username,p.display_name,p.avatar_path
 from public.profiles p where lower(p.username)=v_username and p.discoverable and p.id<>v_me and not private.is_blocked_between(p.id) limit 1;
end;
$$;
revoke all on function private.lookup_profile_by_username_impl(text) from public,anon,authenticated;
grant execute on function private.lookup_profile_by_username_impl(text) to authenticated;
create or replace function public.lookup_profile_by_username(search_username text)
returns table(id uuid,username text,display_name text,avatar_path text)
language sql stable security invoker set search_path=''
as $$ select * from private.lookup_profile_by_username_impl(search_username); $$;
revoke all on function public.lookup_profile_by_username(text) from public,anon;
grant execute on function public.lookup_profile_by_username(text) to authenticated;

create or replace function private.create_direct_conversation_impl(target_user_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_id uuid;
begin
 if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if target_user_id is null or target_user_id=v_me then raise exception 'Invalid recipient' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles p where p.id=target_user_id and p.discoverable) then raise exception 'Recipient is not discoverable' using errcode='P0002'; end if;
 if private.is_blocked_between(target_user_id) then raise exception 'This conversation is unavailable' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_me::text,target_user_id::text)||':'||greatest(v_me::text,target_user_id::text),0));
 select c.id into v_id from public.conversations c
 join public.conversation_members a on a.conversation_id=c.id and a.user_id=v_me
 join public.conversation_members b on b.conversation_id=c.id and b.user_id=target_user_id
 where c.kind='direct' and (select count(*) from public.conversation_members z where z.conversation_id=c.id)=2 limit 1;
 if v_id is not null then return v_id; end if;
 insert into public.conversations(kind,created_by) values('direct',v_me) returning id into v_id;
 insert into public.conversation_members(conversation_id,user_id,role) values(v_id,v_me,'owner'),(v_id,target_user_id,'member');
 return v_id;
end;
$$;
revoke all on function private.create_direct_conversation_impl(uuid) from public,anon,authenticated;
grant execute on function private.create_direct_conversation_impl(uuid) to authenticated;
create or replace function public.create_direct_conversation(target_user_id uuid)
returns uuid language sql security invoker set search_path=''
as $$ select private.create_direct_conversation_impl(target_user_id); $$;
revoke all on function public.create_direct_conversation(uuid) from public,anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

create or replace function private.list_my_conversations_impl()
returns table(conversation_id uuid,conversation_kind text,conversation_title text,updated_at timestamptz,other_user_id uuid,other_username text,other_display_name text,other_avatar_path text)
language sql stable security definer set search_path=''
as $$
 select c.id,c.kind,c.title,c.updated_at,other_m.user_id,p.username,p.display_name,p.avatar_path
 from public.conversations c
 join public.conversation_members mine on mine.conversation_id=c.id and mine.user_id=auth.uid()
 left join lateral(select m.user_id from public.conversation_members m where m.conversation_id=c.id and m.user_id<>auth.uid() order by m.joined_at limit 1) other_m on true
 left join public.profiles p on p.id=other_m.user_id
 order by c.updated_at desc limit 200;
$$;
revoke all on function private.list_my_conversations_impl() from public,anon,authenticated;
grant execute on function private.list_my_conversations_impl() to authenticated;
create or replace function public.list_my_conversations()
returns table(conversation_id uuid,conversation_kind text,conversation_title text,updated_at timestamptz,other_user_id uuid,other_username text,other_display_name text,other_avatar_path text)
language sql stable security invoker set search_path=''
as $$ select * from private.list_my_conversations_impl(); $$;
revoke all on function public.list_my_conversations() from public,anon;
grant execute on function public.list_my_conversations() to authenticated;

create or replace function private.touch_conversation_after_message()
returns trigger language plpgsql security definer set search_path=''
as $$ begin update public.conversations set updated_at=now() where id=new.conversation_id; return new; end; $$;
revoke all on function private.touch_conversation_after_message() from public,anon,authenticated;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages for each row execute function private.touch_conversation_after_message();

create or replace function private.report_message_impl(target_message_id uuid,target_reason text,report_details text default '')
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_conv uuid; v_id uuid;
begin
 if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select m.conversation_id into v_conv from public.messages m where m.id=target_message_id;
 if v_conv is null or not private.is_conversation_member(v_conv) then raise exception 'Message not found' using errcode='P0002'; end if;
 insert into private.message_reports(reporter_id,message_id,conversation_id,reason,details) values(v_me,target_message_id,v_conv,target_reason,coalesce(report_details,'')) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function private.report_message_impl(uuid,text,text) from public,anon,authenticated;
grant execute on function private.report_message_impl(uuid,text,text) to authenticated;
create or replace function public.report_message(target_message_id uuid,target_reason text,report_details text default '')
returns uuid language sql security invoker set search_path=''
as $$ select private.report_message_impl(target_message_id,target_reason,report_details); $$;
revoke all on function public.report_message(uuid,text,text) from public,anon;
grant execute on function public.report_message(uuid,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('chitchat-avatars','chitchat-avatars',false,5242880,array['image/jpeg','image/png','image/webp']),
 ('chitchat-media','chitchat-media',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','audio/mpeg','audio/mp4','application/octet-stream'])
on conflict(id) do update set public=false;
drop policy if exists chitchat_avatar_read_self on storage.objects;
create policy chitchat_avatar_read_self on storage.objects for select to authenticated using(bucket_id='chitchat-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists chitchat_avatar_insert_self on storage.objects;
create policy chitchat_avatar_insert_self on storage.objects for insert to authenticated with check(bucket_id='chitchat-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists chitchat_avatar_update_self on storage.objects;
create policy chitchat_avatar_update_self on storage.objects for update to authenticated using(bucket_id='chitchat-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='chitchat-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists chitchat_avatar_delete_self on storage.objects;
create policy chitchat_avatar_delete_self on storage.objects for delete to authenticated using(bucket_id='chitchat-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists chitchat_media_read_members on storage.objects;
create policy chitchat_media_read_members on storage.objects for select to authenticated using(bucket_id='chitchat-media' and exists(select 1 from public.conversation_members cm where cm.conversation_id::text=(storage.foldername(name))[1] and cm.user_id=(select auth.uid())));
drop policy if exists chitchat_media_insert_members on storage.objects;
create policy chitchat_media_insert_members on storage.objects for insert to authenticated with check(bucket_id='chitchat-media' and exists(select 1 from public.conversation_members cm where cm.conversation_id::text=(storage.foldername(name))[1] and cm.user_id=(select auth.uid())));
drop policy if exists chitchat_media_delete_owner on storage.objects;
create policy chitchat_media_delete_owner on storage.objects for delete to authenticated using(bucket_id='chitchat-media' and owner_id=(select auth.uid())::text);

do $$ begin
 if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
  alter publication supabase_realtime add table public.messages;
 end if;
end $$;
