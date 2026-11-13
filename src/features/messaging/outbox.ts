import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import type { EncryptedMessageEnvelope } from "./service";
import { supabase } from "../../lib/supabase";

const storage = createAsyncStorage("chitchat-encrypted-outbox-v1");
const MAX_ITEMS = 200;
const MAX_SERIALIZED_BYTES = 5 * 1024 * 1024;

export type PendingEncryptedMessage = {
  conversationId: string;
  envelope: EncryptedMessageEnvelope;
  queuedAt: string;
  attempts: number;
};

let queueOperation: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueOperation.then(operation, operation);
  queueOperation = result.then(() => undefined, () => undefined);
  return result;
}

async function currentUserId(): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before using the message outbox.");
  return data.user.id;
}

function storageKey(userId: string): string {
  return `pending.${userId}`;
}

function isEnvelope(value: unknown): value is EncryptedMessageEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<EncryptedMessageEnvelope>;
  return typeof envelope.client_message_id === "string"
    && envelope.client_message_id.length > 0
    && ["text", "image", "video", "audio", "file"].includes(String(envelope.message_type))
    && typeof envelope.ciphertext === "string"
    && envelope.ciphertext.length > 0
    && envelope.ciphertext.length <= 1_000_000
    && typeof envelope.nonce === "string"
    && envelope.nonce.length > 0
    && envelope.nonce.length <= 256
    && Number.isInteger(envelope.key_version)
    && Number(envelope.key_version) > 0
    && Boolean(envelope.crypto_header)
    && typeof envelope.crypto_header === "object"
    && !Array.isArray(envelope.crypto_header);
}

function parseQueue(raw: string | null): PendingEncryptedMessage[] {
  if (!raw) return [];
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!Array.isArray(decoded)) return [];
    return decoded.filter((item): item is PendingEncryptedMessage => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<PendingEncryptedMessage>;
      return typeof value.conversationId === "string"
        && value.conversationId.length > 0
        && isEnvelope(value.envelope)
        && typeof value.queuedAt === "string"
        && Number.isInteger(value.attempts)
        && Number(value.attempts) >= 0;
    });
  } catch {
    return [];
  }
}

async function readForUser(userId: string): Promise<PendingEncryptedMessage[]> {
  return parseQueue(await storage.getItem(storageKey(userId)));
}

async function writeForUser(userId: string, items: PendingEncryptedMessage[]): Promise<void> {
  if (items.length > MAX_ITEMS) throw new Error("The offline message queue is full. Connect to the internet and retry.");
  const serialized = JSON.stringify(items);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) {
    throw new Error("The offline message queue reached its storage limit. Retry when online.");
  }
  await storage.setItem(storageKey(userId), serialized);
}

/**
 * Persist only a protocol-generated encrypted envelope. No plaintext body,
 * attachment bytes, access token, or private key is accepted by this module.
 */
export async function enqueueEncryptedMessage(
  conversationId: string,
  envelope: EncryptedMessageEnvelope,
): Promise<void> {
  if (!conversationId || !isEnvelope(envelope)) {
    throw new Error("Only a valid encrypted message envelope can enter the outbox.");
  }
  const userId = await currentUserId();
  await serialize(async () => {
    const items = await readForUser(userId);
    const existing = items.find(item => item.envelope.client_message_id === envelope.client_message_id);
    if (existing) {
      if (existing.conversationId !== conversationId || JSON.stringify(existing.envelope) !== JSON.stringify(envelope)) {
        throw new Error("The message ID already exists in the outbox with different content.");
      }
      return;
    }
    items.push({
      conversationId,
      envelope,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });
    await writeForUser(userId, items);
  });
}

export async function listPendingEncryptedMessages(): Promise<PendingEncryptedMessage[]> {
  const userId = await currentUserId();
  return serialize(() => readForUser(userId));
}

export async function updatePendingEncryptedMessage(
  clientMessageId: string,
  update: (item: PendingEncryptedMessage) => PendingEncryptedMessage | null,
): Promise<void> {
  const userId = await currentUserId();
  await serialize(async () => {
    const items = await readForUser(userId);
    const next: PendingEncryptedMessage[] = [];
    for (const item of items) {
      if (item.envelope.client_message_id !== clientMessageId) {
        next.push(item);
        continue;
      }
      const updated = update(item);
      if (updated) next.push(updated);
    }
    await writeForUser(userId, next);
  });
}
