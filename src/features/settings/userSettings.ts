import { supabase } from "../../lib/supabase";

export type UserSettings = {
  user_id: string;
  theme: "system" | "light" | "dark";
  accent_palette: string;
  auto_reveal_secrets: boolean;
  show_read_receipts: boolean;
  show_last_seen: boolean;
  show_online_status: boolean;
  show_typing_status: boolean;
  notification_preview: "none" | "sender" | "full";
  app_lock_enabled: boolean;
  biometric_unlock_enabled: boolean;
  phone_discovery_enabled: boolean;
  updated_at: string;
};

const defaults = (userId: string): UserSettings => ({
  user_id: userId,
  theme: "system",
  accent_palette: "violet",
  auto_reveal_secrets: false,
  show_read_receipts: true,
  show_last_seen: true,
  show_online_status: true,
  show_typing_status: true,
  notification_preview: "sender",
  app_lock_enabled: false,
  biometric_unlock_enabled: false,
  phone_discovery_enabled: false,
  updated_at: new Date().toISOString(),
});

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in to load your settings.");
  return data.user.id;
}

export async function loadUserSettings(): Promise<UserSettings> {
  const userId = await currentUserId();
  const { data, error } = await client().from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (data) return data as UserSettings;

  const initial = defaults(userId);
  const { data: created, error: createError } = await client()
    .from("user_settings")
    .upsert(initial, { onConflict: "user_id" })
    .select("*")
    .single();
  if (createError) throw createError;
  return created as UserSettings;
}

export async function saveUserSettings(changes: Partial<Omit<UserSettings, "user_id" | "updated_at">>): Promise<UserSettings> {
  const userId = await currentUserId();
  await loadUserSettings();
  const { data, error } = await client()
    .from("user_settings")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as UserSettings;
}

export type ConversationSettings = {
  conversation_id: string;
  user_id: string;
  pinned_at: string | null;
  muted_until: string | null;
  archived_at: string | null;
  hidden_at: string | null;
  updated_at: string;
};

export async function loadConversationSettings(): Promise<ConversationSettings[]> {
  const userId = await currentUserId();
  const { data, error } = await client()
    .from("conversation_user_settings")
    .select("conversation_id, user_id, pinned_at, muted_until, archived_at, hidden_at, updated_at")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as ConversationSettings[];
}

export async function saveConversationSettings(
  conversationId: string,
  changes: Partial<Pick<ConversationSettings, "pinned_at" | "muted_until" | "archived_at" | "hidden_at">>,
): Promise<ConversationSettings> {
  const userId = await currentUserId();
  const { data: existing, error: lookupError } = await client()
    .from("conversation_user_settings")
    .select("conversation_id,user_id,pinned_at,muted_until,archived_at,hidden_at,updated_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const valueFor = (key: "pinned_at" | "muted_until" | "archived_at" | "hidden_at") =>
    Object.prototype.hasOwnProperty.call(changes, key)
      ? changes[key] ?? null
      : existing?.[key] ?? null;

  const { data, error } = await client()
    .upsert({
      conversation_id: conversationId,
      user_id: userId,
      pinned_at: valueFor("pinned_at"),
      muted_until: valueFor("muted_until"),
      archived_at: valueFor("archived_at"),
      hidden_at: valueFor("hidden_at"),
      updated_at: new Date().toISOString(),
    }, { onConflict: "conversation_id,user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as ConversationSettings;
}
