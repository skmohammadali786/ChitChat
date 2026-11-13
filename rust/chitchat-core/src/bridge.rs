//! UniFFI surface shared by the Android and iOS native modules.
//!
//! The OS secure-storage adapter passes the 32-byte per-user database key into
//! this constructor. Rust keeps the key in zeroizing process memory and uses
//! the authenticated encrypted SQLite codec for all OpenMLS state.

use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::json;
use uuid::Uuid;
use zeroize::Zeroize;

use crate::{
    clear_mls_storage_key, decrypt_media, encrypt_media, install_mls_storage_key,
    validate_message_content, CoreError, MediaKind, MessageBlock, MessageContent, MlsRuntime,
};

/// Errors returned across the Android/iOS foreign-language boundary.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum ChitChatBridgeError {
    /// A validated core operation could not be completed.
    #[error("{message}")]
    Operation { message: String },
}

impl ChitChatBridgeError {
    fn from_message(message: impl Into<String>) -> Self {
        Self::Operation { message: message.into() }
    }

    fn from_core(error: CoreError) -> Self {
        Self::from_message(error.to_string())
    }
}

/// A device-local MLS runtime. All methods serialize access to its SQLite
/// provider so Android and iOS callers cannot race the same connection.
#[derive(uniffi::Object)]
pub struct ChitChatMlsBridge {
    runtime: Mutex<MlsRuntime>,
}

#[uniffi::export]
impl ChitChatMlsBridge {
    /// Open the per-user protected database using a 32-byte key supplied by
    /// Android Keystore or iOS Keychain.
    #[uniffi::constructor]
    pub fn open(database_path: String, mut storage_key: Vec<u8>) -> Result<Arc<Self>, ChitChatBridgeError> {
        if storage_key.len() != 32 {
            storage_key.zeroize();
            return Err(ChitChatBridgeError::from_message(
                "Protected MLS storage key must contain exactly 32 bytes.",
            ));
        }

        clear_mls_storage_key()
            .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
        install_mls_storage_key(&storage_key)
            .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
        storage_key.zeroize();

        let runtime = MlsRuntime::open(&database_path).map_err(ChitChatBridgeError::from_core)?;
        Ok(Arc::new(Self { runtime: Mutex::new(runtime) }))
    }

    /// Whether the protected OpenMLS runtime is currently unlocked.
    pub fn is_ready(&self) -> bool {
        crate::mls_storage_is_unlocked() && self.runtime.lock().is_ok()
    }

