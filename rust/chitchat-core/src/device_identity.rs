//! Ed25519 device identity and X25519 signed-prekey verification.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};
use zeroize::Zeroize;

use crate::{CoreError, CoreResult};

const KEY_VERSION: u32 = 1;
const KEY_LEN: usize = 32;
const SIGNATURE_LEN: usize = 64;
const BUNDLE_DOMAIN: &[u8] = b"chitchat-device-signed-prekey-v1\0";
const CHALLENGE_DOMAIN: &[u8] = b"chitchat-device-verification-v1\0";

/// Public key bundle safe to register with the authenticated device directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevicePublicBundle {
    /// Stable device registry identifier.
    pub device_id: Uuid,
    /// Owning Supabase user identifier.
    pub user_id: Uuid,
    /// Ed25519 public identity key in unpadded base64url.
    pub identity_key_public: String,
    /// X25519 signed-prekey public key in unpadded base64url.
    pub signed_prekey_public: String,
    /// Ed25519 signature binding the prekey to the user and device.
    pub signed_prekey_signature: String,
    /// Device bundle protocol version.
    pub key_version: u32,
    /// Ten-digit fingerprint derived from both public keys.
    pub fingerprint: String,
}

/// Result returned only after the signed device bundle verifies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerifiedDeviceFingerprint {
    /// Verified owner account.
    pub user_id: Uuid,
    /// Verified device identifier.
    pub device_id: Uuid,
    /// Ten-digit fingerprint to compare out-of-band.
    pub digits: String,
}

/// Private per-device keys. This type deliberately does not implement
/// Serialize. Persist it only through the encrypted native storage codec.
pub struct DeviceIdentity {
    device_id: Uuid,
    user_id: Uuid,
    signing_key: SigningKey,
    signed_prekey_secret: StaticSecret,
    public_bundle: DevicePublicBundle,
}

impl std::fmt::Debug for DeviceIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeviceIdentity")
            .field("device_id", &self.device_id)
            .field("user_id", &self.user_id)
            .field("private_keys", &"[REDACTED]")
            .finish()
    }
}

impl DeviceIdentity {
    /// Return public material only. The prekey public value is recalculated
    /// from the private prekey so the secret is actively retained in memory.
    pub fn public_bundle(&self) -> DevicePublicBundle {
        let derived_prekey = X25519PublicKey::from(&self.signed_prekey_secret).to_bytes();
        let mut bundle = self.public_bundle.clone();
        bundle.signed_prekey_public = URL_SAFE_NO_PAD.encode(derived_prekey);
        bundle.fingerprint = fingerprint(&self.signing_key.verifying_key().to_bytes(), &derived_prekey);
        bundle
    }

    /// Sign a random challenge using the long-term device identity key.
    pub fn sign_challenge(&self, challenge: &[u8]) -> CoreResult<String> {
        if !(16..=128).contains(&challenge.len()) {
            return Err(CoreError::InvalidDeviceChallenge);
        }
        let payload = challenge_payload(self.user_id, self.device_id, challenge);
        Ok(URL_SAFE_NO_PAD.encode(self.signing_key.sign(&payload).to_bytes()))
    }
}

impl DeviceIdentity {
    /// Export the two 32-byte private seeds for immediate encryption by the
    /// protected local storage codec. Callers must zeroize the returned copy.
    pub(crate) fn private_material(&self) -> [u8; KEY_LEN * 2] {
        let signing_seed = self.signing_key.to_bytes();
        let prekey_seed = self.signed_prekey_secret.to_bytes();
        let mut material = [0u8; KEY_LEN * 2];
        material[..KEY_LEN].copy_from_slice(&signing_seed);
        material[KEY_LEN..].copy_from_slice(&prekey_seed);
        material
    }
}

/// Create a new Ed25519 identity and X25519 signed prekey for this device.
pub fn generate_device_identity(user_id: Uuid, device_id: Uuid) -> CoreResult<DeviceIdentity> {
    let mut material = [0u8; KEY_LEN * 2];
    if getrandom::getrandom(&mut material).is_err() {
        material.zeroize();
        return Err(CoreError::DeviceKeyGenerationFailed);
    }
    let identity = restore_device_identity(user_id, device_id, &material);
    material.zeroize();
    identity
}

/// Restore a device identity from a secret record decrypted by the protected
/// local storage codec. The caller must never persist the supplied bytes
/// without encrypting them first.
pub(crate) fn restore_device_identity(
    user_id: Uuid,
    device_id: Uuid,
    material: &[u8],
) -> CoreResult<DeviceIdentity> {
    if material.len() != KEY_LEN * 2 {
        return Err(CoreError::InvalidDeviceSecretMaterial);
    }
    let mut signing_seed = [0u8; KEY_LEN];
    let mut prekey_seed = [0u8; KEY_LEN];
    signing_seed.copy_from_slice(&material[..KEY_LEN]);
    prekey_seed.copy_from_slice(&material[KEY_LEN..]);

    let signing_key = SigningKey::from_bytes(&signing_seed);
    let signed_prekey_secret = StaticSecret::from(prekey_seed);
    signing_seed.zeroize();
    prekey_seed.zeroize();

    let identity_public = signing_key.verifying_key().to_bytes();
    let prekey_public = X25519PublicKey::from(&signed_prekey_secret).to_bytes();
    let signature_payload = bundle_payload(user_id, device_id, KEY_VERSION, &prekey_public);
    let signature = signing_key.sign(&signature_payload).to_bytes();
    let public_bundle = DevicePublicBundle {
        device_id,
        user_id,
        identity_key_public: URL_SAFE_NO_PAD.encode(identity_public),
        signed_prekey_public: URL_SAFE_NO_PAD.encode(prekey_public),
        signed_prekey_signature: URL_SAFE_NO_PAD.encode(signature),
        key_version: KEY_VERSION,
        fingerprint: fingerprint(&identity_public, &prekey_public),
    };

    Ok(DeviceIdentity {
        device_id,
        user_id,
        signing_key,
        signed_prekey_secret,
        public_bundle,
    })
}

