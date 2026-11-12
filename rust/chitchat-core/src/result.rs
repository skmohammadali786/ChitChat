use thiserror::Error;

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CoreError {
    #[error("Invalid username. Use 3 to 20 lowercase letters, numbers, or underscores.")]
    InvalidUsername,
    #[error("Display name must contain 2 to 40 characters.")]
    InvalidDisplayName,
    #[error("Bio cannot exceed 160 characters.")]
    BioTooLong,
    #[error("Encrypted message payload is missing or exceeds the size limit.")]
    InvalidCiphertext,
    #[error("Message nonce is missing or invalid.")]
    InvalidNonce,
    #[error("Cryptographic key version must be greater than zero.")]
    InvalidKeyVersion,
    #[error("Cryptographic metadata must be a JSON object.")]
    InvalidCryptoHeader,
    #[error("Message envelope contains unsupported values.")]
    InvalidEnvelope,
}
