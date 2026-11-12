import { chitchatCore } from "../../native/chitchatCore";

/**
 * Fail-closed guard for message sends. The Rust envelope validator does not
 * encrypt content yet, so this gate remains disabled until protocol
 * implementation and device-key management are completed and reviewed.
 */
export function assertSecureMessagingAvailable(): void {
  if (!chitchatCore.available) {
    throw new Error("Secure messaging is not ready on this build. No plaintext message was sent.");
  }
  throw new Error("The Rust protocol adapter is not enabled. No message was sent.");
}
