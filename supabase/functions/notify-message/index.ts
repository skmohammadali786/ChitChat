import { withSupabase } from "npm:@supabase/server";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_AGE_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100;

type NotifyRequest = { message_id?: string };

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
      const senderId = context.userClaims?.id;
      if (!senderId) return json({ error: "Authentication required." }, 401);

      const input = await request.json().catch(() => ({})) as NotifyRequest;
      if (!input.message_id || !/^[0-9a-f-]{36}$/i.test(input.message_id)) {
        return json({ error: "A valid message ID is required." }, 400);
      }

      const admin = context.supabaseAdmin;
      const { data: message, error: messageError } = await admin
        .from("messages")
        .select("id,conversation_id,sender_id,created_at")
        .eq("id", input.message_id)
        .maybeSingle();

      if (messageError) throw messageError;
      if (!message || message.sender_id !== senderId) {
        return json({ error: "Message not found." }, 404);
      }
      if (Date.now() - new Date(message.created_at).getTime() > MAX_AGE_MS) {
        return json({ error: "Notifications can only be sent for recent messages." }, 409);
      }

      const { data: members, error: membersError } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", message.conversation_id)
        .neq("user_id", senderId);
      if (membersError) throw membersError;

      const recipientIds = [...new Set((members ?? []).map(row => row.user_id))];
      if (recipientIds.length === 0) return json({ sent: 0, reason: "no_recipients" });

      const [
        { data: settings, error: settingsError },
        { data: devices, error: devicesError },
        { data: conversationSettings, error: conversationSettingsError },
      ] = await Promise.all([
        admin.from("user_settings").select("user_id,notification_preview").in("user_id", recipientIds),
        admin.from("push_devices").select("id,user_id,expo_push_token").in("user_id", recipientIds).is("revoked_at", null),
        admin.from("conversation_user_settings").select("user_id,muted_until")
          .eq("conversation_id", message.conversation_id).in("user_id", recipientIds),
      ]);
      if (settingsError) throw settingsError;
      if (devicesError) throw devicesError;
      if (conversationSettingsError) throw conversationSettingsError;

      const previewByUser = new Map((settings ?? []).map(row => [row.user_id, row.notification_preview]));
      const muteByUser = new Map((conversationSettings ?? []).map(row => [row.user_id, row.muted_until]));
      const allowedRecipients = new Set(recipientIds.filter(id => {
        const mutedUntil = muteByUser.get(id);
        const isMuted = typeof mutedUntil === "string" && new Date(mutedUntil).getTime() > Date.now();
        return previewByUser.get(id) !== "none" && !isMuted;
      }));
      const { data: senderProfile, error: senderProfileError } = await admin
        .from("profiles")
        .select("display_name,username")
        .eq("id", senderId)
        .maybeSingle();
      if (senderProfileError) throw senderProfileError;
      const senderLabel = senderProfile?.display_name?.trim() ||
        (senderProfile?.username ? `@${senderProfile.username}` : "Someone");
      const targets = (devices ?? []).filter(device =>
        allowedRecipients.has(device.user_id) &&
        (device.expo_push_token.startsWith("ExponentPushToken[") || device.expo_push_token.startsWith("ExpoPushToken["))
      );

      if (targets.length === 0) return json({ sent: 0, reason: "no_enabled_devices" });

      let sent = 0;
      const invalidTokens: string[] = [];
      for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
        const batch = targets.slice(offset, offset + BATCH_SIZE);
        const payload = batch.map(device => ({
          to: device.expo_push_token,
          sound: "default",
          title: "ChitChat",
          body: `${senderLabel} sent you a message.`,
          priority: "high",
          data: {
            type: "new_message",
            conversation_id: message.conversation_id,
            message_id: message.id,
          },
        }));

        const expoResponse = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!expoResponse.ok) continue;

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
          .update({ revoked_at: new Date().toISOString() })
          .in("expo_push_token", invalidTokens);
      }

      return json({ sent, attempted: targets.length });
    } catch {
      return json({ error: "Notification delivery failed." }, 500);
    }
  }),
);
