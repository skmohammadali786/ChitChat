//! OpenMLS SQLite provider backed by the fail-closed encrypted storage codec.
//!
//! The 32-byte database key must first be injected from Android Keystore or
//! iOS Keychain with `install_mls_storage_key`. The SQL database then stores
//! only authenticated ciphertext values for every OpenMLS storage record.

use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_sqlite_storage::{Connection, SqliteStorageProvider};
use openmls_traits::OpenMlsProvider as OpenMlsProviderTrait;

use crate::mls_storage::{mls_storage_is_unlocked, ChitChatStorageCodec};

/// Errors returned while opening the encrypted OpenMLS database.
#[derive(Debug, thiserror::Error)]
pub enum ProtectedProviderError {
    /// No platform-protected key is available in this process.
    #[error("Protected MLS storage is locked. Unlock the device key before opening the database.")]
    StorageKeyUnavailable,
    /// SQLite could not open the app-private database path.
    #[error("Could not open the protected MLS database: {0}")]
    DatabaseOpen(String),
    /// OpenMLS could not create or update its SQLite schema.
    #[error("Could not initialize the OpenMLS SQLite schema: {0}")]
    DatabaseMigration(String),
}

/// OpenMLS provider using RustCrypto and an authenticated-encryption SQLite codec.
///
/// The provider owns its SQLite connection. Keep it alive for as long as the
/// corresponding MlsGroup objects are in use. Do not open the same database
/// concurrently from multiple provider instances.
pub struct ProtectedOpenMlsProvider {
    crypto: OpenMlsRustCrypto,
    storage: SqliteStorageProvider<ChitChatStorageCodec>,
}

impl ProtectedOpenMlsProvider {
    /// Open or create an app-private SQLite database and run OpenMLS migrations.
    ///
    /// Fails closed when no Keychain/Keystore key has been installed.
    pub fn open(path: &str) -> Result<Self, ProtectedProviderError> {
        if !mls_storage_is_unlocked() {
            return Err(ProtectedProviderError::StorageKeyUnavailable);
        }

        let connection = Connection::open(path)
            .map_err(|error| ProtectedProviderError::DatabaseOpen(error.to_string()))?;
        let mut storage = SqliteStorageProvider::<ChitChatStorageCodec>::new(connection);
        storage
            .run_migrations()
            .map_err(|error| ProtectedProviderError::DatabaseMigration(error.to_string()))?;

        Ok(Self {
            crypto: OpenMlsRustCrypto::default(),
            storage,
        })
    }

    /// Return a reference to the encrypted SQLite storage provider.
    pub fn storage_provider(&self) -> &SqliteStorageProvider<ChitChatStorageCodec> {
        &self.storage
    }

    /// Open an in-memory encrypted SQLite provider for Rust tests only.
    #[cfg(test)]
    pub(crate) fn in_memory() -> Result<Self, ProtectedProviderError> {
        if !mls_storage_is_unlocked() {
            return Err(ProtectedProviderError::StorageKeyUnavailable);
        }

        let connection = Connection::open_in_memory()
            .map_err(|error| ProtectedProviderError::DatabaseOpen(error.to_string()))?;
        let mut storage = SqliteStorageProvider::<ChitChatStorageCodec>::new(connection);
        storage
            .run_migrations()
            .map_err(|error| ProtectedProviderError::DatabaseMigration(error.to_string()))?;

        Ok(Self {
            crypto: OpenMlsRustCrypto::default(),
            storage,
        })
    }
}

impl OpenMlsProviderTrait for ProtectedOpenMlsProvider {
    type CryptoProvider = <OpenMlsRustCrypto as OpenMlsProviderTrait>::CryptoProvider;
    type RandProvider = <OpenMlsRustCrypto as OpenMlsProviderTrait>::RandProvider;
    type StorageProvider = SqliteStorageProvider<ChitChatStorageCodec>;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        OpenMlsProviderTrait::crypto(&self.crypto)
    }

    fn rand(&self) -> &Self::RandProvider {
        OpenMlsProviderTrait::rand(&self.crypto)
    }
}
