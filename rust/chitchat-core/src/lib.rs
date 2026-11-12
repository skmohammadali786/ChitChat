//! ChitChat shared Rust domain core.
//!
//! This crate contains platform-independent validation and message-envelope
//! rules. It deliberately does not invent an encryption protocol. Production
//! message encryption must be supplied by a separately reviewed implementation
//! before the UI enables sending.

mod message;
mod profile;
mod result;

pub use message::{EncryptedEnvelope, MessageKind, validate_envelope};
pub use profile::{ProfileDraft, validate_profile};
pub use result::{CoreError, CoreResult};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_profile() {
        let draft = ProfileDraft {
            username: "mohammad_01".into(),
            display_name: "Mohammad".into(),
            bio: "Hello".into(),
            discoverable: true,
        };
        assert!(validate_profile(&draft).is_ok());
    }

    #[test]
    fn rejects_uppercase_username() {
        let draft = ProfileDraft {
            username: "InvalidName".into(),
            display_name: "Name".into(),
            bio: String::new(),
            discoverable: false,
        };
        assert!(validate_profile(&draft).is_err());
    }

    #[test]
    fn rejects_plain_or_empty_ciphertext_envelope() {
        let envelope = EncryptedEnvelope {
            client_message_id: uuid::Uuid::new_v4(),
            message_kind: MessageKind::Text,
            ciphertext: String::new(),
            nonce: "nonce".into(),
            crypto_header: serde_json::json!({}),
            key_version: 1,
        };
        assert!(validate_envelope(&envelope).is_err());
    }
}
