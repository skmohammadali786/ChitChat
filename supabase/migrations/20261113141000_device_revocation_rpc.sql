-- Revoke only the signed-in user's active device, using database time.
-- A revoked device cannot be reactivated; register a fresh device identity.
drop policy if exists devices_update_self on public.devices;
revoke update on public.devices from authenticated;

create or replace function private.revoke_my_device_impl(target_device_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if target_device_id is null then
    raise exception 'Choose a device to revoke.' using errcode='22023';
  end if;

  update public.devices
    set revoked_at=now()
    where id=target_device_id
      and user_id=auth.uid()
      and revoked_at is null;

  if not found then
    raise exception 'Device not found or already revoked.' using errcode='P0002';
  end if;
end;
$$;
revoke all on function private.revoke_my_device_impl(uuid) from public,anon,authenticated;
grant execute on function private.revoke_my_device_impl(uuid) to authenticated;

create or replace function public.revoke_my_device(target_device_id uuid)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.revoke_my_device_impl(target_device_id);
$$;
revoke all on function public.revoke_my_device(uuid) from public,anon;
grant execute on function public.revoke_my_device(uuid) to authenticated;

comment on function public.revoke_my_device(uuid) is
  'Irreversibly revoke the authenticated user device. Register a new identity to use this device again.';
