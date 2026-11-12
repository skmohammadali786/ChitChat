import { supabase } from "../../lib/supabase";

export type EncryptedMessageType = "text" | "image" | "video" | "audio" | "file" | "system";

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

export async function createDirectConversation(targetUserId: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc("create_direct_conversation", {
    target_user_id: targetUserId,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("The conversation service returned an invalid ID.");
  return data;
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
