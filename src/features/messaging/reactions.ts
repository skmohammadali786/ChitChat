import { supabase } from "../../lib/supabase";

export const MESSAGE_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "👎", "🔥", "🎉"] as const;
export type MessageReaction = (typeof MESSAGE_REACTIONS)[number];

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before reacting to messages.");
  return data.user.id;
}

export async function addMessageReaction(messageId: string, reaction: MessageReaction): Promise<void> {
  if (!MESSAGE_REACTIONS.includes(reaction)) throw new Error("Unsupported reaction.");
  const userId = await currentUserId();
  const { error } = await client().from("message_reactions").upsert(
    { message_id: messageId, user_id: userId, reaction },
    { onConflict: "message_id,user_id,reaction", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function removeMessageReaction(messageId: string, reaction: MessageReaction): Promise<void> {
  const userId = await currentUserId();
  const { error } = await client()
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("reaction", reaction);
  if (error) throw error;
}
