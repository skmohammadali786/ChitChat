import { supabase } from "../../lib/supabase";
import { assertSecureMessagingAvailable } from "./cryptoGate";
import { chitchatCore } from "../../native/chitchatCore";

const mediaApiUrl = process.env.EXPO_PUBLIC_MEDIA_API_URL?.trim().replace(/\/$/, "");
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export type MediaKind = "image" | "video" | "audio" | "file";

export type EncryptedMediaPayload = {
  /** Ciphertext bytes produced by the native Rust crypto layer. */
  bytes: ArrayBuffer;
  /** SHA-256 digest of the ciphertext bytes, produced by Rust. */
  sha256: string;
  /** Protocol version used to encrypt the payload. */
  cryptoVersion: number;
  /** Encrypted file-key envelope. This is MLS-protected for message media. */
  keyEnvelope: string;
};

export type StoredMedia = {
  id: string;
  media_kind: MediaKind | "avatar";
  size_bytes: number;
  encrypted: true;
  crypto_version: number;
  storage: "cloudflare-r2";
};

async function sessionToken(): Promise<string> {
  if (!supabase) throw new Error("ChitChat Supabase is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before accessing encrypted media.");
  return token;
}

function requireMediaApi(): string {
  if (!mediaApiUrl) {
    throw new Error("Cloudflare media API is not configured in this build.");
  }
  return mediaApiUrl;
}

async function readError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error || `Cloudflare media request failed (${response.status}).`);
}

/**
 * Upload ciphertext bytes to the private Cloudflare R2 bucket.
 * Callers must obtain the payload from the native Rust encryption API.
 * This module intentionally has no plaintext-file upload function.
 */
export async function uploadEncryptedMedia(
  conversationId: string,
  mediaKind: MediaKind,
  payload: EncryptedMediaPayload,
): Promise<StoredMedia> {
  assertSecureMessagingAvailable();
  if (!conversationId) throw new Error("A conversation is required.");
  if (!payload.keyEnvelope || payload.keyEnvelope.length < 32 || payload.keyEnvelope.length > 8_192) {
    throw new Error("An encrypted media key envelope is required.");
  }
  if (!(payload.bytes instanceof ArrayBuffer) || payload.bytes.byteLength < 1 || payload.bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new Error("Encrypted media must be between 1 byte and 50 MB.");
  }
  if (!/^[a-f0-9]{64}$/.test(payload.sha256) || !Number.isInteger(payload.cryptoVersion) || payload.cryptoVersion < 1) {
    throw new Error("The Rust media encryption metadata is invalid.");
  }

  const token = await sessionToken();
  const response = await fetch(
    `${requireMediaApi()}/v1/conversations/${encodeURIComponent(conversationId)}/media`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-chitchat-media-kind": mediaKind,
        "x-content-sha256": payload.sha256,
        "x-chitchat-crypto-version": String(payload.cryptoVersion),
        "x-chitchat-key-envelope": payload.keyEnvelope,
      },
      body: payload.bytes,
    },
  );
  if (!response.ok) throw await readError(response);
  return await response.json() as StoredMedia;
}

export async function uploadEncryptedAvatar(payload: EncryptedMediaPayload): Promise<StoredMedia> {
  if (!chitchatCore.avatarCryptoAvailable) {
    throw new Error("The protected Rust avatar encryption module is not linked in this build.");
  }
  if (!payload.keyEnvelope || payload.keyEnvelope.length < 32 || payload.keyEnvelope.length > 8_192) {
    throw new Error("An encrypted avatar key envelope is required.");
  }
  if (!(payload.bytes instanceof ArrayBuffer) || payload.bytes.byteLength < 1 || payload.bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new Error("Encrypted avatar must be between 1 byte and 50 MB.");
  }
  if (!/^[a-f0-9]{64}$/.test(payload.sha256) || !Number.isInteger(payload.cryptoVersion) || payload.cryptoVersion < 1) {
    throw new Error("The Rust avatar encryption metadata is invalid.");
  }

  const token = await sessionToken();
  const response = await fetch(`${requireMediaApi()}/v1/avatars`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "x-content-sha256": payload.sha256,
      "x-chitchat-crypto-version": String(payload.cryptoVersion),
      "x-chitchat-key-envelope": payload.keyEnvelope,
    },
    body: payload.bytes,
  });
  if (!response.ok) throw await readError(response);
  return await response.json() as StoredMedia;
}

export async function downloadEncryptedMedia(mediaId: string): Promise<{
  bytes: ArrayBuffer;
  sha256: string;
  cryptoVersion: number;
  keyEnvelope: string;
}> {
  if (!mediaId) throw new Error("A media ID is required.");
  const token = await sessionToken();
  const response = await fetch(`${requireMediaApi()}/v1/media/${encodeURIComponent(mediaId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await readError(response);
  const sha256 = response.headers.get("x-content-sha256") || "";
  const cryptoVersion = Number(response.headers.get("x-chitchat-crypto-version") || "0");
  const keyEnvelope = response.headers.get("x-chitchat-key-envelope") || "";
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(cryptoVersion) || cryptoVersion < 1 || keyEnvelope.length < 32 || keyEnvelope.length > 8_192) throw new Error("The stored media encryption metadata is invalid.");
  return { bytes: await response.arrayBuffer(), sha256, cryptoVersion, keyEnvelope };
}

export async function deleteEncryptedMedia(mediaId: string): Promise<void> {
  if (!mediaId) throw new Error("A media ID is required.");
  const token = await sessionToken();
  const response = await fetch(`${requireMediaApi()}/v1/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await readError(response);
}
