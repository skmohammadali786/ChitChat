import { supabase } from "../../lib/supabase";
import { assertSecureMessagingAvailable } from "./cryptoGate";
import { chitchatCore } from "../../native/chitchatCore";

const mediaApiUrl = process.env.EXPO_PUBLIC_MEDIA_API_URL?.trim().replace(/\/$/, "");
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
  /** UUID embedded in the MLS media block and used as the R2 object ID. */
  objectId: string;
};

export type StoredMedia = {
  id: string;
  media_kind: MediaKind | "avatar";
  size_bytes: number;
  encrypted: true;
  crypto_version: number;
  storage: "cloudflare-r2";
};

function decodeBase64(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!normalized || !/^[A-Za-z0-9+/]+$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error("The native Rust module returned invalid base64 ciphertext.");
  }
  const output = new Uint8Array(Math.floor(normalized.length * 6 / 8));
  let buffer = 0;
  let bitCount = 0;
  let offset = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = BASE64_ALPHABET.indexOf(normalized[index]);
    if (code < 0) throw new Error("The native Rust module returned invalid base64 ciphertext.");
    buffer = ((buffer << 6) | code) & 0xffff;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output[offset] = (buffer >> bitCount) & 0xff;
      offset += 1;
    }
  }
  if (offset !== output.byteLength) throw new Error("The native Rust module returned truncated ciphertext.");
  return output.buffer;
}

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  const chunks: string[] = [];
  const chunkBytes = 12_288;
  for (let start = 0; start < bytes.length; start += chunkBytes) {
    const end = Math.min(start + chunkBytes, bytes.length);
    let encoded = "";
    for (let index = start; index < end; index += 3) {
      const first = bytes[index];
      const hasSecond = index + 1 < end;
      const hasThird = index + 2 < end;
      const second = hasSecond ? bytes[index + 1] : 0;
      const third = hasThird ? bytes[index + 2] : 0;
      const combined = (first << 16) | (second << 8) | third;
      encoded += BASE64_ALPHABET[(combined >> 18) & 63];
      encoded += BASE64_ALPHABET[(combined >> 12) & 63];
      encoded += hasSecond ? BASE64_ALPHABET[(combined >> 6) & 63] : "=";
      encoded += hasThird ? BASE64_ALPHABET[combined & 63] : "=";
    }
    chunks.push(encoded);
  }
  return chunks.join("").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

  if (!/^[0-9a-f-]{36}$/i.test(payload.objectId)) throw new Error("An encrypted media object ID is required.");
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
        "x-chitchat-object-id": payload.objectId,
      },
      body: payload.bytes,
    },
  );
  if (!response.ok) throw await readError(response);
  const stored = await response.json() as StoredMedia;
  if (stored.id !== payload.objectId || stored.media_kind !== mediaKind || stored.encrypted !== true) {
    throw new Error("The media server returned metadata that does not match the encrypted message.");
  }
  return stored;
}

export async function uploadEncryptedAvatar(payload: EncryptedMediaPayload): Promise<StoredMedia> {
  if (!chitchatCore.avatarEncryptionAvailable) {
    throw new Error("The protected Rust avatar encryption module is not linked in this build.");
  }
  if (!payload.keyEnvelope || payload.keyEnvelope.length < 32 || payload.keyEnvelope.length > 8_192) {
    throw new Error("An encrypted avatar key envelope is required.");
  }
  if (!(payload.bytes instanceof ArrayBuffer) || payload.bytes.byteLength < 1 || payload.bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new Error("Encrypted avatar must be between 1 byte and 8 MB.");
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
  mediaKind: MediaKind | "avatar";
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
  const mediaKind = response.headers.get("x-chitchat-media-kind") as MediaKind | "avatar" | null;
  if (
    !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isInteger(cryptoVersion)
    || cryptoVersion < 1
    || keyEnvelope.length < 32
    || keyEnvelope.length > 8_192
    || !["image", "video", "audio", "file", "avatar"].includes(mediaKind || "")
  ) {
    throw new Error("The stored media encryption metadata is invalid.");
  }
  return { bytes: await response.arrayBuffer(), sha256, cryptoVersion, keyEnvelope, mediaKind: mediaKind! };
}

export async function getDecryptedMediaUri(
  mediaId: string,
  authenticatedContentJson: string,
  objectId: string,
  expectedKind: MediaKind,
): Promise<string> {
  if (!chitchatCore.mediaDecryptionAvailable) {
    throw new Error("The protected Rust media decryptor is not linked in this build.");
  }
  const encrypted = await downloadEncryptedMedia(mediaId);
  if (encrypted.mediaKind !== expectedKind || encrypted.mediaKind === "avatar" || objectId !== mediaId) {
    throw new Error("The downloaded media does not match the authenticated MLS attachment.");
  }
  return chitchatCore.decryptMediaFile(
    authenticatedContentJson,
    objectId,
    encodeBase64(encrypted.bytes),
    encrypted.sha256,
    encrypted.cryptoVersion,
    encrypted.mediaKind,
  );
}

/**
 * Encrypt a local avatar through the protected native Rust module and upload
 * only ciphertext. The Cloudflare Worker updates profiles.avatar_path only
 * after the encrypted R2 object and Supabase metadata row are stored.
 */
export async function encryptAndUploadAvatar(_uri: string): Promise<StoredMedia> {
  throw new Error("Account-level avatar encryption is not implemented. ChitChat will not upload a plaintext avatar.");
}

/** Retrieve and decrypt an authorized avatar into the app-private cache. */
export async function getDecryptedAvatarUri(_mediaId: string): Promise<string> {
  throw new Error("Account-level avatar decryption is not implemented.");
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
