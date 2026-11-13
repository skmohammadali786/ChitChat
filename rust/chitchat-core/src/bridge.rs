//! UniFFI surface shared by the Android and iOS native modules.
//!
//! The OS secure-storage adapter passes the 32-byte per-user database key into
//! this constructor. Rust keeps the key in zeroizing process memory and uses
//! the authenticated encrypted SQLite codec for all OpenMLS state.

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use openmls_sqlite_storage::Codec;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;
use zeroize::Zeroize;

use crate::{
    clear_mls_storage_key,
    decrypt_media,
    device_identity::{
        generate_device_identity, restore_device_identity, verify_device_bundle,
        DeviceIdentity, DevicePublicBundle,
    },
    encrypt_media,
    install_mls_storage_key,
    mls_storage::ChitChatStorageCodec,
    validate_envelope,
    validate_message_content,
    validate_profile,
    CoreError,
    EncryptedEnvelope,
    MediaKind,
    MessageBlock,
    MessageContent,
    MlsRuntime,
    ProfileDraft,
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
    device_identity: Mutex<Option<DeviceIdentity>>,
    device_identity_path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProtectedDeviceIdentityRecord {
    user_id: Uuid,
    device_id: Uuid,
    private_material: Vec<u8>,
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
        let install_result = install_mls_storage_key(&storage_key);
        storage_key.zeroize();
        install_result.map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;

        let runtime = match MlsRuntime::open(&database_path) {
            Ok(runtime) => runtime,
            Err(error) => {
                let _ = clear_mls_storage_key();
                return Err(ChitChatBridgeError::from_core(error));
            }
        };
        let device_identity_path = PathBuf::from(format!("{database_path}.device-identity.v1"));
        let device_identity = match load_device_identity(&device_identity_path) {
            Ok(identity) => identity,
            Err(error) => {
                let _ = clear_mls_storage_key();
                return Err(error);
            }
        };

        Ok(Arc::new(Self {
            runtime: Mutex::new(runtime),
            device_identity: Mutex::new(device_identity),
            device_identity_path,
        }))
    }

    /// Whether the protected OpenMLS runtime is currently unlocked.
    pub fn is_ready(&self) -> bool {
        crate::mls_storage_is_unlocked() && self.runtime.lock().is_ok()
    }

    /// Clear the in-memory database key. The native module should drop this
    /// object after calling lock, then reopen it after secure-store access.
    pub fn lock(&self) -> Result<(), ChitChatBridgeError> {
        let mut identity = self.device_identity.lock()
            .map_err(|_| ChitChatBridgeError::from_message("Device identity lock is unavailable."))?;
        *identity = None;
        clear_mls_storage_key()
            .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))
    }

    /// Create or reload the device's long-term Ed25519 identity and signed
    /// X25519 prekey. Private seeds are encrypted at rest with the same
    /// Android Keystore/iOS Keychain-wrapped database key as OpenMLS state.
    pub fn create_device_identity(
        &self,
        user_id: String,
        device_id: String,
    ) -> Result<String, ChitChatBridgeError> {
        let user_id = Uuid::parse_str(&user_id)
            .map_err(|_| ChitChatBridgeError::from_message("The account ID is invalid."))?;
        let device_id = Uuid::parse_str(&device_id)
            .map_err(|_| ChitChatBridgeError::from_message("The device ID is invalid."))?;

        let mut slot = self.device_identity.lock()
            .map_err(|_| ChitChatBridgeError::from_message("Device identity lock is unavailable."))?;
        if slot.as_ref().is_none_or(|identity| {
            let bundle = identity.public_bundle();
            bundle.user_id != user_id || bundle.device_id != device_id
        }) {
            let identity = generate_device_identity(user_id, device_id)
                .map_err(ChitChatBridgeError::from_core)?;
            persist_device_identity(&self.device_identity_path, user_id, device_id, &identity)?;
            *slot = Some(identity);
        }
        let identity = slot.as_ref()
            .ok_or_else(|| ChitChatBridgeError::from_message("Device identity is unavailable."))?;
        serde_json::to_string(&identity.public_bundle())
            .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))
    }

    /// Verify a device identity bundle and calculate its ten-digit fingerprint.
    pub fn verify_device_bundle(&self, payload: String) -> Result<String, ChitChatBridgeError> {
        let bundle: DevicePublicBundle = serde_json::from_str(&payload)
            .map_err(|_| ChitChatBridgeError::from_message("Device bundle payload is invalid."))?;
        let verified = verify_device_bundle(&bundle)
            .map_err(ChitChatBridgeError::from_core)?;
        serde_json::to_string(&verified)
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

fn persist_device_identity(
    path: &PathBuf,
    user_id: Uuid,
    device_id: Uuid,
    identity: &DeviceIdentity,
) -> Result<(), ChitChatBridgeError> {
    let mut material = identity.private_material();
    let mut record = ProtectedDeviceIdentityRecord {
        user_id,
        device_id,
        private_material: material.to_vec(),
    };
    material.zeroize();

    let encrypted = ChitChatStorageCodec::to_vec(&record)
        .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
    record.private_material.zeroize();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, encrypted)
        .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
    fs::rename(&temporary, path)
        .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
    Ok(())
}

fn load_device_identity(
    path: &PathBuf,
) -> Result<Option<DeviceIdentity>, ChitChatBridgeError> {
    if !path.exists() {
        return Ok(None);
    }
    let mut encrypted = fs::read(path)
        .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
    let mut record: ProtectedDeviceIdentityRecord = ChitChatStorageCodec::from_slice(&encrypted)
        .map_err(|error| ChitChatBridgeError::from_message(error.to_string()))?;
    encrypted.zeroize();

    let identity = restore_device_identity(
        record.user_id,
        record.device_id,
        &record.private_material,
    ).map_err(ChitChatBridgeError::from_core);
    record.private_material.zeroize();
    identity.map(Some)
}

#[uniffi::export]
pub fn validate_profile_json(payload: String) -> Result<(), ChitChatBridgeError> {
    let profile: ProfileDraft = serde_json::from_str(&payload)
        .map_err(|_| ChitChatBridgeError::from_message("Profile payload is invalid."))?;
    validate_profile(&profile).map_err(ChitChatBridgeError::from_core)
}

#[uniffi::export]
pub fn validate_envelope_json(payload: String) -> Result<(), ChitChatBridgeError> {
    let envelope: EncryptedEnvelope = serde_json::from_str(&payload)
        .map_err(|_| ChitChatBridgeError::from_message("Encrypted envelope payload is invalid."))?;
    validate_envelope(&envelope).map_err(ChitChatBridgeError::from_core)
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
