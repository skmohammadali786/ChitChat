use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CoreError, CoreResult};

/// Supported message payload kinds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    /// UTF-8 text encrypted by the selected protocol.
    Text,
    /// Encrypted image attachment.
    Image,
    /// Encrypted video attachment.
    Video,
    /// Encrypted audio attachment.
    Audio,
    /// Encrypted file attachment.
    File,
    /// Protocol-level or conversation system event.
    System,
}

/// Data persisted by the backend after encryption has completed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EncryptedEnvelope {
    /// Client-generated idempotency identifier.
    pub client_message_id: Uuid,
    /// Payload kind.
    pub message_kind: MessageKind,
    /// Base64 or base64url ciphertext, not plaintext.
    pub ciphertext: String,
    /// Protocol nonce or message counter encoding.
    pub nonce: String,
    /// Public protocol metadata. Never put private keys here.
    pub crypto_header: serde_json::Value,
    /// Version of the sender's active protocol key bundle.
    pub key_version: u32,
}

/// Validate the structure of an already encrypted message envelope.
///
/// This validates shape and size only. It does not encrypt, authenticate,
/// decrypt, or establish an end-to-end secure session.
pub fn validate_envelope(envelope: &EncryptedEnvelope) -> CoreResult<()> {
    if envelope.ciphertext.is_empty() || envelope.ciphertext.len() > 1_000_000 {
        return Err(CoreError::InvalidCiphertext);
    }
    if envelope.nonce.is_empty() || envelope.nonce.len() > 256 {
        return Err(CoreError::InvalidNonce);
    }
    if envelope.key_version == 0 {
        return Err(CoreError::InvalidKeyVersion);
    }
    if !envelope.crypto_header.is_object() {
        return Err(CoreError::InvalidCryptoHeader);
    }
    Ok(())
}

/// Plaintext application content before it is encrypted by the MLS layer.
///
/// This type must never be sent directly to Supabase or Cloudflare. The whole
/// serialized value is passed to the MLS application-message encryption API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageContent {
    /// Version of this application payload schema.
    pub version: u32,
    /// Ordered text and media blocks. Unicode text, including emoji, is preserved.
    pub blocks: Vec<MessageBlock>,
}

/// One ordered content block inside a ChitChat message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageBlock {
    /// A UTF-8 text block.
    Text {
        /// Original text, including any emoji.
        text: String,
        /// If true, the recipient's UI initially conceals this block.
        concealed: bool,
    },
    /// A reference to separately encrypted media in private Cloudflare R2.
    Media {
        /// Supabase metadata identifier for the encrypted R2 object.
        object_id: Uuid,
        /// Media category.
        media_kind: MediaKind,
        /// Random 32-byte media key encoded as unpadded base64url.
        ///
        /// This value is plaintext only inside MessageContent. MLS encryption
        /// protects it while the content travels through Supabase.
        file_key: String,
        /// Version of the Rust media encryption format.
        crypto_version: u32,
        /// Lowercase SHA-256 digest of the encrypted media bytes.
        sha256: String,
        /// Encrypted object size in bytes.
        size_bytes: u64,
        /// If true, the recipient's UI initially conceals this attachment.
        concealed: bool,
    },
}

/// Supported encrypted media categories.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    /// Image or animated image.
    Image,
    /// Video.
    Video,
    /// Audio or voice note.
    Audio,
    /// Generic file.
    File,
}

/// Validate application content before passing it to MLS encryption.
///
/// This validates the payload schema only. It does not encrypt the content,
/// validate a media key cryptographically, or verify the referenced R2 object.
pub fn validate_message_content(content: &MessageContent) -> CoreResult<()> {
    const MAX_BLOCKS: usize = 100;
    const MAX_TEXT_BYTES: usize = 64 * 1024;
    const MAX_MEDIA_BYTES: u64 = 50 * 1024 * 1024;

    if content.version != 1 || content.blocks.is_empty() || content.blocks.len() > MAX_BLOCKS {
        return Err(CoreError::InvalidMessageContent);
    }

    for block in &content.blocks {
        match block {
            MessageBlock::Text { text, .. } => {
                if text.is_empty() || text.len() > MAX_TEXT_BYTES || text.contains('\0') {
                    return Err(CoreError::InvalidMessageContent);
                }
            }
            MessageBlock::Media {
                file_key,
                crypto_version,
                sha256,
                size_bytes,
                ..
            } => {
                let valid_key = file_key.len() == 43
                    && file_key
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
                let valid_digest = sha256.len() == 64
                    && sha256.bytes().all(|byte| byte.is_ascii_hexdigit());
                if !valid_key
                    || *crypto_version == 0
                    || !valid_digest
                    || *size_bytes == 0
                    || *size_bytes > MAX_MEDIA_BYTES
                {
                    return Err(CoreError::InvalidMediaAttachment);
                }
            }
        }
    }
    Ok(())
}
