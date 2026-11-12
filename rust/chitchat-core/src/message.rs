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
