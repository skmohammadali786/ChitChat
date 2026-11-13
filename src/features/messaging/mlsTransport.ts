import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";
import { chitchatCore, type DevicePublicBundle, type MlsAddMemberResult, type MlsProcessed } from "../../native/chitchatCore";
import { createTextMessageContent, validateMessageContentShape, type MessageContent } from "./content";
import { loadEncryptedMessages, sendEncryptedMessage, type EncryptedMessageRecord } from "./service";
import { decodeBase64ToArrayBuffer, uploadEncryptedMedia, deleteEncryptedMedia, type MediaKind } from "./mediaService";
import type { PickedMedia } from "./mediaPicker";

type ConversationMlsGroup = { groupId: string; epoch: number; createdBy: string; status: string };
type MissingMlsDevice = { target_device_id: string; target_user_id: string; key_package_id: string; key_package: string };
type PendingWelcome = { welcome_id: string; conversation_id: string; welcome_message: string; expires_at: string; group_id: string; group_epoch: number };
type PendingCommit = { commit_id: string; previous_epoch: number; epoch: number; commit_message: string };

function client() {
  if (!supabase) throw new Error("ChitChat Supabase is not configured.");
  return supabase;
}
async function currentUser() {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before using MLS messaging.");
  return data.user;
}

let publishedDeviceCache: { userId: string; result: Promise<{ deviceId: string; bundle: DevicePublicBundle; keyPackage: string }> } | null = null;
const initialKeyPackageUse = new Set<string>();
const preparedConversationPackages = new Set<string>();

async function prepareKeyPackageForConversation(conversationId: string, device: { deviceId: string; bundle: DevicePublicBundle; keyPackage: string }): Promise<void> {
  const key = device.bundle.user_id + ":" + device.deviceId;
  const conversationKey = key + ":" + conversationId;
  if (preparedConversationPackages.has(conversationKey)) return;
  // The first published KeyPackage can be used once. Create a fresh one for
  // subsequent conversations because OpenMLS KeyPackages are one-time inputs.
  if (initialKeyPackageUse.has(key)) {
    const keyPackage = await chitchatCore.generateKeyPackage(device.bundle.user_id + ":" + device.deviceId);
    const { error } = await client().rpc("publish_my_mls_device", {
      p_device_id: device.deviceId,
      p_device_label: "ChitChat device",
      p_platform: Platform.OS === "ios" ? "ios" : "android",
      p_identity_key_public: device.bundle.identity_key_public,
      p_signed_prekey_public: device.bundle.signed_prekey_public,
      p_signed_prekey_signature: device.bundle.signed_prekey_signature,
      p_fingerprint: device.bundle.fingerprint,
      p_key_version: device.bundle.key_version,
      p_key_package: keyPackage,
    });
    if (error) throw error;
  } else {
    initialKeyPackageUse.add(key);
  }
  preparedConversationPackages.add(conversationKey);
}


export async function publishMyMlsDevice(): Promise<{ deviceId: string; bundle: DevicePublicBundle; keyPackage: string }> {
  const user = await currentUser();
  if (publishedDeviceCache?.userId === user.id) return publishedDeviceCache.result;
  const result = (async () => {
    await chitchatCore.openProtectedStorage();
    const bundle = await chitchatCore.createDeviceIdentity(user.id);
    const keyPackage = await chitchatCore.generateKeyPackage(user.id + ":" + bundle.device_id);
    const { error } = await client().rpc("publish_my_mls_device", {
      p_device_id: bundle.device_id,
      p_device_label: "ChitChat device",
      p_platform: Platform.OS === "ios" ? "ios" : "android",
      p_identity_key_public: bundle.identity_key_public,
      p_signed_prekey_public: bundle.signed_prekey_public,
      p_signed_prekey_signature: bundle.signed_prekey_signature,
      p_fingerprint: bundle.fingerprint,
      p_key_version: bundle.key_version,
      p_key_package: keyPackage,
    });
    if (error) throw error;
    return { deviceId: bundle.device_id, bundle, keyPackage };
  })();
  publishedDeviceCache = { userId: user.id, result };
  try {
    return await result;
  } catch (error) {
    if (publishedDeviceCache?.result === result) publishedDeviceCache = null;
    throw error;
  }
}

