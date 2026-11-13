import { supabase } from "../../lib/supabase";
import { validateEnvelopeWithRust } from "../../lib/rustCore";
import { assertSecureMessagingAvailable } from "./cryptoGate";

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
  const { data: authData, error: authError } = await requireClient().auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Sign in before loading your block list.");

  const { data, error } = await requireClient().rpc("list_my_blocked_users");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(row => ({
    blocked_id: row.blocked_id,
    username: row.username ?? null,
    display_name: row.display_name ?? null,
    avatar_path: row.avatar_path ?? null,
    created_at: row.created_at,
  })) as BlockedProfile[];
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
  assertSecureMessagingAvailable();
  validateEnvelope(envelope);
  // Rust validates the serialized envelope in custom native builds. This
  // remains a structural check only, never proof of end-to-end encryption.
  await validateEnvelopeWithRust({
    client_message_id: envelope.client_message_id,
    message_kind: envelope.message_type,
    ciphertext: envelope.ciphertext,
    nonce: envelope.nonce,
    crypto_header: envelope.crypto_header,
    key_version: envelope.key_version,
  });
  const client = requireClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in before sending a message.");

  const senderDeviceId = envelope.crypto_header.sender_device_id;
  const epoch = envelope.crypto_header.epoch;
  if (typeof senderDeviceId !== "string" || !senderDeviceId) {
    throw new Error("The authenticated MLS sender device is missing.");
  }
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error("The MLS epoch is missing or invalid.");
  }

  // All MLS writes go through the authorization RPC. Direct table inserts
  // bypass the server's device, group, epoch and complete-recipient checks.
  if (envelope.crypto_header.message_type !== envelope.message_type) {
    throw new Error("The MLS message type does not match its authenticated transport metadata.");
  }
  const { data: messageId, error } = await client.rpc("send_mls_message", {
    p_conversation_id: conversationId,
    p_device_id: senderDeviceId,
    p_message_type: envelope.message_type,
    p_client_message_id: envelope.client_message_id,
    p_ciphertext: envelope.ciphertext,
    p_crypto_header: envelope.crypto_header,
    p_epoch: epoch,
    p_expires_at: envelope.expires_at ?? null,
  });
  if (error) throw error;
  if (typeof messageId !== "string" || !messageId) {
    throw new Error("The MLS transport did not return a message ID.");
  }

  const { data, error: readError } = await client
    .from("messages")
    .select("id, conversation_id, sender_id, client_message_id, message_type, ciphertext, nonce, crypto_header, key_version, created_at, expires_at")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .single();
  if (readError) throw readError;

  // Push notifications contain only a generic alert and encrypted-message IDs.
  // The Edge Function never receives message plaintext or encryption keys.
  void client.functions.invoke("notify-message", {
    body: { message_id: data.id },
  }).then(({ error: notificationError }) => {
    if (notificationError) {
      console.warn("ChitChat message notification could not be delivered.", notificationError.message);
    }
  }).catch(error => {
    console.warn("ChitChat message notification request failed.", error);
  });

  return data as EncryptedMessageRecord;
}

export function subscribeToEncryptedMessages(
  conversationId: string,
  onInsert: (message: EncryptedMessageRecord) => void,
  onStatus?: (status: string) => void
): () => void {
  const client = requireClient();
  const channel = client
    .channel(`conversation:${conversationId}`, { config: { private: true } })
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      payload => onInsert(payload.new as EncryptedMessageRecord)
    );

  void client.realtime.setAuth().then(() => channel.subscribe(status => onStatus?.(status)));

  return () => {
    void client.removeChannel(channel);
  };
}
