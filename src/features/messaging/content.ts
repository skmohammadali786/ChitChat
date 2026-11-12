/**
 * Plaintext message content passed to the Rust MLS layer.
 *
 * Never send this object directly to Supabase or Cloudflare. The complete
 * serialized payload must be encrypted by the Rust native module first.
 */
export const MESSAGE_CONTENT_VERSION = 1 as const;

export type MessageContentBlock =
  | {
      type: "text";
      text: string;
      concealed: boolean;
    }
  | {
      type: "media";
      object_id: string;
      media_kind: "image" | "video" | "audio" | "file";
      file_key: string;
      crypto_version: number;
      sha256: string;
      size_bytes: number;
      concealed: boolean;
    };

export type MessageContent = {
  version: typeof MESSAGE_CONTENT_VERSION;
  blocks: MessageContentBlock[];
};

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function createTextMessageContent(
  text: string,
  concealed = false,
): MessageContent {
  const value = text.trim();
  if (!value) throw new Error("Message text cannot be empty.");
  if (utf8ByteLength(value) > 64 * 1024) {
    throw new Error("Message text exceeds the 64 KB content limit.");
  }
  return {
    version: MESSAGE_CONTENT_VERSION,
    blocks: [{ type: "text", text: value, concealed }],
  };
}

export function validateMessageContentShape(content: MessageContent): void {
  if (content.version !== MESSAGE_CONTENT_VERSION || !Array.isArray(content.blocks) ||
      content.blocks.length < 1 || content.blocks.length > 100) {
    throw new Error("Message content has an unsupported version or block count.");
  }

  let totalTextBytes = 0;
  for (const block of content.blocks) {
    if (block.type === "text") {
      totalTextBytes += utf8ByteLength(block.text);
      if (!block.text || block.text.includes("\0") ||
          utf8ByteLength(block.text) > 64 * 1024 || totalTextBytes > 512 * 1024) {
        throw new Error("A text block is empty or exceeds the content limit.");
      }
      continue;
    }

    if (block.type !== "media" ||
        !/^[0-9a-f-]{36}$/i.test(block.object_id) ||
        !/^[A-Za-z0-9_-]{43}$/.test(block.file_key) ||
        !Number.isInteger(block.crypto_version) || block.crypto_version < 1 ||
        !/^[a-f0-9]{64}$/.test(block.sha256) ||
        !Number.isInteger(block.size_bytes) || block.size_bytes < 1 ||
        block.size_bytes > 50 * 1024 * 1024) {
      throw new Error("Encrypted media metadata is invalid.");
    }
  }
}
