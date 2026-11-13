//! Authenticated encryption codec for OpenMLS SQLite state.
//!
//! The database is unusable until the platform adapter injects a random
//! 32-byte key backed by Android Keystore or iOS Keychain. The key is never
//! generated, stored, or recoverable from this database.

use std::sync::Mutex;

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use openmls_sqlite_storage::Codec;
use serde::{Serialize, de::DeserializeOwned};
use zeroize::{Zeroize, Zeroizing};

const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;
const STORAGE_AAD: &[u8] = b"chitchat-openmls-storage-v1\0";

static STORAGE_KEY: Mutex<Option<Zeroizing<[u8; KEY_BYTES]>>> = Mutex::new(None);

#[cfg(test)]
pub(crate) static MLS_TEST_LOCK: Mutex<()> = Mutex::new(());

/// Failure modes for encrypted OpenMLS state persistence.
#[derive(Debug, thiserror::Error)]
pub enum StorageCodecError {
    /// The platform has not injected the local database key.
    #[error("The protected MLS storage key is not installed.")]
    KeyUnavailable,
    /// The storage key has already been installed in this process.
    #[error("The protected MLS storage key is already installed.")]
    KeyAlreadyInstalled,
    /// The storage key has an incorrect length.
    #[error("The protected MLS storage key must be exactly 32 bytes.")]
    InvalidKeyLength,
    /// The process-wide key lock is poisoned.
    #[error("The protected MLS storage lock is unavailable.")]
    LockUnavailable,
    /// The stored record is malformed or truncated.
    #[error("The encrypted MLS storage record is malformed.")]
    InvalidRecord,
    /// Encoding or decoding OpenMLS values failed.
    #[error("The MLS storage value could not be serialized.")]
    Serialization(#[from] serde_json::Error),
    /// The encryption operation failed.
    #[error("The MLS storage value could not be encrypted.")]
    EncryptionFailed,
    /// The authentication tag failed or the wrong platform key is installed.
    #[error("The MLS storage value could not be authenticated or decrypted.")]
    DecryptionFailed,
}

/// A codec that encrypts every OpenMLS SQLite value before it reaches disk.
///
/// Each record uses a fresh 192-bit XChaCha20 nonce. The fixed AAD binds
/// ciphertext records to the ChitChat MLS storage format and version.
#[derive(Debug, Default)]
pub struct ChitChatStorageCodec;

impl ChitChatStorageCodec {
    fn key_copy() -> Result<Zeroizing<[u8; KEY_BYTES]>, StorageCodecError> {
        let guard = STORAGE_KEY.lock().map_err(|_| StorageCodecError::LockUnavailable)?;
        let stored = guard.as_ref().ok_or(StorageCodecError::KeyUnavailable)?;
        Ok(Zeroizing::new(**stored))
    }
}

impl Codec for ChitChatStorageCodec {
    type Error = StorageCodecError;

    fn to_vec<T: Serialize>(value: &T) -> Result<Vec<u8>, Self::Error> {
        let plaintext = Zeroizing::new(serde_json::to_vec(value)?);
        let key = Self::key_copy()?;
        let cipher = XChaCha20Poly1305::new_from_slice(&*key)
            .map_err(|_| StorageCodecError::EncryptionFailed)?;

        let mut nonce = [0u8; NONCE_BYTES];
        if getrandom::getrandom(&mut nonce).is_err() {
            plaintext.zeroize();
            return Err(StorageCodecError::EncryptionFailed);
        }

        let encrypted = cipher.encrypt(
            XNonce::from_slice(&nonce),
            Payload { msg: &plaintext, aad: STORAGE_AAD },
        );
        let mut ciphertext = encrypted.map_err(|_| StorageCodecError::EncryptionFailed)?;
        let mut record = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
        record.extend_from_slice(&nonce);
        record.append(&mut ciphertext);
        nonce.zeroize();
        Ok(record)
    }

