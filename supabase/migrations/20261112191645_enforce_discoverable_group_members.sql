create or replace function private.create_group_conversation_impl(group_title text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_title text := trim(group_title);
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if v_title is null or char_length(v_title) not between 1 and 80 then
    raise exception 'Group name must be 1 to 80 characters.' using errcode='22023';
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[])
    into v_ids
    from unnest(coalesce(member_ids, array[]::uuid[])) x
    where x is not null and x <> v_me;

  if cardinality(v_ids) < 1 or cardinality(v_ids) > 99 then
    raise exception 'A group needs 2 to 100 members.' using errcode='22023';
  end if;

  if exists (
    select 1
    from unnest(v_ids) x
    where not exists (
      select 1 from public.profiles p
      where p.id = x and p.discoverable is true
    )
  ) then
    raise exception 'One or more selected members are not available for discovery.' using errcode='42501';
  end if;

  if exists(select 1 from unnest(v_ids) x where private.is_blocked_between(x)) then
    raise exception 'A selected member is blocked.' using errcode='42501';
  end if;

  insert into public.conversations(kind, created_by, title)
  values('group', v_me, v_title)
  returning id into v_id;

  insert into public.conversation_members(conversation_id, user_id, role)
  values(v_id, v_me, 'owner');

  insert into public.conversation_members(conversation_id, user_id, role)
  select v_id, x, 'member' from unnest(v_ids) x;

  return v_id;
end;
$$;

create or replace function private.add_group_members_impl(target_conversation_id uuid, member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_me uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
begin
  if v_me is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;

  if not exists (
    select 1 from public.conversations c
    where c.id = target_conversation_id and c.kind = 'group'
  ) or not private.is_group_admin(target_conversation_id) then
    raise exception 'Only group admins can add members.' using errcode='42501';
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[])
    into v_ids
    from unnest(coalesce(member_ids, array[]::uuid[])) x
    where x is not null and x <> v_me;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  if exists (
    select 1
    from unnest(v_ids) x
    where not exists (
      select 1 from public.profiles p
      where p.id = x and p.discoverable is true
    )
    and not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = target_conversation_id and cm.user_id = x
    )
  ) then
    raise exception 'One or more selected members are not available for discovery.' using errcode='42501';
  end if;

  if exists(select 1 from unnest(v_ids) x where private.is_blocked_between(x)) then
    raise exception 'A selected member is blocked.' using errcode='42501';
  end if;

  if (
    select count(*) from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
  ) + (
    select count(*) from unnest(v_ids) x
    where not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = target_conversation_id and cm.user_id = x
    )
  ) > 100 then
    raise exception 'Groups are limited to 100 members.' using errcode='22023';
  end if;

  insert into public.conversation_members(conversation_id, user_id, role)
  select target_conversation_id, x, 'member'
  from unnest(v_ids) x
  on conflict(conversation_id, user_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
