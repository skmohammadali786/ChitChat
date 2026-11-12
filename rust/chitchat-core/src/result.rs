use thiserror::Error;

/// Result type used by the shared ChitChat Rust core.
pub type CoreResult<T> = Result<T, CoreError>;

/// Errors returned by domain validation and message-envelope checks.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum CoreError {
    /// Username is not 3 to 20 lowercase ASCII letters, numbers, or underscores.
    #[error("Invalid username. Use 3 to 20 lowercase letters, numbers, or underscores.")]
    InvalidUsername,
    /// Display name is outside the accepted 2 to 40 character range.
    #[error("Display name must contain 2 to 40 characters.")]
    InvalidDisplayName,
    /// Biography exceeds the 160 character limit.
    #[error("Bio cannot exceed 160 characters.")]
    BioTooLong,
    /// Ciphertext is empty or larger than the transport limit.
    #[error("Encrypted message payload is missing or exceeds the size limit.")]
    InvalidCiphertext,
    /// Nonce is missing or larger than the transport limit.
    #[error("Message nonce is missing or invalid.")]
    InvalidNonce,
    /// The message envelope has an invalid key version.
    #[error("Cryptographic key version must be greater than zero.")]
    InvalidKeyVersion,
    /// The crypto header is not a JSON object.
    #[error("Cryptographic metadata must be a JSON object.")]
    InvalidCryptoHeader,
    /// The provided envelope contains an unsupported or malformed value.
    #[error("Message envelope contains unsupported values.")]
    InvalidEnvelope,
    /// The application message content has an unsupported or malformed structure.
    #[error("Message content is empty, too large, or uses an unsupported version.")]
    InvalidMessageContent,
    /// A media reference contains invalid encryption metadata.
    #[error("Encrypted media metadata is invalid.")]
    InvalidMediaAttachment,
}