/// Verify a signed prekey and its immutable user/device/version binding.
pub fn verify_device_bundle(bundle: &DevicePublicBundle) -> CoreResult<VerifiedDeviceFingerprint> {
    if bundle.key_version != KEY_VERSION {
        return Err(CoreError::UnsupportedDeviceKeyVersion);
    }
    let identity = decode_fixed::<KEY_LEN>(&bundle.identity_key_public)
        .map_err(|_| CoreError::InvalidDevicePublicKey)?;
    let prekey = decode_fixed::<KEY_LEN>(&bundle.signed_prekey_public)
        .map_err(|_| CoreError::InvalidDevicePublicKey)?;
    let signature = decode_fixed::<SIGNATURE_LEN>(&bundle.signed_prekey_signature)
        .map_err(|_| CoreError::InvalidDeviceSignature)?;

    let verifying_key = VerifyingKey::from_bytes(&identity)
        .map_err(|_| CoreError::InvalidDevicePublicKey)?;
    let payload = bundle_payload(bundle.user_id, bundle.device_id, bundle.key_version, &prekey);
    verifying_key
        .verify(&payload, &Signature::from_bytes(&signature))
        .map_err(|_| CoreError::InvalidDeviceSignature)?;

    let digits = fingerprint(&identity, &prekey);
    if digits != bundle.fingerprint {
        return Err(CoreError::DeviceFingerprintMismatch);
    }

    Ok(VerifiedDeviceFingerprint {
        user_id: bundle.user_id,
        device_id: bundle.device_id,
        digits,
    })
}

/// Verify proof of possession for a fresh challenge from a previously verified device.
pub fn verify_device_challenge(
    bundle: &DevicePublicBundle,
    challenge: &[u8],
    challenge_signature: &str,
) -> CoreResult<bool> {
    if !(16..=128).contains(&challenge.len()) {
        return Err(CoreError::InvalidDeviceChallenge);
    }
    verify_device_bundle(bundle)?;
    let identity = decode_fixed::<KEY_LEN>(&bundle.identity_key_public)
        .map_err(|_| CoreError::InvalidDevicePublicKey)?;
    let signature = decode_fixed::<SIGNATURE_LEN>(challenge_signature)
        .map_err(|_| CoreError::InvalidDeviceSignature)?;
    let verifying_key = VerifyingKey::from_bytes(&identity)
        .map_err(|_| CoreError::InvalidDevicePublicKey)?;
    Ok(verifying_key
        .verify(&challenge_payload(bundle.user_id, bundle.device_id, challenge), &Signature::from_bytes(&signature))
        .is_ok())
}

fn decode_fixed<const N: usize>(value: &str) -> Result<[u8; N], ()> {
    let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|_| ())?;
    decoded.as_slice().try_into().map_err(|_| ())
}

fn bundle_payload(user_id: Uuid, device_id: Uuid, version: u32, prekey: &[u8; KEY_LEN]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(BUNDLE_DOMAIN.len() + 16 + 16 + 4 + KEY_LEN);
    payload.extend_from_slice(BUNDLE_DOMAIN);
    payload.extend_from_slice(user_id.as_bytes());
    payload.extend_from_slice(device_id.as_bytes());
    payload.extend_from_slice(&version.to_be_bytes());
    payload.extend_from_slice(prekey);
    payload
}

fn challenge_payload(user_id: Uuid, device_id: Uuid, challenge: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(CHALLENGE_DOMAIN.len() + 16 + 16 + challenge.len());
    payload.extend_from_slice(CHALLENGE_DOMAIN);
    payload.extend_from_slice(user_id.as_bytes());
    payload.extend_from_slice(device_id.as_bytes());
    payload.extend_from_slice(challenge);
    payload
}

fn fingerprint(identity: &[u8; KEY_LEN], prekey: &[u8; KEY_LEN]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"chitchat-device-fingerprint-v1\0");
    hasher.update(identity);
    hasher.update(prekey);
    let digest = hasher.finalize();
    let value = u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 digest length"));
    format!("{:010}", value % 10_000_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_device_bundle_and_challenge_verify() {
        let user = Uuid::new_v4();
        let device = Uuid::new_v4();
        let identity = generate_device_identity(user, device).unwrap();
        let bundle = identity.public_bundle();
        let verified = verify_device_bundle(&bundle).unwrap();
        assert_eq!(verified.user_id, user);
        assert_eq!(verified.device_id, device);
        assert_eq!(verified.digits, bundle.fingerprint);

        let challenge = [0x7a; 32];
        let signature = identity.sign_challenge(&challenge).unwrap();
        assert!(verify_device_challenge(&bundle, &challenge, &signature).unwrap());
        assert!(!verify_device_challenge(&bundle, &[0x7b; 32], &signature).unwrap());
    }

    #[test]
    fn rejects_tampered_prekey_and_user_binding() {
        let identity = generate_device_identity(Uuid::new_v4(), Uuid::new_v4()).unwrap();
        let original = identity.public_bundle();

        let mut changed_prekey = original.clone();
        changed_prekey.signed_prekey_public = URL_SAFE_NO_PAD.encode([0x33; KEY_LEN]);
        assert!(matches!(verify_device_bundle(&changed_prekey), Err(CoreError::InvalidDeviceSignature)));

        let mut changed_user = original;
        changed_user.user_id = Uuid::new_v4();
        assert!(matches!(verify_device_bundle(&changed_user), Err(CoreError::InvalidDeviceSignature)));
    }
}
