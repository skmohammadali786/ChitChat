import { supabase } from "../../lib/supabase";

export type EncryptedMessageType = "text" | "image" | "video" | "audio" | "file";

/**
 * A message envelope. The actual encryption and decryption must be performed
 * by the reviewed client-side crypto layer before this type reaches the API.
 * This service deliberately has no plaintext message field.
 */
export type EncryptedMessageEnvelope = {
  client_message_id: string;
  message_type: EncryptedMessageType;
  ciphertext: string;
  nonce: string;
  crypto_header: Record<string, unknown>;
  key_version: number;
  expires_at?: string | null;
};

export type EncryptedMessageRecord = EncryptedMessageEnvelope & {
  id: string;
  conversation_id: string;
  sender_id: string;
  created_at: string;
  expires_at: string | null;
};

function requireClient() {
  if (!supabase) {
    throw new Error("ChitChat is not connected to its Supabase project.");
  }
  return supabase;
}

function validateEnvelope(envelope: EncryptedMessageEnvelope): void {
  const supportedTypes: EncryptedMessageType[] = ["text", "image", "video", "audio", "file"];
  if (!supportedTypes.includes(envelope.message_type)) {
    throw new Error("The encrypted message type is not supported.");
  }
  if (!envelope.client_message_id) throw new Error("A client message ID is required.");
  if (!envelope.ciphertext || envelope.ciphertext.length > 1_000_000) {
    throw new Error("The encrypted message payload is missing or too large.");
  }
  if (!envelope.nonce || envelope.nonce.length > 256) {
    throw new Error("The encrypted message nonce is missing or invalid.");
  }
  if (!Number.isInteger(envelope.key_version) || envelope.key_version < 1) {
    throw new Error("The encryption key version is invalid.");
  }
  if (typeof envelope.crypto_header !== "object" || envelope.crypto_header === null || Array.isArray(envelope.crypto_header)) {
    throw new Error("The cryptographic header must be an object.");
  }
}




export type BlockedProfile = {
  blocked_id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
  created_at: string;
};

export async function blockUser(targetUserId: string): Promise<void> {
  if (!targetUserId) throw new Error("Choose a valid account to block.");
  const client = requireClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in before blocking an account.");
  if (user.id === targetUserId) throw new Error("You cannot block your own account.");

  const { error } = await client.from("user_blocks").insert({
    blocker_id: user.id,
    blocked_id: targetUserId,
  });
  if (error && error.code !== "23505") throw error;
}

export async function unblockUser(targetUserId: string): Promise<void> {
  const client = requireClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in before changing your block list.");

  const { error } = await client
    .from("user_blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", targetUserId);
  if (error) throw error;
}

export async function loadBlockedUsers(): Promise<BlockedProfile[]> {
  const client = requireClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  const user = authData.user;
  if (!user) throw new Error("Sign in before loading your block list.");

  const { data, error } = await client
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", user.id);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map(row => row.blocked_id);
  const { data: profiles, error: profilesError } = await client
    .from("profiles")
    .select("id, username, display_name, avatar_path")
    .in("id", ids);
  if (profilesError) throw profilesError;

  const profileById = new Map((profiles ?? []).map(profile => [profile.id, profile]));
  return rows.map(row => {
    const profile = profileById.get(row.blocked_id);
    return {
      blocked_id: row.blocked_id,
      username: profile?.username ?? null,
      display_name: profile?.display_name ?? null,
      avatar_path: profile?.avatar_path ?? null,
      created_at: row.created_at,
    };
  });
}

export type ConversationSummary = {
  conversation_id: string;
  conversation_kind: "direct" | "group";
  conversation_title: string | null;
  updated_at: string;
  other_user_id: string | null;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_path: string | null;
};

export async function loadMyConversations(): Promise<ConversationSummary[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("list_my_conversations");
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ConversationSummary[];
}

export type DiscoverableProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
};

export async function lookupProfileByUsername(username: string): Promise<DiscoverableProfile | null> {
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
    throw new Error("Enter an exact username with 3 to 20 letters, numbers, or underscores.");
  }

  const client = requireClient();
  const { data, error } = await client.rpc("lookup_profile_by_username", {
    search_username: normalized,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return (rows[0] as DiscoverableProfile | undefined) ?? null;
}

export async function loadEncryptedMessages(
  conversationId: string,
  limit = 100
): Promise<EncryptedMessageRecord[]> {
  const client = requireClient();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const { data, error } = await client
    .from("messages")
    .select("id, conversation_id, sender_id, client_message_id, message_type, ciphertext, nonce, crypto_header, key_version, created_at, expires_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(safeLimit);

  if (error) throw error;
  return (data ?? []) as EncryptedMessageRecord[];
}

export async function sendEncryptedMessage(
  conversationId: string,
  envelope: EncryptedMessageEnvelope
): Promise<EncryptedMessageRecord> {
  validateEnvelope(envelope);
  const client = requireClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in before sending a message.");

  const { data, error } = await client
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      client_message_id: envelope.client_message_id,
      message_type: envelope.message_type,
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      crypto_header: envelope.crypto_header,
      key_version: envelope.key_version,
      expires_at: envelope.expires_at ?? null,
    })
    .select("id, conversation_id, sender_id, client_message_id, message_type, ciphertext, nonce, crypto_header, key_version, created_at, expires_at")
    .single();

  if (error?.code === "23505") {
    // The original insert may have reached Postgres even if the client lost
    // its response. Fetch the existing row so an outbox retry stays idempotent.
    const { data: existing, error: lookupError } = await client
      .from("messages")
      .select("id, conversation_id, sender_id, client_message_id, message_type, ciphertext, nonce, crypto_header, key_version, created_at, expires_at")
      .eq("sender_id", user.id)
      .eq("client_message_id", envelope.client_message_id)
      .maybeSingle();
    if (!lookupError && existing) return existing as EncryptedMessageRecord;
  }
  if (error) throw error;
  return data as EncryptedMessageRecord;
}

export function subscribeToEncryptedMessages(
  conversationId: string,
  onInsert: (message: EncryptedMessageRecord) => void,
  onStatus?: (status: string) => void
): () => void {
  const client = requireClient();
  const channel = client
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      payload => onInsert(payload.new as EncryptedMessageRecord)
    )
    .subscribe(status => onStatus?.(status));

  return () => {
    void client.removeChannel(channel);
  };
}
