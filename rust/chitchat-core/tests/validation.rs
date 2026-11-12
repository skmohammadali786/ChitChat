use chitchat_core::{
    CoreError, EncryptedEnvelope, MessageKind, ProfileDraft, validate_envelope, validate_profile,
};
use serde_json::json;
use uuid::Uuid;

#[test]
fn validates_profile_limits() {
    let draft = ProfileDraft {
        username: "chit_chat_01".into(),
        display_name: "Chit Chat".into(),
        bio: "A short profile".into(),
        discoverable: false,
    };
    assert_eq!(validate_profile(&draft), Ok(()));
}

#[test]
fn rejects_invalid_username_characters() {
    let draft = ProfileDraft {
        username: "ChitChat!".into(),
        display_name: "Chit Chat".into(),
        bio: String::new(),
        discoverable: false,
    };
    assert_eq!(validate_profile(&draft), Err(CoreError::InvalidUsername));
}

#[test]
fn rejects_display_name_too_short() {
    let draft = ProfileDraft {
        username: "valid_user".into(),
        display_name: "A".into(),
        bio: String::new(),
        discoverable: false,
    };
    assert_eq!(validate_profile(&draft), Err(CoreError::InvalidDisplayName));
}

#[test]
fn rejects_bio_over_limit() {
    let draft = ProfileDraft {
        username: "valid_user".into(),
        display_name: "Valid Name".into(),
        bio: "a".repeat(161),
        discoverable: false,
    };
    assert_eq!(validate_profile(&draft), Err(CoreError::BioTooLong));
}

#[test]
fn accepts_a_structurally_valid_envelope() {
    let envelope = EncryptedEnvelope {
        client_message_id: Uuid::new_v4(),
        message_kind: MessageKind::Text,
        ciphertext: "c29tZS1jaXBoZXJ0ZXh0".into(),
        nonce: "bm9uY2U".into(),
        crypto_header: json!({"protocol_version": 1}),
        key_version: 1,
    };
    assert_eq!(validate_envelope(&envelope), Ok(()));
}

#[test]
fn rejects_empty_ciphertext() {
    let envelope = EncryptedEnvelope {
        client_message_id: Uuid::new_v4(),
        message_kind: MessageKind::Text,
        ciphertext: String::new(),
        nonce: "bm9uY2U".into(),
        crypto_header: json!({}),
        key_version: 1,
    };
    assert_eq!(validate_envelope(&envelope), Err(CoreError::InvalidCiphertext));
}

#[test]
fn rejects_missing_nonce() {
    let envelope = EncryptedEnvelope {
        client_message_id: Uuid::new_v4(),
        message_kind: MessageKind::Text,
        ciphertext: "Y2lwaGVydGV4dA".into(),
        nonce: String::new(),
        crypto_header: json!({}),
        key_version: 1,
    };
    assert_eq!(validate_envelope(&envelope), Err(CoreError::InvalidNonce));
}

#[test]
fn rejects_zero_key_version() {
    let envelope = EncryptedEnvelope {
        client_message_id: Uuid::new_v4(),
        message_kind: MessageKind::Text,
        ciphertext: "Y2lwaGVydGV4dA".into(),
        nonce: "bm9uY2U".into(),
        crypto_header: json!({}),
        key_version: 0,
    };
    assert_eq!(validate_envelope(&envelope), Err(CoreError::InvalidKeyVersion));
}

#[test]
fn rejects_non_object_crypto_header() {
    let envelope = EncryptedEnvelope {
        client_message_id: Uuid::new_v4(),
        message_kind: MessageKind::Text,
        ciphertext: "Y2lwaGVydGV4dA".into(),
        nonce: "bm9uY2U".into(),
        crypto_header: json!([]),
        key_version: 1,
    };
    assert_eq!(validate_envelope(&envelope), Err(CoreError::InvalidCryptoHeader));
}

#[test]
fn validates_unicode_emoji_and_concealed_text_content() {
    use chitchat_core::{MessageBlock, MessageContent, validate_message_content};
    let content = MessageContent {
        version: 1,
        blocks: vec![
            MessageBlock::Text {
                text: "Hello 👋 🌍".into(),
                concealed: false,
            },
            MessageBlock::Text {
                text: "This is secret 🔐".into(),
                concealed: true,
            },
        ],
    };
    assert_eq!(validate_message_content(&content), Ok(()));
}

#[test]
fn validates_encrypted_media_reference() {
    use chitchat_core::{MediaKind, MessageBlock, MessageContent, validate_message_content};
    let content = MessageContent {
        version: 1,
        blocks: vec![MessageBlock::Media {
            object_id: Uuid::new_v4(),
            media_kind: MediaKind::Image,
            file_key: "A".repeat(43),
            crypto_version: 1,
            sha256: "a".repeat(64),
            size_bytes: 1024,
            concealed: true,
        }],
    };
    assert_eq!(validate_message_content(&content), Ok(()));
}

#[test]
fn rejects_invalid_media_file_key() {
    use chitchat_core::{MediaKind, MessageBlock, MessageContent, validate_message_content};
    let content = MessageContent {
        version: 1,
        blocks: vec![MessageBlock::Media {
            object_id: Uuid::new_v4(),
            media_kind: MediaKind::File,
            file_key: "not-a-valid-key".into(),
            crypto_version: 1,
            sha256: "a".repeat(64),
            size_bytes: 1024,
            concealed: false,
        }],
    };
    assert_eq!(validate_message_content(&content), Err(CoreError::InvalidMediaAttachment));
}

#[test]
fn rejects_empty_message_content() {
    use chitchat_core::{MessageContent, validate_message_content};
    let content = MessageContent { version: 1, blocks: vec![] };
    assert_eq!(validate_message_content(&content), Err(CoreError::InvalidMessageContent));
}
