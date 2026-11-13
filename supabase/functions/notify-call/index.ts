import { withSupabase } from "npm:@supabase/server";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_AGE_MS = 45_000;
const BATCH_SIZE = 100;

type NotifyCallRequest = { call_id?: string };

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
      const callerId = context.userClaims?.id;
      if (!callerId) return json({ error: "Authentication required." }, 401);

      const input = await request.json().catch(() => ({})) as NotifyCallRequest;
      if (!input.call_id || !/^[0-9a-f-]{36}$/i.test(input.call_id)) {
        return json({ error: "A valid call ID is required." }, 400);
      }

      const admin = context.supabaseAdmin;
      const { data: call, error: callError } = await admin
        .from("call_sessions")
        .select("id,conversation_id,caller_id,callee_id,call_type,status,created_at,expires_at")
        .eq("id", input.call_id)
        .maybeSingle();

      if (callError) throw callError;
      if (!call || call.caller_id !== callerId || call.status !== "ringing") {
        return json({ error: "Call request not found." }, 404);
      }

      const createdAt = new Date(call.created_at).getTime();
      const expiresAt = new Date(call.expires_at).getTime();
      if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) ||
          Date.now() - createdAt > MAX_AGE_MS || expiresAt <= Date.now()) {
        return json({ error: "Call request has expired." }, 409);
      }

      const calleeId = call.callee_id;
      const [
        { data: recipientSettings, error: settingsError },
        { data: conversationSettings, error: conversationSettingsError },
        { data: devices, error: devicesError },
        { data: callerBlocks, error: callerBlocksError },
        { data: calleeBlocks, error: calleeBlocksError },
        { data: callerProfile, error: profileError },
      ] = await Promise.all([
        admin.from("user_settings").select("notification_preview").eq("user_id", calleeId).maybeSingle(),
        admin.from("conversation_user_settings").select("muted_until")
          .eq("conversation_id", call.conversation_id).eq("user_id", calleeId).maybeSingle(),
        admin.from("push_devices").select("id,expo_push_token")
          .eq("user_id", calleeId).is("revoked_at", null),
        admin.from("user_blocks").select("blocked_id")
          .eq("blocker_id", callerId).eq("blocked_id", calleeId),
        admin.from("user_blocks").select("blocker_id")
          .eq("blocker_id", calleeId).eq("blocked_id", callerId),
        admin.from("profiles").select("display_name,username").eq("id", callerId).maybeSingle(),
      ]);
      if (settingsError) throw settingsError;
      if (conversationSettingsError) throw conversationSettingsError;
      if (devicesError) throw devicesError;
      if (callerBlocksError) throw callerBlocksError;
      if (calleeBlocksError) throw calleeBlocksError;
      if (profileError) throw profileError;

      if (recipientSettings?.notification_preview === "none") {
        return json({ sent: 0, reason: "notifications_disabled" });
      }

      const mutedUntil = conversationSettings?.muted_until;
      if (typeof mutedUntil === "string" && new Date(mutedUntil).getTime() > Date.now()) {
        return json({ sent: 0, reason: "conversation_muted" });
      }

      if ((callerBlocks?.length ?? 0) > 0 || (calleeBlocks?.length ?? 0) > 0) {
        return json({ sent: 0, reason: "blocked" });
      }

      const callerLabel = callerProfile?.display_name?.trim() ||
        (callerProfile?.username ? `@${callerProfile.username}` : "Someone");
      const callLabel = call.call_type === "video" ? "video call" : "voice call";
      const targets = (devices ?? []).filter(device =>
        device.expo_push_token.startsWith("ExponentPushToken[") ||
        device.expo_push_token.startsWith("ExpoPushToken[")
      );
      if (targets.length === 0) return json({ sent: 0, reason: "no_enabled_devices" });

      let sent = 0;
      const invalidTokens: string[] = [];
      for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
        const batch = targets.slice(offset, offset + BATCH_SIZE);
        const payload = batch.map(device => ({
          to: device.expo_push_token,
          sound: "default",
          title: "Incoming ChitChat call",
          body: `${callerLabel} is calling you.`,
          priority: "high",
          channelId: "calls",
          data: {
            type: "incoming_call",
            call_id: call.id,
            conversation_id: call.conversation_id,
            call_type: call.call_type,
            call_label: callLabel,
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
        (result?.data ?? []).forEach((ticket, index) => {
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
      return json({ error: "Incoming-call notification delivery failed." }, 500);
    }
  }),
);
