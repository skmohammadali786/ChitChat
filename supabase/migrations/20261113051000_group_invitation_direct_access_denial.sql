-- Keep group invitation rows RPC-only while making the default-deny intent
-- explicit to database policy auditors. SECURITY DEFINER RPCs remain the only
-- authorized path and perform their own invitee/admin checks.

create policy group_invitations_deny_direct_client_access
  on public.group_invitations
  for all
  to authenticated
  using (false)
  with check (false);

create index if not exists group_invitations_inviter_idx
  on public.group_invitations(inviter_id);
