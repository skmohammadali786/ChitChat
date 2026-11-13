import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";
import type { DevicePublicBundle } from "../../native/chitchatCore";

export type RegisteredDevice = {
  id: string;
  user_id: string;
  device_label: string;
  platform: "android" | "ios";
  identity_key_public: string;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  fingerprint: string | null;
  key_version: number;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in to manage devices.");
  return data.user.id;
}

export async function listMyDevices(): Promise<RegisteredDevice[]> {
  const userId = await currentUserId();
  const { data, error } = await client()
    .from("devices")
    .select("id,user_id,device_label,platform,identity_key_public,signed_prekey_public,signed_prekey_signature,fingerprint,key_version,created_at,last_seen_at,revoked_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RegisteredDevice[];
}

export async function registerMyDevice(bundle: DevicePublicBundle): Promise<RegisteredDevice> {
  const userId = await currentUserId();
  if (bundle.user_id !== userId) throw new Error("The device identity belongs to another account.");
  const { data, error } = await client()
    .from("devices")
    .insert({
      id: bundle.device_id,
      user_id: userId,
      device_label: Platform.OS === "android" ? "Android device" : "iOS device",
      platform: Platform.OS === "android" ? "android" : "ios",
      identity_key_public: bundle.identity_key_public,
      signed_prekey_public: bundle.signed_prekey_public,
      signed_prekey_signature: bundle.signed_prekey_signature,
      fingerprint: bundle.fingerprint,
      key_version: bundle.key_version,
      last_seen_at: new Date().toISOString(),
    })
    .select("id,user_id,device_label,platform,identity_key_public,signed_prekey_public,signed_prekey_signature,fingerprint,key_version,created_at,last_seen_at,revoked_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("This device is already registered.");
    throw error;
  }
  return data as RegisteredDevice;
}

export async function revokeMyDevice(deviceId: string): Promise<void> {
  if (!deviceId) throw new Error("Choose a device to revoke.");
  const userId = await currentUserId();
  const { data, error } = await client()
    .from("devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Device not found or already revoked.");
}

export type PeerDevice = {
  device_id: string;
  user_id: string;
  device_label: string;
  platform: "android" | "ios";
  identity_key_public: string;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  fingerprint: string | null;
  key_version: number;
  created_at: string;
  last_seen_at: string;
  trusted: boolean;
  trusted_at: string | null;
};

export async function listPeerDevices(
  conversationId: string,
  peerUserId: string,
): Promise<PeerDevice[]> {
  if (!conversationId || !peerUserId) throw new Error("A conversation and peer account are required.");
  const { data, error } = await client().rpc("list_peer_devices", {
    target_conversation_id: conversationId,
    target_user_id: peerUserId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as PeerDevice[];
}

export async function trustPeerDevice(deviceId: string, fingerprint: string): Promise<string> {
  if (!deviceId || !/^\d{10}$/.test(fingerprint)) {
    throw new Error("A verified device and ten-digit fingerprint are required.");
  }
  const { data, error } = await client().rpc("trust_peer_device", {
    target_device_id: deviceId,
    expected_fingerprint: fingerprint,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Supabase returned an invalid device trust timestamp.");
  return data;
}

export async function untrustPeerDevice(deviceId: string): Promise<void> {
  if (!deviceId) throw new Error("Choose a device to remove from trusted devices.");
  const { error } = await client().rpc("untrust_peer_device", {
    target_device_id: deviceId,
  });
  if (error) throw error;
}

export type PeerDevice = {
  device_id: string;
  user_id: string;
  device_label: string;
  platform: "android" | "ios";
  identity_key_public: string;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  fingerprint: string | null;
  key_version: number;
  created_at: string;
  last_seen_at: string;
  trusted: boolean;
  trusted_at: string | null;
};

export async function listPeerDevices(conversationId: string, peerUserId: string): Promise<PeerDevice[]> {
  if (!conversationId || !peerUserId) throw new Error("A conversation and peer account are required.");
  const { data, error } = await client().rpc("list_peer_devices", {
    target_conversation_id: conversationId,
    target_user_id: peerUserId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as PeerDevice[];
}

export async function trustPeerDevice(deviceId: string, fingerprint: string): Promise<void> {
  if (!deviceId || !/^\d{10}$/.test(fingerprint)) throw new Error("A verified device and ten-digit fingerprint are required.");
  const { error } = await client().rpc("trust_peer_device", {
    target_device_id: deviceId,
    expected_fingerprint: fingerprint,
  });
  if (error) throw error;
}

export async function untrustPeerDevice(deviceId: string): Promise<void> {
  if (!deviceId) throw new Error("Choose a device to remove from trusted devices.");
  const { error } = await client().rpc("untrust_peer_device", { target_device_id: deviceId });
  if (error) throw error;
}
