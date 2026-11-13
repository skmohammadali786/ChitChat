import { supabase } from "../../lib/supabase";

export type ConversationReportReason = "spam" | "harassment" | "threats" | "nudity" | "impersonation" | "unsafe_content" | "other";

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

/** Submit a private report. The server derives the reporter identity and checks membership/rate limits. */
export async function reportConversation(input: {
  conversationId: string;
  targetUserId?: string | null;
  reason: ConversationReportReason;
  details?: string;
}): Promise<string> {
  if (!input.conversationId) throw new Error("Choose a conversation to report.");
  if (input.details && input.details.length > 1000) throw new Error("Report details cannot exceed 1000 characters.");

  const { data: auth, error: authError } = await client().auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("Sign in before submitting a report.");
  if (input.targetUserId && input.targetUserId === auth.user.id) {
    throw new Error("You cannot report your own account.");
  }

  const { data, error } = await client().rpc("report_conversation", {
    target_conversation_id: input.conversationId,
    target_user_id: input.targetUserId ?? null,
    target_reason: input.reason,
    report_details: input.details ?? "",
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("The report could not be confirmed.");
  return data;
}