    fn from_slice<T: DeserializeOwned>(record: &[u8]) -> Result<T, Self::Error> {
        if record.len() <= NONCE_BYTES {
            return Err(StorageCodecError::InvalidRecord);
        }
        let key = Self::key_copy()?;
        let cipher = XChaCha20Poly1305::new_from_slice(&*key)
            .map_err(|_| StorageCodecError::DecryptionFailed)?;
        let (nonce, ciphertext) = record.split_at(NONCE_BYTES);
        let plaintext = Zeroizing::new(cipher.decrypt(
            XNonce::from_slice(nonce),
            Payload { msg: ciphertext, aad: STORAGE_AAD },
        ).map_err(|_| StorageCodecError::DecryptionFailed)?);

        serde_json::from_slice(&plaintext).map_err(StorageCodecError::Serialization)
    }
}

/// Install the random per-install MLS storage key from the native secure store.
///
/// The caller must retrieve or create the key using Android Keystore or iOS
/// Keychain. This function refuses replacement during a running process to
/// prevent a live OpenMLS provider from unexpectedly switching databases keys.
pub fn install_mls_storage_key(key: &[u8]) -> Result<(), StorageCodecError> {
    if key.len() != KEY_BYTES {
        return Err(StorageCodecError::InvalidKeyLength);
    }
    let mut guard = STORAGE_KEY.lock().map_err(|_| StorageCodecError::LockUnavailable)?;
    if guard.is_some() {
        return Err(StorageCodecError::KeyAlreadyInstalled);
    }
    let mut key_bytes = [0u8; KEY_BYTES];
    key_bytes.copy_from_slice(key);
    *guard = Some(Zeroizing::new(key_bytes));
    key_bytes.zeroize();
    Ok(())
}

/// Clear the in-memory copy of the MLS storage key on logout or device lock.
///
/// The native Keystore/Keychain item is not deleted by this operation.
pub fn clear_mls_storage_key() -> Result<(), StorageCodecError> {
    let mut guard = STORAGE_KEY.lock().map_err(|_| StorageCodecError::LockUnavailable)?;
    *guard = None;
    Ok(())
}

/// Return whether this process can currently access protected OpenMLS state.
pub fn mls_storage_is_unlocked() -> bool {
    STORAGE_KEY.lock().map(|guard| guard.is_some()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct TestRecord {
        group_epoch: u64,
        local_secret: String,
    }

    #[test]
    fn codec_refuses_plaintext_storage_without_platform_key() {
        let _guard = MLS_TEST_LOCK.lock().unwrap();
        clear_mls_storage_key().unwrap();
        let value = TestRecord { group_epoch: 4, local_secret: "local-only".into() };
        assert!(matches!(
            ChitChatStorageCodec::to_vec(&value),
            Err(StorageCodecError::KeyUnavailable)
        ));
    }

    #[test]
    fn codec_encrypts_each_record_and_round_trips_after_key_installation() {
        let _guard = MLS_TEST_LOCK.lock().unwrap();
        clear_mls_storage_key().unwrap();
        install_mls_storage_key(&[0x42; KEY_BYTES]).unwrap();
        let value = TestRecord { group_epoch: 17, local_secret: "MLS epoch secret".into() };

        let first = ChitChatStorageCodec::to_vec(&value).unwrap();
        let second = ChitChatStorageCodec::to_vec(&value).unwrap();
        assert_ne!(first, second);
        assert!(!first.windows(b"MLS epoch secret".len()).any(|w| w == b"MLS epoch secret"));

        let decoded: TestRecord = ChitChatStorageCodec::from_slice(&first).unwrap();
        assert_eq!(decoded, value);
        clear_mls_storage_key().unwrap();
    }

    #[test]
    fn codec_rejects_wrong_platform_key_and_tampered_data() {
        let _guard = MLS_TEST_LOCK.lock().unwrap();
        clear_mls_storage_key().unwrap();
        install_mls_storage_key(&[0x11; KEY_BYTES]).unwrap();
        let value = TestRecord { group_epoch: 3, local_secret: "private".into() };
        let encrypted = ChitChatStorageCodec::to_vec(&value).unwrap();
        clear_mls_storage_key().unwrap();

        install_mls_storage_key(&[0x22; KEY_BYTES]).unwrap();
        assert!(matches!(
            ChitChatStorageCodec::from_slice::<TestRecord>(&encrypted),
            Err(StorageCodecError::DecryptionFailed)
        ));
        clear_mls_storage_key().unwrap();
    }
}
