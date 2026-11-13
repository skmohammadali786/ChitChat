import { chitchatCore } from "../../native/chitchatCore";

/** Refuse secure messaging unless the native MLS bridge is actually linked. */
export function assertSecureMessagingAvailable(): void {
  if (!chitchatCore.available) {
    throw new Error("Secure messaging is unavailable on this platform. No message was sent.");
  }
}
