import { withSupabase } from "npm:@supabase/server";

const STUN_DEFAULT = "stun:stun.l.google.com:19302";
const MAX_TTL_SECONDS = 15 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

type RequestBody = { call_id?: string };

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function parseUrls(value: string | undefined, fallback?: string): string[] {
  const source = value?.trim() || fallback || "";
  return source.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
}

function isIceUrl(value: string): boolean {
  return /^(stun|stuns|turn|turns):[^\s]+$/i.test(value);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function createTurnCredential(secret: string, username: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  return base64(new Uint8Array(signature));
}

Deno.serve(
  withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

    try {
      const userId = context.userClaims?.id;
      if (!userId) return json({ error: "Authentication required." }, 401);

      const input = await request.json().catch(() => ({})) as RequestBody;
      if (!input.call_id || !UUID_RE.test(input.call_id)) {
        return json({ error: "A valid active call ID is required." }, 400);
      }

      const admin = context.supabaseAdmin;
      const { data: call, error: callError } = await admin
        .from("call_sessions")
        .select("id,caller_id,callee_id,status,expires_at")
        .eq("id", input.call_id)
        .maybeSingle();

      if (callError) throw callError;
      if (!call || (call.caller_id !== userId && call.callee_id !== userId)) {
        return json({ error: "Call session not found." }, 404);
      }
      if (call.status !== "accepted" && call.status !== "ringing") {
        return json({ error: "This call is no longer active." }, 409);
      }

      const callExpiry = Date.parse(call.expires_at);
      if (!Number.isFinite(callExpiry) || callExpiry <= Date.now()) {
        return json({ error: "This call session has expired." }, 409);
      }

      const stunUrls = parseUrls(Deno.env.get("STUN_URLS"), STUN_DEFAULT);
      if (stunUrls.some(url => !isIceUrl(url))) {
        return json({ error: "The server ICE configuration is invalid." }, 500);
      }

      const turnUrls = parseUrls(Deno.env.get("TURN_URLS"));
      const sharedSecret = Deno.env.get("TURN_SHARED_SECRET")?.trim();
      if (turnUrls.length === 0 || !sharedSecret) {
        return json({ error: "TURN relay is not configured on the ChitChat server." }, 503);
      }
      if (turnUrls.some(url => !/^turns?:[^\s]+$/i.test(url))) {
        return json({ error: "TURN_URLS contains an invalid relay URL." }, 500);
      }

      const expiresAt = Math.min(
        Math.floor(Date.now() / 1000) + MAX_TTL_SECONDS,
        Math.floor(callExpiry / 1000),
      );
      const username = `${expiresAt}:${userId}`;
      const credential = await createTurnCredential(sharedSecret, username);

      return json({
        ice_servers: [
          { urls: stunUrls },
          {
            urls: turnUrls,
            username,
            credential,
            credential_type: "password",
          },
        ],
        expires_at: new Date(expiresAt * 1000).toISOString(),
      });
    } catch (error) {
      console.error("ChitChat TURN credential request failed.", error);
      return json({ error: "Could not create call relay credentials." }, 500);
    }
  }),
);
