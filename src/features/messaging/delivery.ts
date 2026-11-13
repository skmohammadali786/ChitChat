import type { EncryptedMessageEnvelope, EncryptedMessageRecord } from "./service";
import { sendEncryptedMessage } from "./service";
import { assertSecureMessagingAvailable } from "./cryptoGate";
import {
  enqueueEncryptedMessage,
  listPendingEncryptedMessages,
  updatePendingEncryptedMessage,
} from "./outbox";

export type EncryptedSendResult =
  | { status: "sent"; message: EncryptedMessageRecord }
  | { status: "queued"; clientMessageId: string };

function isTransientDeliveryFailure(error: unknown): boolean {
  const value = error as { message?: unknown; status?: unknown; code?: unknown } | null;
  const status = Number(value?.status);
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return true;
  const message = typeof value?.message === "string" ? value.message.toLowerCase() : "";
  const code = typeof value?.code === "string" ? value.code.toLowerCase() : "";
  return /network request failed|failed to fetch|fetch failed|timed? ?out|offline|econn|enetunreach|connection lost/.test(`${message} ${code}`);
}

/**
 * Send an already encrypted envelope. A transient network failure stores that
 * same ciphertext for retry. Protocol, authorization, and validation failures
 * are returned to the caller and are never hidden as offline delivery.
 */
export async function sendEncryptedMessageWithQueue(
  conversationId: string,
  envelope: EncryptedMessageEnvelope,
): Promise<EncryptedSendResult> {
  assertSecureMessagingAvailable();
  try {
    const message = await sendEncryptedMessage(conversationId, envelope);
    return { status: "sent", message };
  } catch (error) {
    if (!isTransientDeliveryFailure(error)) throw error;
    await enqueueEncryptedMessage(conversationId, envelope);
    return { status: "queued", clientMessageId: envelope.client_message_id };
  }
}

/**
 * Retry pending ciphertext in FIFO order. A successful server insert is
 * idempotent by sender + client_message_id, so a lost response is safe to retry.
 */
export async function flushPendingEncryptedMessages(): Promise<{ sent: number; pending: number }> {
  assertSecureMessagingAvailable();
  const queue = await listPendingEncryptedMessages();
  let sent = 0;

  for (const item of queue) {
    try {
      await sendEncryptedMessage(item.conversationId, item.envelope);
      await updatePendingEncryptedMessage(item.envelope.client_message_id, () => null);
      sent += 1;
    } catch (error) {
      if (isTransientDeliveryFailure(error)) {
        await updatePendingEncryptedMessage(item.envelope.client_message_id, current => ({
          ...current,
          attempts: current.attempts + 1,
        }));
      }
      break;
    }
  }

  return {
    sent,
    pending: (await listPendingEncryptedMessages()).length,
  };
}
