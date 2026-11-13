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
const MAX_DELIVERY_ATTEMPTS = 8;
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

function errorLabel(error: unknown): string {
  const value = error as { message?: unknown; status?: unknown; code?: unknown } | null;
  const message = typeof value?.message === "string" ? value.message.slice(0, 180) : "Delivery failed.";
  const status = Number(value?.status);
  const code = typeof value?.code === "string" ? value.code.slice(0, 40) : "";
  return [Number.isFinite(status) && status > 0 ? `HTTP ${status}` : "", code, message]
    .filter(Boolean)
    .join(": ");
}

/**
 * Retry pending ciphertext in FIFO order with persisted exponential backoff.
 * The first blocked/failed item stops the queue so later messages do not overtake it.
 */
export async function flushPendingEncryptedMessages(): Promise<{ sent: number; pending: number; failed: number }> {
  assertSecureMessagingAvailable();
  const queue = await listPendingEncryptedMessages();
  let sent = 0;

  for (const item of queue) {
    if (item.failedAt) break;
    const nextAttemptAt = Date.parse(item.nextAttemptAt || item.queuedAt);
    if (!Number.isFinite(nextAttemptAt) || nextAttemptAt > Date.now()) break;

    try {
      await sendEncryptedMessage(item.conversationId, item.envelope);
      await updatePendingEncryptedMessage(item.envelope.client_message_id, () => null);
      sent += 1;
    } catch (error) {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const transient = isTransientDeliveryFailure(error);
      await updatePendingEncryptedMessage(item.envelope.client_message_id, current => {
        const attempts = current.attempts + (transient ? 1 : 0);
        const failed = !transient || attempts >= MAX_DELIVERY_ATTEMPTS;
        const delay = Math.min(
          BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempts - 1)),
          MAX_RETRY_DELAY_MS,
        );
        return {
          ...current,
          attempts,
          nextAttemptAt: failed ? nowIso : new Date(now + delay).toISOString(),
          failedAt: failed ? nowIso : null,
          lastError: errorLabel(error),
        };
      });
      break;
    }
  }

  const remaining = await listPendingEncryptedMessages();
  return {
    sent,
    pending: remaining.length,
    failed: remaining.filter(item => Boolean(item.failedAt)).length,
  };
}

/** Explicitly re-enable one failed item after the user resolves the cause. */
export async function retryFailedEncryptedMessage(clientMessageId: string): Promise<void> {
  if (!clientMessageId) throw new Error("Choose a failed message to retry.");
  await updatePendingEncryptedMessage(clientMessageId, current => ({
    ...current,
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
    failedAt: null,
    lastError: null,
  }));
}