async function readConversationMlsGroup(conversationId: string): Promise<ConversationMlsGroup | null> {
  const { data, error } = await client().rpc("get_my_conversation_mls_group", { p_conversation_id: conversationId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.status !== "active") return null;
  return { groupId: row.mls_group_id, epoch: Number(row.epoch), createdBy: row.created_by, status: row.status };
}

export async function createConversationMlsGroup(conversationId: string): Promise<string> {
  if (!conversationId) throw new Error("A conversation is required.");
  const user = await currentUser();
  const device = await publishMyMlsDevice();
  const groupId = await chitchatCore.createGroup(user.id + ":" + device.deviceId);
  const epoch = await chitchatCore.currentEpoch(groupId);
  const { error } = await client().rpc("register_my_conversation_mls_group", {
    p_conversation_id: conversationId,
    p_mls_group_id: groupId,
    p_device_id: device.deviceId,
    p_ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
    p_epoch: epoch,
  });
  if (error) throw error;
  return groupId;
}

export async function getConversationMlsGroup(conversationId: string): Promise<{ groupId: string; epoch: number }> {
  const group = await readConversationMlsGroup(conversationId);
  if (!group) throw new Error("This conversation has no active MLS group yet. The conversation owner must initialize its secure group.");
  return { groupId: group.groupId, epoch: group.epoch };
}

async function processPendingWelcomes(conversationId: string, deviceId: string): Promise<number> {
  const { data, error } = await client().rpc("get_my_mls_welcomes", {
    p_conversation_id: conversationId,
    p_device_id: deviceId,
  });
  if (error) throw error;
  let joined = 0;
  for (const welcome of (Array.isArray(data) ? data : []) as PendingWelcome[]) {
    let localGroupId = "";
    try {
      localGroupId = await chitchatCore.joinGroup(welcome.welcome_message);
    } catch (joinError) {
      // A repeated Welcome is safe to acknowledge only when its group already exists locally.
      try {
        const knownEpoch = await chitchatCore.currentEpoch(welcome.group_id);
        if (knownEpoch < 0) throw joinError;
        localGroupId = welcome.group_id;
      } catch {
        throw joinError;
      }
    }
    if (localGroupId !== welcome.group_id) throw new Error("The MLS Welcome belongs to a different conversation group.");
    const joinedEpoch = await chitchatCore.currentEpoch(localGroupId);
    const { error: ackError } = await client().rpc("ack_my_mls_welcome", {
      p_welcome_id: welcome.welcome_id,
      p_device_id: deviceId,
      p_joined_group_id: localGroupId,
      p_joined_epoch: joinedEpoch,
    });
    if (ackError) throw ackError;
    joined += 1;
  }
  return joined;
}

async function processPendingCommits(conversationId: string, deviceId: string, groupId: string): Promise<number> {
  const { data, error } = await client().rpc("get_my_pending_mls_commits", {
    p_conversation_id: conversationId,
    p_device_id: deviceId,
  });
  if (error) throw error;
  let applied = 0;
  for (const commit of (Array.isArray(data) ? data : []) as PendingCommit[]) {
    const localEpoch = await chitchatCore.currentEpoch(groupId);
    if (localEpoch !== Number(commit.previous_epoch)) {
      if (localEpoch >= Number(commit.epoch)) {
        const { error: ackAlreadyApplied } = await client().rpc("ack_my_mls_commit", {
          p_commit_id: commit.commit_id, p_device_id: deviceId, p_applied_epoch: Number(commit.epoch),
        });
        if (ackAlreadyApplied) throw ackAlreadyApplied;
        continue;
      }
      throw new Error("MLS group is out of sync. A required Commit is missing, so sending is paused.");
    }
    const processed: MlsProcessed = await chitchatCore.processMessage(groupId, commit.commit_message, true);
    if (processed.kind !== "commit_merged" || Number(processed.epoch) !== Number(commit.epoch)) {
      throw new Error("The incoming MLS Commit could not be authenticated or merged.");
    }
    const { error: ackError } = await client().rpc("ack_my_mls_commit", {
      p_commit_id: commit.commit_id,
      p_device_id: deviceId,
      p_applied_epoch: Number(processed.epoch),
    });
    if (ackError) throw ackError;
    applied += 1;
  }
  return applied;
}

/**
 * Bring this device up to the server-authorized MLS epoch.
 * The server never sees private keys or decrypted message content.
 */
export async function syncConversationMlsGroup(conversationId: string): Promise<{ groupId: string; epoch: number; joined: number; commits: number; addedDevices: number }> {
  if (!conversationId) throw new Error("A conversation is required.");
  const user = await currentUser();
  const device = await publishMyMlsDevice();
  await prepareKeyPackageForConversation(conversationId, device);
  let group = await readConversationMlsGroup(conversationId);

  if (!group) {
    const { data: conversation, error: conversationError } = await client()
      .from("conversations").select("id,created_by").eq("id", conversationId).maybeSingle();
    if (conversationError) throw conversationError;
    if (conversation?.created_by !== user.id) {
      throw new Error("The conversation owner has not initialized the MLS group yet.");
    }
    await createConversationMlsGroup(conversationId);
    group = await readConversationMlsGroup(conversationId);
    if (!group) throw new Error("The MLS group was created but could not be loaded from the server.");
  }

  const joined = await processPendingWelcomes(conversationId, device.deviceId);
  let commits = await processPendingCommits(conversationId, device.deviceId, group.groupId);
  let addedDevices = 0;

  const { data: missingDevices, error: missingError } = await client().rpc("list_missing_mls_devices", {
    p_conversation_id: conversationId,
  });
  if (missingError) {
    if (!missingError.message.includes("mls_group_admin_required")) throw missingError;
  } else {
    for (const target of (Array.isArray(missingDevices) ? missingDevices : []) as MissingMlsDevice[]) {
      const previousEpoch = await chitchatCore.currentEpoch(group.groupId);
      const addition: MlsAddMemberResult = await chitchatCore.addMember(group.groupId, target.key_package);
      if (Number(addition.epoch) !== previousEpoch + 1) throw new Error("The local MLS engine returned an unexpected membership epoch.");
      const { error: publishError } = await client().rpc("publish_mls_member_add", {
        p_conversation_id: conversationId,
        p_sender_device_id: device.deviceId,
        p_target_device_id: target.target_device_id,
        p_key_package_id: target.key_package_id,
        p_welcome_message: addition.welcome_base64,
        p_commit_message: addition.commit_base64,
        p_previous_epoch: previousEpoch,
        p_epoch: Number(addition.epoch),
      });
      if (publishError) throw publishError;
      addedDevices += 1;
    }
  }

  commits += await processPendingCommits(conversationId, device.deviceId, group.groupId);
  const epoch = await chitchatCore.currentEpoch(group.groupId);
  const refreshed = await readConversationMlsGroup(conversationId);
  if (!refreshed || refreshed.groupId !== group.groupId) throw new Error("The active MLS group changed during synchronization.");
  if (epoch !== refreshed.epoch) {
    throw new Error("This device has not applied all required MLS membership Commit messages yet.");
  }
  return { groupId: group.groupId, epoch, joined, commits, addedDevices };
}

export async function sendMlsTextMessage(conversationId: string, text: string, options: { expiresAt?: string | null; concealed?: boolean } = {}) {
  return sendMlsContent(conversationId, createTextMessageContent(text, options.concealed ?? false), options.expiresAt ?? null);
}
export async function sendMlsContent(conversationId: string, content: MessageContent, expiresAt: string | null = null): Promise<EncryptedMessageRecord> {
  validateMessageContentShape(content);
  const user = await currentUser();
  const group = await syncConversationMlsGroup(conversationId);
  const ciphertext = await chitchatCore.encryptContent(group.groupId, content);
  const epoch = await chitchatCore.currentEpoch(group.groupId);
  const deviceId = await chitchatCore.getCurrentDeviceId();
  if (epoch !== group.epoch) throw new Error("The MLS group changed while composing this message. Retry after synchronization.");
  return sendEncryptedMessage(conversationId, {
    client_message_id: createUuid(),
    message_type: "text",
    ciphertext,
    nonce: "mls-rfc9420",
    crypto_header: {
      protocol: "mls",
      protocol_version: 1,
      ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
      group_id: group.groupId,
      epoch,
      sender_id: user.id,
      sender_device_id: deviceId,
      content_type: "application",
      message_type: "text",
    },
    key_version: 1,
    expires_at: expiresAt,
  });
}
/**
 * Encrypt a selected local file in the native Rust layer, upload only ciphertext
 * to private R2, then publish the MLS ciphertext that contains the wrapped key.
 * The media object is removed again if the message RPC fails.
 */
export async function sendMlsMediaMessage(
  conversationId: string,
  picked: PickedMedia,
  options: { expiresAt?: string | null; concealed?: boolean } = {},
): Promise<EncryptedMessageRecord> {
  if (!conversationId || !picked?.uri) throw new Error("Choose a file and conversation first.");
  const user = await currentUser();
  const group = await syncConversationMlsGroup(conversationId);
  const encrypted = await chitchatCore.encryptMediaFile(
    picked.uri,
    group.groupId,
    picked.kind as MediaKind,
    options.concealed ?? false,
  );
  if (!encrypted.object_id || encrypted.media_kind !== picked.kind || !encrypted.content_message_base64) {
    throw new Error("The native media encryptor returned incomplete MLS metadata.");
  }
  const stored = await uploadEncryptedMedia(conversationId, picked.kind, {
    bytes: decodeBase64ToArrayBuffer(encrypted.ciphertext_base64),
    sha256: encrypted.sha256,
    cryptoVersion: encrypted.crypto_version,
    keyEnvelope: encrypted.key_envelope,
    objectId: encrypted.object_id,
  });
  try {
    const epoch = await chitchatCore.currentEpoch(group.groupId);
    const deviceId = await chitchatCore.getCurrentDeviceId();
    if (epoch !== group.epoch) throw new Error("The MLS group changed during media upload. Retry after synchronization.");
    return await sendEncryptedMessage(conversationId, {
      client_message_id: createUuid(),
      message_type: picked.kind,
      ciphertext: encrypted.content_message_base64,
      nonce: "mls-rfc9420",
      crypto_header: {
        protocol: "mls",
        protocol_version: 1,
        ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
        group_id: group.groupId,
        epoch,
        sender_id: user.id,
        sender_device_id: deviceId,
        content_type: "application",
        message_type: picked.kind,
        media_object_id: stored.id,
      },
      key_version: 1,
      expires_at: options.expiresAt ?? null,
    });
  } catch (error) {
    await deleteEncryptedMedia(stored.id).catch(cleanupError => {
      console.warn("ChitChat could not remove an orphaned encrypted media object.", cleanupError);
    });
    throw error;
  }
}

export async function decryptMlsMessage(record: EncryptedMessageRecord): Promise<MessageContent> {
  const header = record.crypto_header as Record<string, unknown>;
  if (header.protocol !== "mls" || header.content_type !== "application" || typeof header.group_id !== "string") {
    throw new Error("Unsupported MLS message envelope.");
  }
  const processed = await chitchatCore.processMessage(header.group_id, record.ciphertext);
  if (processed.kind !== "application" || !processed.content || typeof processed.content !== "object") {
    throw new Error("No authenticated MLS application content was returned.");
  }
  const content = processed.content as MessageContent;
  validateMessageContentShape(content);
  return content;
}
export async function loadDecryptedMlsHistory(conversationId: string, limit = 100) {
  await syncConversationMlsGroup(conversationId);
  const encrypted = await loadEncryptedMessages(conversationId, limit);
  const messages: Array<{ record: EncryptedMessageRecord; content: MessageContent }> = [];
  const undecryptable: EncryptedMessageRecord[] = [];
  for (const record of encrypted) {
    if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) continue;
    try {
      messages.push({ record, content: await decryptMlsMessage(record) });
    } catch {
      undecryptable.push(record);
    }
  }
  return { messages, undecryptable };
}
export async function searchDecryptedMlsHistory(conversationId: string, query: string, limit = 100) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const history = await loadDecryptedMlsHistory(conversationId, limit);
  return history.messages.filter(({ content }) => content.blocks.some(block => block.type === "text" && block.text.toLocaleLowerCase().includes(needle)));
}
function createUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
