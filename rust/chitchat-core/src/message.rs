use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Text,
    Image,
    Video,
    Audio,
    File,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EncryptedEnvelope {
    pub client_message_id: Uuid,
    pub message_kind: MessageKind,
    pub ciphertext: String,
    pub nonce: String,
    pub crypto_header: serde_json::Value,
    pub key_version: u32,
}

/// Validate an already encrypted envelope. This is structural validation only.
/// It is not proof of encryption and must not replace a reviewed crypto layer.
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
