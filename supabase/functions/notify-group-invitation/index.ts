import { withSupabase } from "npm:@supabase/server";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_INVITATION_AGE_MS = 5 * 60 * 1000;
const CLAIM_LEASE_MS = 3 * 60 * 1000;
const BATCH_SIZE = 100;

type NotifyGroupInvitationRequest = { invitation_id?: string };

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

Deno.serve(
  withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

    try {
      const inviterId = context.userClaims?.id;
      if (!inviterId) return json({ error: "Authentication required." }, 401);

      const input = await request.json().catch(() => ({})) as NotifyGroupInvitationRequest;
      if (!input.invitation_id || !/^[0-9a-f-]{36}$/i.test(input.invitation_id)) {
        return json({ error: "A valid invitation ID is required." }, 400);
      }

      const admin = context.supabaseAdmin;
      const now = new Date();
      const nowIso = now.toISOString();
      const staleClaim = new Date(now.getTime() - CLAIM_LEASE_MS).toISOString();

      // Atomically claim a fresh invitation so repeated function calls cannot
      // repeatedly notify the same recipient.
      const { data: invitation, error: claimError } = await admin
        .from("group_invitations")
        .update({ notification_claimed_at: nowIso })
        .eq("id", input.invitation_id)
        .eq("inviter_id", inviterId)
        .eq("status", "pending")
        .is("notification_sent_at", null)
        .or(`notification_claimed_at.is.null,notification_claimed_at.lt.${staleClaim}`)
        .select("id,conversation_id,inviter_id,invitee_id,status,created_at,expires_at")
        .maybeSingle();

      if (claimError) throw claimError;
      if (!invitation) return json({ sent: 0, reason: "already_claimed_or_not_pending" });

      const createdAt = new Date(invitation.created_at).getTime();
      const expiresAt = new Date(invitation.expires_at).getTime();
      if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) ||
          now.getTime() - createdAt > MAX_INVITATION_AGE_MS || expiresAt <= now.getTime()) {
        await admin.from("group_invitations")
          .update({ notification_claimed_at: null })
          .eq("id", invitation.id)
          .is("notification_sent_at", null);
        return json({ error: "Invitation has expired or is too old to notify." }, 409);
      }

      const inviteeId = invitation.invitee_id;
      const [
        { data: settings, error: settingsError },
        { data: conversationSettings, error: conversationSettingsError },
        { data: devices, error: devicesError },
        { data: inviterBlocks, error: inviterBlocksError },
        { data: inviteeBlocks, error: inviteeBlocksError },
      ] = await Promise.all([
        admin.from("user_settings").select("notification_preview").eq("user_id", inviteeId).maybeSingle(),
        admin.from("conversation_user_settings").select("muted_until")
          .eq("conversation_id", invitation.conversation_id).eq("user_id", inviteeId).maybeSingle(),
        admin.from("push_devices").select("id,expo_push_token")
          .eq("user_id", inviteeId).is("revoked_at", null),
        admin.from("user_blocks").select("blocked_id")
          .eq("blocker_id", inviterId).eq("blocked_id", inviteeId),
        admin.from("user_blocks").select("blocker_id")
          .eq("blocker_id", inviteeId).eq("blocked_id", inviterId),
      ]);
      if (settingsError) throw settingsError;
      if (conversationSettingsError) throw conversationSettingsError;
      if (devicesError) throw devicesError;
      if (inviterBlocksError) throw inviterBlocksError;
      if (inviteeBlocksError) throw inviteeBlocksError;

      const mutedUntil = conversationSettings?.muted_until;
      const isMuted = typeof mutedUntil === "string" && new Date(mutedUntil).getTime() > now.getTime();
      const blocked = (inviterBlocks?.length ?? 0) > 0 || (inviteeBlocks?.length ?? 0) > 0;
      const notificationsDisabled = settings?.notification_preview === "none";

      const targets = notificationsDisabled || isMuted || blocked
        ? []
        : (devices ?? []).filter(device =>
            device.expo_push_token.startsWith("ExponentPushToken[") ||
            device.expo_push_token.startsWith("ExpoPushToken[")
          );

      let sent = 0;
      const invalidTokens: string[] = [];
      for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
        const batch = targets.slice(offset, offset + BATCH_SIZE);
        const payload = batch.map(device => ({
          to: device.expo_push_token,
          sound: "default",
          title: "ChitChat",
          body: "You received a group invitation.",
          priority: "high",
          channelId: "groups",
          data: {
            type: "group_invitation",
            invitation_id: invitation.id,
          },
        }));

        const expoResponse = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!expoResponse.ok) {
          await admin.from("group_invitations")
            .update({ notification_claimed_at: null })
            .eq("id", invitation.id)
            .is("notification_sent_at", null);
          return json({ error: "Push delivery service rejected the invitation notification." }, 502);
        }

        const result = await expoResponse.json().catch(() => null) as {
          data?: Array<{ status?: string; details?: { error?: string } }>;
        } | null;
        const tickets = result?.data ?? [];
        tickets.forEach((ticket, index) => {
          if (ticket.status === "ok") sent += 1;
          if (ticket.details?.error === "DeviceNotRegistered") {
            invalidTokens.push(batch[index].expo_push_token);
          }
        });
      }

      if (invalidTokens.length) {
        await admin.from("push_devices")
          .update({ revoked_at: nowIso })
          .in("expo_push_token", invalidTokens);
      }

      await admin.from("group_invitations")
        .update({ notification_sent_at: nowIso })
        .eq("id", invitation.id)
        .eq("status", "pending")
        .is("notification_sent_at", null);

      return json({
        sent,
        attempted: targets.length,
        reason: notificationsDisabled ? "notifications_disabled" :
          isMuted ? "group_muted" :
          blocked ? "blocked" :
          targets.length === 0 ? "no_enabled_devices" : "delivered_or_accepted_by_expo",
      });
    } catch {
      return json({ error: "Group invitation notification delivery failed." }, 500);
    }
  }),
);
