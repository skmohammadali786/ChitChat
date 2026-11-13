-- End-to-end MLS device enrollment, Welcome delivery and Commit synchronization.
-- All protocol messages remain opaque ciphertext. The server only authorizes routing.

alter table public.mls_key_packages
  add column if not exists package_id uuid default gen_random_uuid();

update public.mls_key_packages set package_id=gen_random_uuid() where package_id is null;
alter table public.mls_key_packages alter column package_id set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid='public.mls_key_packages'::regclass
      and contype='p'
      and pg_get_constraintdef(oid) like 'PRIMARY KEY (device_id)%'
  ) then
    alter table public.mls_key_packages drop constraint mls_key_packages_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.mls_key_packages'::regclass
      and contype='p'
  ) then
    alter table public.mls_key_packages add constraint mls_key_packages_pkey primary key (package_id);
  end if;
end $$;

create index if not exists mls_key_packages_device_expiry_idx
  on public.mls_key_packages(device_id, expires_at);

create table if not exists public.conversation_mls_commits (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversation_mls_groups(conversation_id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_device_id uuid not null references public.devices(id) on delete cascade,
  previous_epoch bigint not null check (previous_epoch >= 0),
  epoch bigint not null check (epoch > 0),
  commit_message text not null check (
    char_length(commit_message) between 16 and 87382
    and commit_message ~ '^[A-Za-z0-9_-]+$'
  ),
  created_at timestamptz not null default now(),
  unique(conversation_id, epoch)
);

create table if not exists public.conversation_mls_commit_deliveries (
  commit_id uuid not null references public.conversation_mls_commits(id) on delete cascade,
  target_device_id uuid not null references public.devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  primary key(commit_id, target_device_id)
);

alter table public.conversation_mls_commits enable row level security;
alter table public.conversation_mls_commit_deliveries enable row level security;
revoke all on public.conversation_mls_commits from public, anon, authenticated;
revoke all on public.conversation_mls_commit_deliveries from public, anon, authenticated;
revoke all on public.mls_key_packages from public, anon, authenticated;
grant select, insert, update, delete on public.mls_key_packages to authenticated;

-- Replace device publication so one device can hold multiple one-time KeyPackages.
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

 insert into public.mls_key_packages(package_id,device_id,user_id,key_package,key_version,expires_at)
 values(gen_random_uuid(),p_device_id,v_user_id,p_key_package,1,now()+interval '7 days');
end; $$;

create or replace function private.get_my_conversation_mls_group_impl(p_conversation_id uuid)
returns table(mls_group_id text,epoch bigint,created_by uuid,status text)
language sql stable security definer set search_path=''
as $$
 select g.mls_group_id,g.epoch,g.created_by,g.status
 from public.conversation_mls_groups g
 where g.conversation_id=p_conversation_id
   and exists(select 1 from public.conversation_members cm where cm.conversation_id=g.conversation_id and cm.user_id=auth.uid());
$$;
revoke all on function private.get_my_conversation_mls_group_impl(uuid) from public,anon,authenticated;
grant execute on function private.get_my_conversation_mls_group_impl(uuid) to authenticated;
create or replace function public.get_my_conversation_mls_group(p_conversation_id uuid)
returns table(mls_group_id text,epoch bigint,created_by uuid,status text)
language sql stable security invoker set search_path=''
as $$ select * from private.get_my_conversation_mls_group_impl(p_conversation_id); $$;
revoke all on function public.get_my_conversation_mls_group(uuid) from public,anon;
grant execute on function public.get_my_conversation_mls_group(uuid) to authenticated;

create or replace function private.list_missing_mls_devices_impl(p_conversation_id uuid)
returns table(target_device_id uuid,target_user_id uuid,key_package_id uuid,key_package text)
language plpgsql stable security definer set search_path=''
as $$
declare v_me uuid := auth.uid();
begin
 if v_me is null then raise exception 'authentication_required'; end if;
 if not exists(select 1 from public.conversation_members cm where cm.conversation_id=p_conversation_id and cm.user_id=v_me and cm.role in ('owner','admin'))
 then raise exception 'mls_group_admin_required'; end if;
 if not exists(select 1 from public.conversation_mls_devices md join public.devices d on d.id=md.device_id
   where md.conversation_id=p_conversation_id and md.user_id=v_me and md.status='active' and d.revoked_at is null)
 then raise exception 'active_mls_admin_device_required'; end if;
 return query
 select distinct on (d.id) d.id,d.user_id,kp.package_id,kp.key_package
 from public.conversation_members cm
 join public.devices d on d.user_id=cm.user_id and d.revoked_at is null
 join public.mls_key_packages kp on kp.device_id=d.id and kp.user_id=d.user_id and kp.expires_at>now()
 where cm.conversation_id=p_conversation_id
   and not exists(select 1 from public.conversation_mls_devices md
     where md.conversation_id=p_conversation_id and md.device_id=d.id and md.status='active')
 order by d.id,kp.created_at desc;
end;
$$;
revoke all on function private.list_missing_mls_devices_impl(uuid) from public,anon,authenticated;
grant execute on function private.list_missing_mls_devices_impl(uuid) to authenticated;
create or replace function public.list_missing_mls_devices(p_conversation_id uuid)
returns table(target_device_id uuid,target_user_id uuid,key_package_id uuid,key_package text)
language sql stable security invoker set search_path=''
as $$ select * from private.list_missing_mls_devices_impl(p_conversation_id); $$;
revoke all on function public.list_missing_mls_devices(uuid) from public,anon;
grant execute on function public.list_missing_mls_devices(uuid) to authenticated;

create or replace function private.publish_mls_member_add_impl(
 p_conversation_id uuid,p_sender_device_id uuid,p_target_device_id uuid,p_key_package_id uuid,
 p_welcome_message text,p_commit_message text,p_previous_epoch bigint,p_epoch bigint
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_me uuid := auth.uid();
 v_group public.conversation_mls_groups%rowtype;
 v_target_user uuid;
 v_commit_id uuid;
begin
 if v_me is null then raise exception 'authentication_required'; end if;
 if p_conversation_id is null or p_sender_device_id is null or p_target_device_id is null
 or p_key_package_id is null or p_welcome_message is null
 or length(p_welcome_message) not between 16 and 87382 or p_welcome_message !~ '^[A-Za-z0-9_-]+$'
 or p_commit_message is null or length(p_commit_message) not between 16 and 87382 or p_commit_message !~ '^[A-Za-z0-9_-]+$'
 or p_previous_epoch is null or p_epoch is distinct from p_previous_epoch+1
 then raise exception 'invalid_mls_membership_commit'; end if;

 select * into v_group from public.conversation_mls_groups g
 where g.conversation_id=p_conversation_id and g.status='active' for update;
 if not found then raise exception 'active_mls_group_required'; end if;

 if not exists(select 1 from public.conversation_members cm where cm.conversation_id=p_conversation_id and cm.user_id=v_me and cm.role in ('owner','admin'))
 then raise exception 'mls_group_admin_required'; end if;
 if not exists(select 1 from public.conversation_mls_devices md join public.devices sd on sd.id=md.device_id
   where md.conversation_id=p_conversation_id and md.device_id=p_sender_device_id and md.user_id=v_me
     and md.status='active' and sd.revoked_at is null)
 then raise exception 'active_mls_sender_device_required'; end if;

 if v_group.epoch=p_epoch and exists(
   select 1 from public.conversation_mls_commits c
   join public.mls_group_welcomes w on w.conversation_id=c.conversation_id and w.sender_device_id=c.sender_device_id
   where c.conversation_id=p_conversation_id and c.epoch=p_epoch and c.sender_device_id=p_sender_device_id
     and c.commit_message=p_commit_message and w.target_device_id=p_target_device_id
     and w.welcome_message=p_welcome_message
 )
 then
   select c.id into v_commit_id from public.conversation_mls_commits c
     where c.conversation_id=p_conversation_id and c.epoch=p_epoch;
   return v_commit_id;
 end if;

 if v_group.epoch is distinct from p_previous_epoch then raise exception 'mls_group_epoch_conflict'; end if;
 if not exists(select 1 from public.conversation_mls_devices md join public.devices sd on sd.id=md.device_id
   where md.conversation_id=p_conversation_id and md.device_id=p_sender_device_id and md.user_id=v_me
     and md.status='active' and sd.revoked_at is null)
 then raise exception 'active_mls_sender_device_required'; end if;

 select d.user_id into v_target_user
 from public.devices d
 join public.conversation_members cm on cm.conversation_id=p_conversation_id and cm.user_id=d.user_id
 join public.mls_key_packages kp on kp.device_id=d.id and kp.user_id=d.user_id
 where d.id=p_target_device_id and kp.package_id=p_key_package_id
   and d.revoked_at is null and kp.expires_at>now()
   and not exists(select 1 from public.conversation_mls_devices md
     where md.conversation_id=p_conversation_id and md.device_id=d.id and md.status='active')
 for update of kp;
 if v_target_user is null then raise exception 'target_mls_key_package_unavailable'; end if;

 insert into public.conversation_mls_commits(
   conversation_id,sender_user_id,sender_device_id,previous_epoch,epoch,commit_message
 ) values(p_conversation_id,v_me,p_sender_device_id,p_previous_epoch,p_epoch,p_commit_message)
 returning id into v_commit_id;

 insert into public.conversation_mls_commit_deliveries(commit_id,target_device_id)
 select v_commit_id,md.device_id
 from public.conversation_mls_devices md
 join public.devices d on d.id=md.device_id and d.revoked_at is null
 where md.conversation_id=p_conversation_id and md.status='active'
   and md.device_id<>p_sender_device_id;

 insert into public.mls_group_welcomes(
   conversation_id,target_device_id,target_user_id,sender_device_id,welcome_message,expires_at
 ) values(p_conversation_id,p_target_device_id,v_target_user,p_sender_device_id,p_welcome_message,now()+interval '24 hours');

 delete from public.mls_key_packages where package_id=p_key_package_id;
 update public.conversation_mls_groups set epoch=p_epoch,updated_at=now()
 where conversation_id=p_conversation_id;
 return v_commit_id;
end;
$$;
revoke all on function private.publish_mls_member_add_impl(uuid,uuid,uuid,uuid,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function private.publish_mls_member_add_impl(uuid,uuid,uuid,uuid,text,text,bigint,bigint) to authenticated;
create or replace function public.publish_mls_member_add(
 p_conversation_id uuid,p_sender_device_id uuid,p_target_device_id uuid,p_key_package_id uuid,
 p_welcome_message text,p_commit_message text,p_previous_epoch bigint,p_epoch bigint
) returns uuid language sql security invoker set search_path=''
as $$ select private.publish_mls_member_add_impl(p_conversation_id,p_sender_device_id,p_target_device_id,p_key_package_id,p_welcome_message,p_commit_message,p_previous_epoch,p_epoch); $$;
revoke all on function public.publish_mls_member_add(uuid,uuid,uuid,uuid,text,text,bigint,bigint) from public,anon;
grant execute on function public.publish_mls_member_add(uuid,uuid,uuid,uuid,text,text,bigint,bigint) to authenticated;

create or replace function private.get_my_mls_welcomes_impl(p_conversation_id uuid,p_device_id uuid)
returns table(welcome_id uuid,conversation_id uuid,welcome_message text,expires_at timestamptz,group_id text,group_epoch bigint)
language plpgsql stable security definer set search_path=''
as $$
begin
 if auth.uid() is null or not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=auth.uid() and d.revoked_at is null)
 then raise exception 'device_not_owned'; end if;
 return query
 select w.id,w.conversation_id,w.welcome_message,w.expires_at,g.mls_group_id,g.epoch
 from public.mls_group_welcomes w
 join public.conversation_mls_groups g on g.conversation_id=w.conversation_id and g.status='active'
 where w.conversation_id=p_conversation_id and w.target_device_id=p_device_id
   and w.target_user_id=auth.uid() and w.consumed_at is null and w.expires_at>now()
 order by w.created_at;
end;
$$;
revoke all on function private.get_my_mls_welcomes_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.get_my_mls_welcomes_impl(uuid,uuid) to authenticated;
create or replace function public.get_my_mls_welcomes(p_conversation_id uuid,p_device_id uuid)
returns table(welcome_id uuid,conversation_id uuid,welcome_message text,expires_at timestamptz,group_id text,group_epoch bigint)
language sql stable security invoker set search_path=''
as $$ select * from private.get_my_mls_welcomes_impl(p_conversation_id,p_device_id); $$;
revoke all on function public.get_my_mls_welcomes(uuid,uuid) from public,anon;
grant execute on function public.get_my_mls_welcomes(uuid,uuid) to authenticated;

create or replace function private.ack_my_mls_welcome_impl(p_welcome_id uuid,p_device_id uuid,p_joined_group_id text,p_joined_epoch bigint)
returns void language plpgsql security definer set search_path=''
as $$
declare v_welcome public.mls_group_welcomes%rowtype; v_group public.conversation_mls_groups%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=auth.uid() and d.revoked_at is null)
 then raise exception 'device_not_owned'; end if;
 select * into v_welcome from public.mls_group_welcomes w
 where w.id=p_welcome_id and w.target_device_id=p_device_id and w.target_user_id=auth.uid()
 and w.consumed_at is null and w.expires_at>now() for update;
 if not found then
   if exists(select 1 from public.mls_group_welcomes w where w.id=p_welcome_id and w.target_device_id=p_device_id and w.consumed_at is not null) then return; end if;
   raise exception 'mls_welcome_unavailable';
 end if;
 select * into v_group from public.conversation_mls_groups g where g.conversation_id=v_welcome.conversation_id and g.status='active';
 if not found or v_group.mls_group_id is distinct from p_joined_group_id
 or p_joined_epoch is null or p_joined_epoch<0 or p_joined_epoch>v_group.epoch
 then raise exception 'mls_welcome_group_mismatch'; end if;

 insert into public.conversation_mls_devices(conversation_id,device_id,user_id,leaf_index,status,joined_epoch)
 values(v_welcome.conversation_id,p_device_id,auth.uid(),null,'active',p_joined_epoch)
 on conflict(conversation_id,device_id) do update set status='active',joined_epoch=excluded.joined_epoch,updated_at=now()
 where public.conversation_mls_devices.user_id=auth.uid();

 update public.mls_group_welcomes set consumed_at=now() where id=p_welcome_id;
 -- A welcome may represent an earlier epoch if more members were added while this device was offline.
 -- Queue every subsequent commit so this device catches up before it can send.
 insert into public.conversation_mls_commit_deliveries(commit_id,target_device_id)
 select c.id,p_device_id from public.conversation_mls_commits c
 where c.conversation_id=v_welcome.conversation_id and c.epoch>p_joined_epoch
 on conflict do nothing;
end;
$$;
revoke all on function private.ack_my_mls_welcome_impl(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function private.ack_my_mls_welcome_impl(uuid,uuid,text,bigint) to authenticated;
create or replace function public.ack_my_mls_welcome(p_welcome_id uuid,p_device_id uuid,p_joined_group_id text,p_joined_epoch bigint)
returns void language sql security invoker set search_path=''
as $$ select private.ack_my_mls_welcome_impl(p_welcome_id,p_device_id,p_joined_group_id,p_joined_epoch); $$;
revoke all on function public.ack_my_mls_welcome(uuid,uuid,text,bigint) from public,anon;
grant execute on function public.ack_my_mls_welcome(uuid,uuid,text,bigint) to authenticated;

create or replace function private.get_my_pending_mls_commits_impl(p_conversation_id uuid,p_device_id uuid)
returns table(commit_id uuid,previous_epoch bigint,epoch bigint,commit_message text)
language plpgsql stable security definer set search_path=''
as $$
begin
 if auth.uid() is null or not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=auth.uid() and d.revoked_at is null)
 then raise exception 'device_not_owned'; end if;
 if not exists(select 1 from public.conversation_mls_devices md where md.conversation_id=p_conversation_id and md.device_id=p_device_id and md.user_id=auth.uid() and md.status='active')
 then raise exception 'active_mls_device_membership_required'; end if;
 return query
 select c.id,c.previous_epoch,c.epoch,c.commit_message
 from public.conversation_mls_commit_deliveries delivery
 join public.conversation_mls_commits c on c.id=delivery.commit_id
 where delivery.target_device_id=p_device_id and delivery.acknowledged_at is null
   and c.conversation_id=p_conversation_id
 order by c.epoch;
end;
$$;
revoke all on function private.get_my_pending_mls_commits_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.get_my_pending_mls_commits_impl(uuid,uuid) to authenticated;
create or replace function public.get_my_pending_mls_commits(p_conversation_id uuid,p_device_id uuid)
returns table(commit_id uuid,previous_epoch bigint,epoch bigint,commit_message text)
language sql stable security invoker set search_path=''
as $$ select * from private.get_my_pending_mls_commits_impl(p_conversation_id,p_device_id); $$;
revoke all on function public.get_my_pending_mls_commits(uuid,uuid) from public,anon;
grant execute on function public.get_my_pending_mls_commits(uuid,uuid) to authenticated;

create or replace function private.ack_my_mls_commit_impl(p_commit_id uuid,p_device_id uuid,p_applied_epoch bigint)
returns void language plpgsql security definer set search_path=''
as $$
declare v_conversation_id uuid; v_epoch bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=auth.uid() and d.revoked_at is null)
 then raise exception 'device_not_owned'; end if;
 select c.conversation_id,c.epoch into v_conversation_id,v_epoch
 from public.conversation_mls_commits c where c.id=p_commit_id;
 if not found then raise exception 'mls_commit_unavailable'; end if;
 if p_applied_epoch is distinct from v_epoch then raise exception 'mls_commit_epoch_mismatch'; end if;
 update public.conversation_mls_commit_deliveries d set acknowledged_at=now()
 where d.commit_id=p_commit_id and d.target_device_id=p_device_id and d.acknowledged_at is null;
 if not found and not exists(select 1 from public.conversation_mls_commit_deliveries d where d.commit_id=p_commit_id and d.target_device_id=p_device_id and d.acknowledged_at is not null)
 then raise exception 'mls_commit_not_assigned_to_device'; end if;
 update public.conversation_mls_devices md set joined_epoch=greatest(md.joined_epoch,p_applied_epoch),updated_at=now()
 where md.conversation_id=v_conversation_id and md.device_id=p_device_id and md.user_id=auth.uid() and md.status='active';
end;
$$;
revoke all on function private.ack_my_mls_commit_impl(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function private.ack_my_mls_commit_impl(uuid,uuid,bigint) to authenticated;
create or replace function public.ack_my_mls_commit(p_commit_id uuid,p_device_id uuid,p_applied_epoch bigint)
returns void language sql security invoker set search_path=''
as $$ select private.ack_my_mls_commit_impl(p_commit_id,p_device_id,p_applied_epoch); $$;
revoke all on function public.ack_my_mls_commit(uuid,uuid,bigint) from public,anon;
grant execute on function public.ack_my_mls_commit(uuid,uuid,bigint) to authenticated;
