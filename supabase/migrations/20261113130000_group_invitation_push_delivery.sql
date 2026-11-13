-- Claim and completion timestamps protect invitees from duplicate push
-- notifications when the client retries the authenticated Edge Function.
alter table public.group_invitations
  add column if not exists notification_claimed_at timestamptz,
  add column if not exists notification_sent_at timestamptz;

create index if not exists group_invitations_notification_pending_idx
  on public.group_invitations(created_at)
  where status='pending' and notification_sent_at is null;
