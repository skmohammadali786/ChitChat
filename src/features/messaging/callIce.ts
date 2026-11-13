import { supabase } from "../../lib/supabase";

export type ChitChatIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
};

export type CallIceConfiguration = {
  iceServers: ChitChatIceServer[];
  expiresAt: string;
};

function client() {
  if (!supabase) throw new Error("ChitChat Supabase is not configured.");
  return supabase;
}

/**
 * Request short-lived ICE servers for a call the signed-in user participates in.
 * TURN secrets are generated on the server and are never bundled in the app.
 */
export async function getCallIceConfiguration(callId: string): Promise<CallIceConfiguration> {
  if (!callId) throw new Error("An active call ID is required.");
  const { data, error } = await client().functions.invoke("get-call-ice-servers", {
    body: { call_id: callId },
  });
  if (error) throw error;

  const value = data as { ice_servers?: unknown; expires_at?: unknown } | null;
  if (!value || !Array.isArray(value.ice_servers) || typeof value.expires_at !== "string") {
    throw new Error("The call relay service returned an invalid ICE configuration.");
  }

  const iceServers = value.ice_servers.map((item): ChitChatIceServer => {
    if (!item || typeof item !== "object") throw new Error("The call relay service returned an invalid ICE server.");
    const server = item as Record<string, unknown>;
    const urls = server.urls;
    const validUrls = typeof urls === "string"
      ? urls.length > 0
      : Array.isArray(urls) && urls.length > 0 && urls.every(url => typeof url === "string" && url.length > 0);
    if (!validUrls) throw new Error("The call relay service returned an invalid ICE URL.");
    if (server.username !== undefined && typeof server.username !== "string") {
      throw new Error("The call relay service returned an invalid TURN username.");
    }
    if (server.credential !== undefined && typeof server.credential !== "string") {
      throw new Error("The call relay service returned an invalid TURN credential.");
    }
    return {
      urls: urls as string | string[],
      ...(typeof server.username === "string" ? { username: server.username } : {}),
      ...(typeof server.credential === "string" ? { credential: server.credential } : {}),
      ...(server.credential_type === "password" ? { credentialType: "password" as const } : {}),
    };
  });

  if (!iceServers.some(server => server.username && server.credential)) {
    throw new Error("The call relay service did not return a TURN relay.");
  }

  const expiry = Date.parse(value.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new Error("The call relay credentials are expired.");
  }

  return { iceServers, expiresAt: value.expires_at };
}
