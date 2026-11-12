-- ChitChat feature foundations: group administration, receipts, settings,
-- scheduled encrypted messages, push-device registration and entitlements.

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system' check(theme in ('system','light','dark')),
  accent_palette text not null default 'violet' check(accent_palette ~ '^[a-z0-9_-]{2,24}$'),
  auto_reveal_secrets boolean not null default false,
  show_read_receipts boolean not null default true,
  show_last_seen boolean not null default true,
  show_online_status boolean not null default true,
  show_typing_status boolean not null default true,
  notification_preview text not null default 'sender' check(notification_preview in ('none','sender','full')),
  app_lock_enabled boolean not null default false,
  biometric_unlock_enabled boolean not null default false,
  phone_discovery_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
revoke all on public.user_settings from public,anon;
grant select,insert,update on public.user_settings to authenticated;
create policy user_settings_select_own on public.user_settings for select to authenticated using(user_id=(select auth.uid()));
create policy user_settings_insert_own on public.user_settings for insert to authenticated with check(user_id=(select auth.uid()));
create policy user_settings_update_own on public.user_settings for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create table public.conversation_user_settings (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pinned_at timestamptz,
  muted_until timestamptz,
  archived_at timestamptz,
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create index conversation_user_settings_user_idx on public.conversation_user_settings(user_id,updated_at desc);
alter table public.conversation_user_settings enable row level security;
revoke all on public.conversation_user_settings from public,anon;
grant select,insert,update,delete on public.conversation_user_settings to authenticated;
create policy conversation_user_settings_select_own on public.conversation_user_settings for select to authenticated using(user_id=(select auth.uid()) and private.is_conversation_member(conversation_id));
create policy conversation_user_settings_insert_own on public.conversation_user_settings for insert to authenticated with check(user_id=(select auth.uid()) and private.is_conversation_member(conversation_id));
create policy conversation_user_settings_update_own on public.conversation_user_settings for update to authenticated using(user_id=(select auth.uid()) and private.is_conversation_member(conversation_id)) with check(user_id=(select auth.uid()) and private.is_conversation_member(conversation_id));
create policy conversation_user_settings_delete_own on public.conversation_user_settings for delete to authenticated using(user_id=(select auth.uid()));

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check(platform in ('android','ios')),
  device_label text not null default 'Mobile device' check(char_length(device_label) between 1 and 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index push_devices_user_active_idx on public.push_devices(user_id,last_seen_at desc) where revoked_at is null;
alter table public.push_devices enable row level security;
revoke all on public.push_devices from public,anon;
grant select,insert,update,delete on public.push_devices to authenticated;
create policy push_devices_select_own on public.push_devices for select to authenticated using(user_id=(select auth.uid()));
create policy push_devices_insert_own on public.push_devices for insert to authenticated with check(user_id=(select auth.uid()));
create policy push_devices_update_own on public.push_devices for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy push_devices_delete_own on public.push_devices for delete to authenticated using(user_id=(select auth.uid()));

create table public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key(message_id,recipient_id)
);
create index message_receipts_recipient_read_idx on public.message_receipts(recipient_id,read_at,delivered_at);
alter table public.message_receipts enable row level security;
revoke all on public.message_receipts from public,anon;
grant select on public.message_receipts to authenticated;
create policy message_receipts_select_conversation_member on public.message_receipts for select to authenticated
using (
  recipient_id=(select auth.uid())
  or exists (
    select 1 from public.messages m
    where m.id=message_id and private.is_conversation_member(m.conversation_id)
  )
);

create or replace function private.create_message_receipts()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.message_receipts(message_id,recipient_id)
  select new.id,cm.user_id
  from public.conversation_members cm
  where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id
  on conflict(message_id,recipient_id) do nothing;
  return new;
end;
$$;
revoke all on function private.create_message_receipts() from public,anon,authenticated;
drop trigger if exists messages_create_receipts on public.messages;
create trigger messages_create_receipts after insert on public.messages
for each row execute function private.create_message_receipts();

create or replace function private.mark_message_delivered_impl(target_message_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_conversation_id uuid;
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select m.conversation_id into v_conversation_id from public.messages m where m.id=target_message_id;
  if v_conversation_id is null or not private.is_conversation_member(v_conversation_id) then
    raise exception 'Message not found' using errcode='P0002';
  end if;
  update public.message_receipts set delivered_at=coalesce(delivered_at,now())
    where message_id=target_message_id and recipient_id=v_me;
end;
$$;
revoke all on function private.mark_message_delivered_impl(uuid) from public,anon,authenticated;
grant execute on function private.mark_message_delivered_impl(uuid) to authenticated;
create or replace function public.mark_message_delivered(target_message_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.mark_message_delivered_impl(target_message_id); $$;
revoke all on function public.mark_message_delivered(uuid) from public,anon;
grant execute on function public.mark_message_delivered(uuid) to authenticated;

create or replace function private.mark_conversation_read_impl(target_conversation_id uuid, read_through timestamptz default now())
returns integer language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_count integer;
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not private.is_conversation_member(target_conversation_id) then raise exception 'Conversation not found' using errcode='P0002'; end if;
  update public.message_receipts r
    set delivered_at=coalesce(r.delivered_at,now()),read_at=coalesce(r.read_at,now())
    from public.messages m
    where r.message_id=m.id and r.recipient_id=v_me
      and m.conversation_id=target_conversation_id
      and m.created_at<=coalesce(read_through,now()) and r.read_at is null;
  get diagnostics v_count = row_count;
  update public.conversation_members
    set last_read_at=greatest(coalesce(last_read_at,'epoch'::timestamptz),coalesce(read_through,now()))
    where conversation_id=target_conversation_id and user_id=v_me;
  return v_count;
end;
$$;
revoke all on function private.mark_conversation_read_impl(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.mark_conversation_read_impl(uuid,timestamptz) to authenticated;
create or replace function public.mark_conversation_read(target_conversation_id uuid, read_through timestamptz default now())
returns integer language sql security invoker set search_path=''
as $$ select private.mark_conversation_read_impl(target_conversation_id,read_through); $$;
revoke all on function public.mark_conversation_read(uuid,timestamptz) from public,anon;
grant execute on function public.mark_conversation_read(uuid,timestamptz) to authenticated;

create table public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_message_id uuid not null,
  message_type text not null check(message_type in ('text','image','video','audio','file')),
  ciphertext text not null check(char_length(ciphertext) between 1 and 1000000),
  nonce text not null check(char_length(nonce) between 1 and 256),
  crypto_header jsonb not null default '{}'::jsonb,
  key_version integer not null check(key_version>0),
  send_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','sent','cancelled','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failure_code text,
  constraint scheduled_messages_idempotency unique(sender_id,client_message_id)
);
create index scheduled_messages_due_idx on public.scheduled_messages(send_at) where status='pending';
create index scheduled_messages_sender_idx on public.scheduled_messages(sender_id,created_at desc);
alter table public.scheduled_messages enable row level security;
revoke all on public.scheduled_messages from public,anon;
grant select,insert,update,delete on public.scheduled_messages to authenticated;
create policy scheduled_messages_select_own on public.scheduled_messages for select to authenticated using(sender_id=(select auth.uid()) and private.is_conversation_member(conversation_id));
create policy scheduled_messages_insert_own on public.scheduled_messages for insert to authenticated with check(sender_id=(select auth.uid()) and private.is_conversation_member(conversation_id) and send_at>now());
create policy scheduled_messages_update_own on public.scheduled_messages for update to authenticated using(sender_id=(select auth.uid()) and status='pending') with check(sender_id=(select auth.uid()) and status in ('pending','cancelled'));
create policy scheduled_messages_delete_own on public.scheduled_messages for delete to authenticated using(sender_id=(select auth.uid()) and status='pending');

create table private.external_secret_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  ciphertext text,
  nonce text,
  crypto_header jsonb not null default '{}'::jsonb,
  key_version integer not null check(key_version>0),
  media_object_id uuid references public.media_objects(id) on delete set null,
  expires_at timestamptz not null,
  max_views integer not null default 1 check(max_views between 1 and 100),
  view_count integer not null default 0 check(view_count>=0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint external_secret_payload check((ciphertext is not null and nonce is not null) or media_object_id is not null)
);
create index external_secret_links_creator_idx on private.external_secret_links(creator_id,created_at desc);
create index external_secret_links_expiry_idx on private.external_secret_links(expires_at) where revoked_at is null;
alter table private.external_secret_links enable row level security;
revoke all on private.external_secret_links from public,anon,authenticated;
create policy external_secret_links_no_client_access on private.external_secret_links for all to anon,authenticated using(false) with check(false);

create table public.subscription_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check(tier in ('free','plus')),
  platform text check(platform in ('android','ios')),
  product_id text,
  status text not null default 'active' check(status in ('active','expired','revoked','grace_period')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.subscription_entitlements enable row level security;
revoke all on public.subscription_entitlements from public,anon;
grant select on public.subscription_entitlements to authenticated;
create policy subscription_entitlements_select_own on public.subscription_entitlements for select to authenticated using(user_id=(select auth.uid()));

create or replace function private.is_group_admin(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id=target_conversation_id and cm.user_id=auth.uid() and cm.role in ('owner','admin')
  );
$$;
revoke all on function private.is_group_admin(uuid) from public,anon,authenticated;
grant execute on function private.is_group_admin(uuid) to authenticated;

create or replace function private.create_group_conversation_impl(group_title text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_ids uuid[]; v_id uuid; v_title text:=trim(group_title);
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if v_title is null or char_length(v_title) not between 1 and 80 then raise exception 'Group name must be 1 to 80 characters.' using errcode='22023'; end if;
  select coalesce(array_agg(distinct x),array[]::uuid[]) into v_ids
    from unnest(coalesce(member_ids,array[]::uuid[])) x where x is not null and x<>v_me;
  if cardinality(v_ids)<1 or cardinality(v_ids)>99 then raise exception 'A group needs 2 to 100 members.' using errcode='22023'; end if;
  if exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.profiles p where p.id=x)) then
    raise exception 'One or more group members do not exist.' using errcode='P0002';
  end if;
  if exists(select 1 from unnest(v_ids) x where private.is_blocked_between(x)) then
    raise exception 'A selected member is blocked.' using errcode='42501';
  end if;
  insert into public.conversations(kind,created_by,title) values('group',v_me,v_title) returning id into v_id;
  insert into public.conversation_members(conversation_id,user_id,role) values(v_id,v_me,'owner');
  insert into public.conversation_members(conversation_id,user_id,role)
    select v_id,x,'member' from unnest(v_ids) x;
  return v_id;
end;
$$;
revoke all on function private.create_group_conversation_impl(text,uuid[]) from public,anon,authenticated;
grant execute on function private.create_group_conversation_impl(text,uuid[]) to authenticated;
create or replace function public.create_group_conversation(group_title text, member_ids uuid[])
returns uuid language sql security invoker set search_path=''
as $$ select private.create_group_conversation_impl(group_title,member_ids); $$;
revoke all on function public.create_group_conversation(text,uuid[]) from public,anon;
grant execute on function public.create_group_conversation(text,uuid[]) to authenticated;

create or replace function private.add_group_members_impl(target_conversation_id uuid, member_ids uuid[])
returns integer language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_ids uuid[]; v_count integer;
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not exists(select 1 from public.conversations c where c.id=target_conversation_id and c.kind='group') or not private.is_group_admin(target_conversation_id) then
    raise exception 'Only group admins can add members.' using errcode='42501';
  end if;
  select coalesce(array_agg(distinct x),array[]::uuid[]) into v_ids
    from unnest(coalesce(member_ids,array[]::uuid[])) x where x is not null and x<>v_me;
  if cardinality(v_ids)=0 then return 0; end if;
  if exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.profiles p where p.id=x)) then
    raise exception 'One or more group members do not exist.' using errcode='P0002';
  end if;
  if exists(select 1 from unnest(v_ids) x where private.is_blocked_between(x)) then
    raise exception 'A selected member is blocked.' using errcode='42501';
  end if;
  if (select count(*) from public.conversation_members cm where cm.conversation_id=target_conversation_id)
     + (select count(*) from unnest(v_ids) x where not exists(select 1 from public.conversation_members cm where cm.conversation_id=target_conversation_id and cm.user_id=x)) > 100 then
    raise exception 'Groups are limited to 100 members.' using errcode='22023';
  end if;
  insert into public.conversation_members(conversation_id,user_id,role)
    select target_conversation_id,x,'member' from unnest(v_ids) x
    on conflict(conversation_id,user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.add_group_members_impl(uuid,uuid[]) from public,anon,authenticated;
grant execute on function private.add_group_members_impl(uuid,uuid[]) to authenticated;
create or replace function public.add_group_members(target_conversation_id uuid, member_ids uuid[])
returns integer language sql security invoker set search_path=''
as $$ select private.add_group_members_impl(target_conversation_id,member_ids); $$;
revoke all on function public.add_group_members(uuid,uuid[]) from public,anon;
grant execute on function public.add_group_members(uuid,uuid[]) to authenticated;

create or replace function private.remove_group_member_impl(target_conversation_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_actor_role text; v_target_role text; v_count integer;
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if target_user_id is null then raise exception 'A target member is required.' using errcode='22023'; end if;
  select role into v_actor_role from public.conversation_members where conversation_id=target_conversation_id and user_id=v_me;
  select role into v_target_role from public.conversation_members where conversation_id=target_conversation_id and user_id=target_user_id;
  if v_actor_role is null then raise exception 'You are not a member of this group.' using errcode='42501'; end if;
  if v_target_role is null or not exists(select 1 from public.conversations where id=target_conversation_id and kind='group') then raise exception 'Group member not found.' using errcode='P0002'; end if;
  if v_me<>target_user_id and v_actor_role not in ('owner','admin') then raise exception 'Only group admins can remove another member.' using errcode='42501'; end if;
  if v_target_role='owner' and v_me<>target_user_id then raise exception 'Transfer group ownership before removing the owner.' using errcode='42501'; end if;
  select count(*) into v_count from public.conversation_members where conversation_id=target_conversation_id;
  if v_target_role='owner' and v_me=target_user_id and v_count>1 then raise exception 'Transfer group ownership before leaving.' using errcode='42501'; end if;
  if v_target_role='owner' and v_me=target_user_id and v_count=1 then
    delete from public.conversations where id=target_conversation_id;
  else
    delete from public.conversation_members where conversation_id=target_conversation_id and user_id=target_user_id;
  end if;
end;
$$;
revoke all on function private.remove_group_member_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.remove_group_member_impl(uuid,uuid) to authenticated;
create or replace function public.remove_group_member(target_conversation_id uuid, target_user_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.remove_group_member_impl(target_conversation_id,target_user_id); $$;
revoke all on function public.remove_group_member(uuid,uuid) from public,anon;
grant execute on function public.remove_group_member(uuid,uuid) to authenticated;

create or replace function private.transfer_group_owner_impl(target_conversation_id uuid, new_owner_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid();
begin
  if v_me is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=target_conversation_id and user_id=v_me and role='owner') then raise exception 'Only the current owner can transfer ownership.' using errcode='42501'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=target_conversation_id and user_id=new_owner_id) then raise exception 'The new owner must already be a group member.' using errcode='P0002'; end if;
  update public.conversation_members set role='admin' where conversation_id=target_conversation_id and user_id=v_me;
  update public.conversation_members set role='owner' where conversation_id=target_conversation_id and user_id=new_owner_id;
end;
$$;
revoke all on function private.transfer_group_owner_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.transfer_group_owner_impl(uuid,uuid) to authenticated;
create or replace function public.transfer_group_owner(target_conversation_id uuid, new_owner_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.transfer_group_owner_impl(target_conversation_id,new_owner_id); $$;
revoke all on function public.transfer_group_owner(uuid,uuid) from public,anon;
grant execute on function public.transfer_group_owner(uuid,uuid) to authenticated;

create or replace function private.rename_group_conversation_impl(target_conversation_id uuid, new_title text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_title text:=trim(new_title);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not private.is_group_admin(target_conversation_id) then raise exception 'Only group admins can rename a group.' using errcode='42501'; end if;
  if v_title is null or char_length(v_title) not between 1 and 80 then raise exception 'Group name must be 1 to 80 characters.' using errcode='22023'; end if;
  update public.conversations set title=v_title,updated_at=now() where id=target_conversation_id and kind='group';
  if not found then raise exception 'Group not found.' using errcode='P0002'; end if;
end;
$$;
revoke all on function private.rename_group_conversation_impl(uuid,text) from public,anon,authenticated;
grant execute on function private.rename_group_conversation_impl(uuid,text) to authenticated;
create or replace function public.rename_group_conversation(target_conversation_id uuid, new_title text)
returns void language sql security invoker set search_path=''
as $$ select private.rename_group_conversation_impl(target_conversation_id,new_title); $$;
revoke all on function public.rename_group_conversation(uuid,text) from public,anon;
grant execute on function public.rename_group_conversation(uuid,text) to authenticated;
