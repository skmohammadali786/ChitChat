use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::{CoreError, CoreResult, MediaKind};

const MEDIA_CRYPTO_VERSION: u32 = 1;
const MAX_MEDIA_BYTES: usize = 50 * 1024 * 1024;
const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;

/// Ciphertext produced by the Rust media encryption layer.
///
/// The file key and nonce are protocol metadata. The file key must only be
/// placed inside an MLS-encrypted application message. Never persist it in
/// Supabase media metadata or send it to Cloudflare.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedMedia {
    /// Authenticated ciphertext bytes. Upload these bytes to private R2.
    pub ciphertext: Vec<u8>,
    /// 32-byte XChaCha20-Poly1305 key, encoded as unpadded base64url.
    pub file_key: String,
    /// 24-byte XChaCha20-Poly1305 nonce, encoded as unpadded base64url.
    pub nonce: String,
    /// Lowercase SHA-256 digest of the ciphertext bytes.
    pub sha256: String,
    /// Version of this media encryption format.
    pub crypto_version: u32,
}

/// Encrypt one media object with a fresh random key and nonce.
///
/// This primitive is not exposed to JavaScript directly. The native bridge
/// must keep the file key in Rust until the file reference is placed into an
/// MLS-encrypted application message.
pub fn encrypt_media(plaintext: &[u8], kind: MediaKind) -> CoreResult<EncryptedMedia> {
    if plaintext.is_empty() || plaintext.len() > MAX_MEDIA_BYTES {
        return Err(CoreError::InvalidMediaAttachment);
    }

    let mut key = [0u8; KEY_BYTES];
    let mut nonce = [0u8; NONCE_BYTES];
    getrandom::getrandom(&mut key).map_err(|_| CoreError::MediaEncryptionFailed)?;
    getrandom::getrandom(&mut nonce).map_err(|_| {
        key.zeroize();
        CoreError::MediaEncryptionFailed
    })?;

    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| {
        key.zeroize();
        CoreError::MediaEncryptionFailed
    })?;
    let aad = associated_data(kind);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload { msg: plaintext, aad: &aad },
        )
        .map_err(|_| CoreError::MediaEncryptionFailed)?;

    let digest = Sha256::digest(&ciphertext);
    let result = EncryptedMedia {
        ciphertext,
        file_key: URL_SAFE_NO_PAD.encode(key),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        sha256: format!("{digest:x}"),
        crypto_version: MEDIA_CRYPTO_VERSION,
    };

    key.zeroize();
    nonce.zeroize();
    Ok(result)
}

/// Verify and decrypt a previously encrypted media object.
///
/// The server-provided digest is checked before AEAD decryption. The AEAD tag
/// authenticates the bytes and the media kind/version context.
pub fn decrypt_media(
    ciphertext: &[u8],
    file_key: &str,
    nonce: &str,
    expected_sha256: &str,
    crypto_version: u32,
    kind: MediaKind,
) -> CoreResult<Vec<u8>> {
    if crypto_version != MEDIA_CRYPTO_VERSION
        || ciphertext.is_empty()
        || ciphertext.len() > MAX_MEDIA_BYTES + 16
        || expected_sha256.len() != 64
        || !expected_sha256.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CoreError::InvalidMediaMetadata);
    }

    let digest = Sha256::digest(ciphertext);
    if format!("{digest:x}") != expected_sha256 {
        return Err(CoreError::MediaDigestMismatch);
    }

    let mut key = URL_SAFE_NO_PAD
        .decode(file_key)
        .map_err(|_| CoreError::InvalidMediaKey)?;
    let mut nonce_bytes = URL_SAFE_NO_PAD
        .decode(nonce)
        .map_err(|_| {
            key.zeroize();
            CoreError::InvalidMediaNonce
        })?;

    if key.len() != KEY_BYTES || nonce_bytes.len() != NONCE_BYTES {
        key.zeroize();
        nonce_bytes.zeroize();
        return Err(CoreError::InvalidMediaKey);
    }

    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| {
        key.zeroize();
        nonce_bytes.zeroize();
        CoreError::InvalidMediaKey
    })?;
    let aad = associated_data(kind);
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce_bytes),
            Payload { msg: ciphertext, aad: &aad },
        )
        .map_err(|_| CoreError::MediaDecryptionFailed)?;

    key.zeroize();
    nonce_bytes.zeroize();
    Ok(plaintext)
}

fn associated_data(kind: MediaKind) -> Vec<u8> {
    let kind_tag = match kind {
        MediaKind::Image => b"image".as_slice(),
        MediaKind::Video => b"video".as_slice(),
        MediaKind::Audio => b"audio".as_slice(),
        MediaKind::File => b"file".as_slice(),
    };
    let mut aad = b"chitchat-media-v1\0".to_vec();
    aad.extend_from_slice(kind_tag);
    aad
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypts_and_decrypts_with_fresh_nonce_and_key() {
        let original = b"ChitChat private media payload";
        let first = encrypt_media(original, MediaKind::Image).unwrap();
        let second = encrypt_media(original, MediaKind::Image).unwrap();

        assert_ne!(first.file_key, second.file_key);
        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, original);
        assert_eq!(
            decrypt_media(
                &first.ciphertext,
                &first.file_key,
                &first.nonce,
                &first.sha256,
                first.crypto_version,
                MediaKind::Image,
            )
            .unwrap(),
            original
        );
    }

    #[test]
    fn rejects_modified_ciphertext_before_decryption() {
        let mut encrypted = encrypt_media(b"private", MediaKind::Video).unwrap();
        encrypted.ciphertext[0] ^= 0x80;
        assert_eq!(
            decrypt_media(
                &encrypted.ciphertext,
                &encrypted.file_key,
                &encrypted.nonce,
                &encrypted.sha256,
                encrypted.crypto_version,
                MediaKind::Video,
            ),
            Err(CoreError::MediaDigestMismatch)
        );
    }

    #[test]
    fn authenticates_the_media_kind() {
        let encrypted = encrypt_media(b"voice note", MediaKind::Audio).unwrap();
        assert_eq!(
            decrypt_media(
                &encrypted.ciphertext,
                &encrypted.file_key,
                &encrypted.nonce,
                &encrypted.sha256,
                encrypted.crypto_version,
                MediaKind::File,
            ),
            Err(CoreError::MediaDecryptionFailed)
        );
    }

    #[test]
    fn rejects_wrong_key() {
        let encrypted = encrypt_media(b"private", MediaKind::File).unwrap();
        let wrong_key = URL_SAFE_NO_PAD.encode([7u8; KEY_BYTES]);
        assert_eq!(
            decrypt_media(
                &encrypted.ciphertext,
                &wrong_key,
                &encrypted.nonce,
                &encrypted.sha256,
                encrypted.crypto_version,
                MediaKind::File,
            ),
            Err(CoreError::MediaDecryptionFailed)
        );
    }
}
