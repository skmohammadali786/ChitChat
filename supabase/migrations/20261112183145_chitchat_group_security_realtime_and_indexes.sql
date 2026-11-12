create index if not exists external_secret_links_media_object_idx
  on private.external_secret_links(media_object_id)
  where media_object_id is not null;
create index if not exists scheduled_messages_conversation_idx
  on public.scheduled_messages(conversation_id);

create or replace function private.remove_group_member_impl(target_conversation_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare
  v_me uuid:=auth.uid();
  v_actor_role text;
  v_target_role text;
  v_count integer;
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

do $$
declare t text;
begin
  foreach t in array array['conversations','conversation_members','message_reactions'] loop
    if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
       and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end
$$;
