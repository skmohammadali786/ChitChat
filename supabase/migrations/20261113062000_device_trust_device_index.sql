-- Cover the device_trust.device_id foreign key so deleting or revoking a
-- device does not require an unindexed scan of all trust assertions.

create index if not exists device_trust_device_id_idx
  on public.device_trust(device_id);
