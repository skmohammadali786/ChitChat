import { supabase } from "../../lib/supabase";

export type PushPlatform = "android" | "ios";

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function registerPushDevice(
  expoPushToken: string,
  platform: PushPlatform,
  deviceLabel = "Mobile device",
): Promise<void> {
  if (!expoPushToken.startsWith("ExponentPushToken[") && !expoPushToken.startsWith("ExpoPushToken[")) {
    throw new Error("Invalid Expo push token.");
  }
  const { data: auth, error: authError } = await client().auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("Sign in before registering notifications.");
  const { error } = await client().from("push_devices").upsert({
    user_id: auth.user.id,
    expo_push_token: expoPushToken,
    platform,
    device_label: deviceLabel.slice(0, 80),
    last_seen_at: new Date().toISOString(),
    revoked_at: null,
  }, { onConflict: "expo_push_token" });
  if (error) throw error;
}

export async function unregisterPushDevice(expoPushToken: string): Promise<void> {
  const { data: auth, error: authError } = await client().auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("Sign in before updating notifications.");
  const { error } = await client()
    .from("push_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .eq("expo_push_token", expoPushToken);
  if (error) throw error;
}
