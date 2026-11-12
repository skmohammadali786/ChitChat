import { supabase } from "../../lib/supabase";

export type ScheduledMessageInput = {
  conversationId: string;
  clientMessageId: string;
  messageType: "text" | "image" | "video" | "audio" | "file";
  ciphertext: string;
  nonce: string;
  cryptoHeader: Record<string, unknown>;
  keyVersion: number;
  sendAt: string;
};

export type ScheduledMessage = {
  id: string;
  sender_id: string;
  conversation_id: string;
  client_message_id: string;
  message_type: ScheduledMessageInput["messageType"];
  ciphertext: string;
  nonce: string;
  crypto_header: Record<string, unknown>;
  key_version: number;
  send_at: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  created_at: string;
  sent_at: string | null;
  failure_code: string | null;
};

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function scheduleEncryptedMessage(input: ScheduledMessageInput): Promise<ScheduledMessage> {
  const sendAt = new Date(input.sendAt);
  if (!Number.isFinite(sendAt.getTime()) || sendAt.getTime() <= Date.now()) {
    throw new Error("Choose a future send time.");
  }
  if (!input.ciphertext || !input.nonce || input.keyVersion < 1) {
    throw new Error("Scheduled messages must contain a valid encrypted envelope.");
  }
  const { data: auth, error: authError } = await client().auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("Sign in before scheduling a message.");

  const { data, error } = await client()
    .from("scheduled_messages")
    .insert({
      sender_id: auth.user.id,
      conversation_id: input.conversationId,
      client_message_id: input.clientMessageId,
      message_type: input.messageType,
      ciphertext: input.ciphertext,
      nonce: input.nonce,
      crypto_header: input.cryptoHeader,
      key_version: input.keyVersion,
      send_at: sendAt.toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ScheduledMessage;
}

export async function loadScheduledMessages(): Promise<ScheduledMessage[]> {
  const { data: auth, error: authError } = await client().auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("Sign in to view scheduled messages.");
  const { data, error } = await client()
    .from("scheduled_messages")
    .select("*")
    .eq("sender_id", auth.user.id)
    .eq("status", "pending")
    .order("send_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ScheduledMessage[];
}

export async function cancelScheduledMessage(id: string): Promise<void> {
  const { error } = await client()
    .from("scheduled_messages")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
}
