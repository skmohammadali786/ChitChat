import { supabase } from "../../lib/supabase";

export type MessageReceipt = {
  message_id: string;
  conversation_id: string;
  recipient_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function markMessageDelivered(messageId: string): Promise<void> {
  const { error } = await client().rpc("mark_message_delivered", {
    target_message_id: messageId,
  });
  if (error) throw error;
}

export async function markConversationRead(conversationId: string, readThrough?: string): Promise<number> {
  const { data, error } = await client().rpc("mark_conversation_read", {
    target_conversation_id: conversationId,
    read_through: readThrough ?? new Date().toISOString(),
  });
  if (error) throw error;
  return Number(data || 0);
}

export function subscribeToMessageReceipts(
  conversationId: string,
  onReceipt: (receipt: MessageReceipt) => void,
) {
  const channel = client()
    .channel(`conversation:${conversationId}`, { config: { private: true } })
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "message_receipts",
      filter: `conversation_id=eq.${conversationId}`,
    }, payload => {
      const row = payload.new as MessageReceipt | undefined;
      if (row?.message_id) onReceipt(row);
    });
  void client().realtime.setAuth().then(() => channel.subscribe());
  return () => {
    void client().removeChannel(channel);
  };
}
