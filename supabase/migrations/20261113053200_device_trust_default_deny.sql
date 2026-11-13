-- Explicitly deny direct access to device trust assertions. The authenticated
-- invoker RPCs are the only exposed read/write path and enforce their own
-- ownership, conversation membership and fingerprint constraints.

create policy device_trust_deny_direct_client_access
  on public.device_trust
  for all
  to authenticated
  using (false)
  with check (false);
