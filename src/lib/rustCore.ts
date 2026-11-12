import { chitchatCore } from "../native/chitchatCore";
import type { ChitChatProfile } from "./supabase";

export type RustProfileInput = Pick<ChitChatProfile, "username" | "display_name" | "bio" | "discoverable">;

export async function validateProfileWithRust(profile: RustProfileInput): Promise<void> {
  await chitchatCore.validateProfile(profile);
}

export async function validateEnvelopeWithRust(envelope: {
  client_message_id: string;
  message_kind: "text" | "image" | "video" | "audio" | "file" | "system";
  ciphertext: string;
  nonce: string;
  crypto_header: Record<string, unknown>;
  key_version: number;
}): Promise<void> {
  await chitchatCore.validateEnvelope(envelope);
}