    /// Clear the in-memory database key. The native module should drop this
    /// object after calling lock, then reopen it after secure-store access.
    pub fn lock(&self) -> Result<(), ChitChatBridgeError> {
        clear_mls_storage_key()
            .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))
    }

    /// Generate a public KeyPackage for this account/device identity.
    /// Private KeyPackage material remains in the encrypted local database.
    pub fn generate_key_package(&self, identity: String) -> Result<String, ChitChatBridgeError> {
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        let package = runtime.generate_key_package(identity.as_bytes()).map_err(ChitChatBridgeError::from_core)?;
        Ok(URL_SAFE_NO_PAD.encode(package.wire_bytes))
    }

    /// Create a new MLS group and return its base64url group identifier.
    pub fn create_group(&self, identity: String) -> Result<String, ChitChatBridgeError> {
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        runtime.create_group(identity.as_bytes()).map_err(ChitChatBridgeError::from_core)
    }

    /// Add a device using its public KeyPackage. Returns the Commit, Welcome
    /// and epoch as base64/JSON. The caller must check group-admin policy first.
    pub fn add_member(&self, group_id: String, key_package_base64: String) -> Result<String, ChitChatBridgeError> {
        let bytes = decode_base64(&key_package_base64)?;
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        let result = runtime.add_member(&group_id, &bytes).map_err(ChitChatBridgeError::from_core)?;
        serde_json::to_string(&json!({
            "commit_base64": URL_SAFE_NO_PAD.encode(result.commit),
            "welcome_base64": URL_SAFE_NO_PAD.encode(result.welcome),
            "epoch": result.epoch
        })).map_err(|error| ChitChatBridgeError::from_message(error.to_string()))
    }

    /// Join an MLS group from a Welcome addressed to this device.
    pub fn join_group(&self, welcome_base64: String) -> Result<String, ChitChatBridgeError> {
        let bytes = decode_base64(&welcome_base64)?;
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        runtime.join_group(&bytes).map_err(ChitChatBridgeError::from_core)
    }

    /// Encrypt a validated ChitChat content JSON payload as an MLS application
    /// message. The caller stores only the returned opaque wire bytes.
    pub fn encrypt_content(&self, group_id: String, content_json: String) -> Result<String, ChitChatBridgeError> {
        let content: MessageContent = serde_json::from_str(&content_json)
            .map_err(|_| ChitChatBridgeError::from_core(CoreError::InvalidMessageContent))?;
        validate_message_content(&content).map_err(ChitChatBridgeError::from_core)?;
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        let bytes = runtime.encrypt_content(&group_id, &content).map_err(ChitChatBridgeError::from_core)?;
        Ok(URL_SAFE_NO_PAD.encode(bytes))
    }

    /// Authenticate and decrypt an incoming MLS wire message. Application
    /// content is returned as JSON; callers must not render it before success.
    /// allow_control_messages must only be true after a server-authorized
    /// group-role and membership-change check.
    pub fn process_message(
        &self,
        group_id: String,
        wire_base64: String,
        allow_control_messages: bool,
    ) -> Result<String, ChitChatBridgeError> {
        let bytes = decode_base64(&wire_base64)?;
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        let processed = runtime.process_incoming(&group_id, &bytes, allow_control_messages)
            .map_err(ChitChatBridgeError::from_core)?;
        let content_json = match processed.plaintext {
            Some(plaintext) => {
                let content = MlsRuntime::decode_application_content(&plaintext)
                    .map_err(ChitChatBridgeError::from_core)?;
                Some(serde_json::to_value(content)
                    .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?)
            }
            None => None,
        };
        serde_json::to_string(&json!({
            "kind": processed.kind,
            "epoch": processed.epoch,
            "content": content_json
        })).map_err(|error| ChitChatBridgeError::from_message(error.to_string()))
    }

    /// Read the current local MLS epoch for a conversation.
    pub fn current_epoch(&self, group_id: String) -> Result<u64, ChitChatBridgeError> {
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        runtime.current_epoch(&group_id).map_err(ChitChatBridgeError::from_core)
    }

    /// Rotate this device's MLS leaf and return the Commit for distribution.
    pub fn rotate_own_leaf(&self, group_id: String) -> Result<String, ChitChatBridgeError> {
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        let commit = runtime.rotate_own_leaf(&group_id).map_err(ChitChatBridgeError::from_core)?;
        Ok(URL_SAFE_NO_PAD.encode(commit))
    }

    /// Encrypt media with a fresh XChaCha20-Poly1305 key. The file key remains
    /// inside Rust and is included only in the MLS-encrypted content payload.
    /// The returned key_envelope is an opaque MLS ciphertext, not the file key.
    pub fn encrypt_media_and_wrap(
        &self,
        group_id: String,
        object_id: String,
        plaintext: Vec<u8>,
        media_kind: String,
        concealed: bool,
    ) -> Result<String, ChitChatBridgeError> {
        let object_id = Uuid::parse_str(&object_id)
            .map_err(|_| ChitChatBridgeError::from_message("Media object ID is invalid."))?;
        let kind = parse_media_kind(&media_kind)?;
        let encrypted = encrypt_media(&plaintext, kind).map_err(ChitChatBridgeError::from_core)?;
        let content = MessageContent {
            version: 1,
            blocks: vec![MessageBlock::Media {
                object_id,
                media_kind: kind,
                file_key: encrypted.file_key,
                nonce: encrypted.nonce,
                crypto_version: encrypted.crypto_version,
                sha256: encrypted.sha256.clone(),
                size_bytes: encrypted.ciphertext.len() as u64,
                concealed,
            }],
        };
        validate_message_content(&content).map_err(ChitChatBridgeError::from_core)?;
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        let key_envelope = runtime.encrypt_content(&group_id, &content)
            .map_err(ChitChatBridgeError::from_core)?;

        serde_json::to_string(&json!({
            "ciphertext_base64": URL_SAFE_NO_PAD.encode(encrypted.ciphertext),
            "key_envelope": URL_SAFE_NO_PAD.encode(&key_envelope),
            "content_message_base64": URL_SAFE_NO_PAD.encode(key_envelope),
            "sha256": encrypted.sha256,
            "crypto_version": encrypted.crypto_version,
            "media_kind": media_kind,
            "object_id": object_id.to_string()
        })).map_err(|error| ChitChatBridgeError::from_message(error.to_string()))
    }

    /// Decrypt media using its key carried inside a previously authenticated
    /// MLS content object. The key and nonce never cross the native boundary.
    pub fn decrypt_media_from_content(
        &self,
        content_json: String,
        object_id: String,
        ciphertext_base64: String,
        expected_sha256: String,
        crypto_version: u32,
        media_kind: String,
    ) -> Result<String, ChitChatBridgeError> {
        let object_id = Uuid::parse_str(&object_id)
            .map_err(|_| ChitChatBridgeError::from_message("Media object ID is invalid."))?;
        let content: MessageContent = serde_json::from_str(&content_json)
            .map_err(|_| ChitChatBridgeError::from_core(CoreError::InvalidMessageContent))?;
        validate_message_content(&content).map_err(ChitChatBridgeError::from_core)?;
        let Some(MessageBlock::Media { file_key, nonce, .. }) = content.blocks.iter().find(|block| {
            matches!(block, MessageBlock::Media { object_id: id, .. } if *id == object_id)
        }) else {
            return Err(ChitChatBridgeError::from_message("The media key is not present in this authenticated message."));
        };
        let ciphertext = decode_base64(&ciphertext_base64)?;
        let kind = parse_media_kind(&media_kind)?;
        let plaintext = decrypt_media(
            &ciphertext,
            file_key,
            nonce,
            &expected_sha256,
            crypto_version,
            kind,
        ).map_err(ChitChatBridgeError::from_core)?;
        Ok(URL_SAFE_NO_PAD.encode(plaintext))
    }

    /// Remove an MLS member. The native caller must map the authenticated
    /// account/device roster to the leaf index and check admin authorization.
    pub fn remove_member(&self, group_id: String, leaf_index: u32) -> Result<String, ChitChatBridgeError> {
        let runtime = self.runtime.lock().map_err(|_| ChitChatBridgeError::from_message("MLS runtime lock is unavailable."))?;
        let result = runtime.remove_member(&group_id, leaf_index).map_err(ChitChatBridgeError::from_core)?;
        serde_json::to_string(&json!({
            "commit_base64": URL_SAFE_NO_PAD.encode(result.commit),
            "epoch": result.epoch
        })).map_err(|error| ChitChatBridgeError::from_message(error.to_string()))
    }
}

impl Drop for ChitChatMlsBridge {
    fn drop(&mut self) {
        let _ = clear_mls_storage_key();
    }
}

fn decode_base64(value: &str) -> Result<Vec<u8>, ChitChatBridgeError> {
    if value.is_empty() || value.len() > 80 * 1024 * 1024 {
        return Err(ChitChatBridgeError::from_message("Encoded MLS or media payload is empty or too large."));
    }
    URL_SAFE_NO_PAD.decode(value)
        .map_err(|_| ChitChatBridgeError::from_message("Encoded payload is not valid base64url."))
}

fn parse_media_kind(value: &str) -> Result<MediaKind, ChitChatBridgeError> {
    match value {
        "image" => Ok(MediaKind::Image),
        "video" => Ok(MediaKind::Video),
        "audio" => Ok(MediaKind::Audio),
        "file" => Ok(MediaKind::File),
        _ => Err(ChitChatBridgeError::from_message("Unsupported media kind.")),
    }
}
