//! Production OpenMLS runtime used by the future Android/iOS native bridge.
//!
//! All private protocol state is persisted through ProtectedOpenMlsProvider.
//! The provider refuses to open until the native Keychain/Keystore key has
//! been injected. This module never stores plaintext messages in Supabase.
//!
//! The native bridge and application-level membership authorization are
//! separate release gates. Callers must set allow_control_messages only
//! after checking the current server-authorized group roster and role.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use serde::{Deserialize, Serialize};

use crate::{
    mls_provider::ProtectedOpenMlsProvider, validate_message_content, CoreError, CoreResult,
    MessageContent,
};

/// The mutually supported ChitChat MLS ciphersuite.
pub const CHITCHAT_CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

const MAX_IDENTITY_BYTES: usize = 512;
const MAX_KEY_PACKAGE_BYTES: usize = 64 * 1024;
const MAX_WIRE_MESSAGE_BYTES: usize = 1024 * 1024;

/// A public key package ready to publish to the authenticated device directory.
///
/// Its private init/encryption key material remains inside the local OpenMLS
/// storage provider. Only wire_bytes may be uploaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsKeyPackage {
    /// TLS-serialized public MLS KeyPackage.
    pub wire_bytes: Vec<u8>,
}

/// Commit and Welcome produced when adding one member to an MLS group.
///
/// Send commit to existing group members and welcome only to the new device.
/// Neither value contains application plaintext.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsAddMemberResult {
    /// TLS-serialized MLS Commit for existing members.
    pub commit: Vec<u8>,
    /// TLS-serialized MLS Welcome for the added member.
    pub welcome: Vec<u8>,
    /// The committed group epoch after the local sender merges its commit.
    pub epoch: u64,
}

/// Type of an authenticated inbound MLS event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MlsEventKind {
    /// An authenticated application message.
    Application,
    /// An authenticated Commit was merged after caller authorization.
    CommitMerged,
    /// A message authored by this device was echoed by the delivery service.
    OwnEcho,
}

/// Result of processing an inbound MLS wire message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MlsProcessedMessage {
    /// Event kind.
    pub kind: MlsEventKind,
    /// Decrypted application bytes. Present only for application messages.
    pub plaintext: Option<Vec<u8>>,
    /// Current local group epoch after processing.
    pub epoch: u64,
}

/// Persistent OpenMLS operations for a single installed device.
///
/// Construct this only after a native platform adapter has retrieved or
/// created a random 32-byte key in Android Keystore or iOS Keychain and called
/// install_mls_storage_key. Do not share one provider connection between
/// runtime instances.
pub struct MlsRuntime {
    provider: ProtectedOpenMlsProvider,
}

impl MlsRuntime {
    /// Open the protected, app-private SQLite database.
    ///
    /// This returns an error while the storage key is locked or unavailable.
    pub fn open(database_path: &str) -> CoreResult<Self> {
        let provider = ProtectedOpenMlsProvider::open(database_path)
            .map_err(|_| CoreError::MlsStorageUnavailable)?;
        Ok(Self { provider })
    }

    /// Generate a device-scoped public MLS KeyPackage.
    ///
    /// identity must be a stable, non-secret identifier for the account and
    /// device, encoded by the caller. A new signing key is generated and
    /// retained only inside the encrypted local OpenMLS storage.
    pub fn generate_key_package(&self, identity: &[u8]) -> CoreResult<MlsKeyPackage> {
        let (signer, credential) = create_credential(&self.provider, identity)?;
        let bundle = KeyPackage::builder()
            .build(
                CHITCHAT_CIPHERSUITE,
                &self.provider,
                &signer,
                credential,
            )
            .map_err(|_| CoreError::MlsOperationFailed)?;

        let wire_bytes = bundle
            .key_package()
            .tls_serialize_detached()
            .map_err(|_| CoreError::MlsOperationFailed)?;
        if wire_bytes.is_empty() || wire_bytes.len() > MAX_KEY_PACKAGE_BYTES {
            return Err(CoreError::MlsInvalidKeyPackage);
        }

        Ok(MlsKeyPackage { wire_bytes })
    }

    /// Create a new MLS group for a direct or group conversation.
    ///
    /// The returned group identifier is base64url without padding. It is an
    /// MLS identifier, not the Supabase conversation UUID.
    pub fn create_group(&self, identity: &[u8]) -> CoreResult<String> {
        let (signer, credential) = create_credential(&self.provider, identity)?;
        let group = MlsGroup::builder()
            .ciphersuite(CHITCHAT_CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build(&self.provider, &signer, credential)
            .map_err(|_| CoreError::MlsOperationFailed)?;

        Ok(URL_SAFE_NO_PAD.encode(group.group_id().as_slice()))
    }

    /// Add a device using its public MLS KeyPackage.
    ///
    /// The caller must first verify the target device bundle and confirm that
    /// the current server-side group role permits this membership change.
    /// The resulting commit is merged locally before this method returns.
    pub fn add_member(
        &self,
        group_id: &str,
        key_package_bytes: &[u8],
    ) -> CoreResult<MlsAddMemberResult> {
        if key_package_bytes.is_empty() || key_package_bytes.len() > MAX_KEY_PACKAGE_BYTES {
            return Err(CoreError::MlsInvalidKeyPackage);
        }

        let mut group = load_group(&self.provider, group_id)?;
        let signer = group_signer(&self.provider, &group)?;
        let key_package_in = KeyPackageIn::tls_deserialize_exact(key_package_bytes)
            .map_err(|_| CoreError::MlsInvalidKeyPackage)?;
        let key_package = key_package_in
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| CoreError::MlsInvalidKeyPackage)?;

        let (commit, welcome, _group_info) = group
            .add_members(&self.provider, &signer, core::slice::from_ref(&key_package))
            .map_err(|_| CoreError::MlsOperationFailed)?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CoreError::MlsOperationFailed)?;

        Ok(MlsAddMemberResult {
            commit: commit.to_bytes().map_err(|_| CoreError::MlsOperationFailed)?,
            welcome: welcome.to_bytes().map_err(|_| CoreError::MlsOperationFailed)?,
            epoch: group.epoch().as_u64(),
        })
    }

    /// Remove a member by its MLS leaf index.
    ///
    /// The caller must map the requested account/device to a leaf index using
    /// the authenticated MLS roster and independently verify that the current
    /// group role permits removal. This method refuses to remove the local
    /// device. The removal Commit is merged locally before it is returned.
    pub fn remove_member(
        &self,
        group_id: &str,
        member_leaf_index: u32,
    ) -> CoreResult<MlsRemoveMemberResult> {
        let mut group = load_group(&self.provider, group_id)?;
        let target = LeafNodeIndex::new(member_leaf_index);

        if target == group.own_leaf_index() {
            return Err(CoreError::MlsCannotRemoveSelf);
        }
        if group.member_at(target).is_none() {
            return Err(CoreError::MlsMemberNotFound);
        }

        let signer = group_signer(&self.provider, &group)?;
        let (commit, _welcome, _group_info) = group
            .remove_members(&self.provider, &signer, &[target])
            .map_err(|_| CoreError::MlsOperationFailed)?;
        let wire_bytes = commit
            .to_bytes()
            .map_err(|_| CoreError::MlsOperationFailed)?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CoreError::MlsOperationFailed)?;

        Ok(MlsRemoveMemberResult {
            commit: wire_bytes,
            epoch: group.epoch().as_u64(),
        })
    }

    /// Join a group from a Welcome addressed to this device's stored KeyPackage.
    pub fn join_group(&self, welcome_bytes: &[u8]) -> CoreResult<String> {
        if welcome_bytes.is_empty() || welcome_bytes.len() > MAX_WIRE_MESSAGE_BYTES {
            return Err(CoreError::MlsInvalidWireMessage);
        }

        let message = MlsMessageIn::tls_deserialize_exact(welcome_bytes)
            .map_err(|_| CoreError::MlsInvalidWelcome)?;
        let MlsMessageBodyIn::Welcome(welcome) = message.extract() else {
            return Err(CoreError::MlsInvalidWelcome);
        };

        let group = StagedWelcome::new_from_welcome(
            &self.provider,
            &MlsGroupJoinConfig::default(),
            welcome,
            None,
        )
        .map_err(|_| CoreError::MlsInvalidWelcome)?
        .into_group(&self.provider)
        .map_err(|_| CoreError::MlsInvalidWelcome)?;

        Ok(URL_SAFE_NO_PAD.encode(group.group_id().as_slice()))
    }

    /// Encrypt application bytes with the current group epoch.
    ///
    /// The caller should pass a versioned ChitChat message-content envelope,
    /// not an unstructured plaintext string. This method returns only MLS
    /// wire bytes. It does not write to Supabase or Cloudflare.
    pub fn encrypt_application(
        &self,
        group_id: &str,
        plaintext: &[u8],
    ) -> CoreResult<Vec<u8>> {
        if plaintext.is_empty() || plaintext.len() > MAX_WIRE_MESSAGE_BYTES {
            return Err(CoreError::MlsInvalidPlaintext);
        }

        let mut group = load_group(&self.provider, group_id)?;
        let signer = group_signer(&self.provider, &group)?;
        let encrypted = group
            .create_message(&self.provider, &signer, plaintext)
            .map_err(|_| CoreError::MlsOperationFailed)?;
        encrypted
            .to_bytes()
            .map_err(|_| CoreError::MlsOperationFailed)
    }

    /// Validate and encrypt a versioned ChitChat text/media content payload.
    ///
    /// Media file keys belong inside this payload. They are protected by MLS
    /// and must never be copied into Supabase metadata or a push payload.
    pub fn encrypt_content(
        &self,
        group_id: &str,
        content: &MessageContent,
    ) -> CoreResult<Vec<u8>> {
        validate_message_content(content)?;
        let plaintext = serde_json::to_vec(content)
            .map_err(|_| CoreError::InvalidMessageContent)?;
        self.encrypt_application(group_id, &plaintext)
    }

    /// Decode and validate an authenticated ChitChat application payload.
    ///
    /// Call this only with bytes returned by process_incoming for an
    /// Application event. The input must already have passed MLS authentication.
    pub fn decode_application_content(bytes: &[u8]) -> CoreResult<MessageContent> {
        if bytes.is_empty() || bytes.len() > MAX_WIRE_MESSAGE_BYTES {
            return Err(CoreError::InvalidMessageContent);
        }
        let content: MessageContent =
            serde_json::from_slice(bytes).map_err(|_| CoreError::InvalidMessageContent)?;
        validate_message_content(&content)?;
        Ok(content)
    }

    /// Authenticate and process one inbound MLS wire message.
    ///
    /// Application messages are decrypted and returned. Commits are merged
    /// only when allow_control_messages is true. The caller must set that
    /// flag only after checking the sender's role and the expected membership
    /// change against the authenticated server roster. Standalone proposals
    /// are rejected until an explicit proposal-approval workflow is added.
    pub fn process_incoming(
        &self,
        group_id: &str,
        wire_bytes: &[u8],
        allow_control_messages: bool,
    ) -> CoreResult<MlsProcessedMessage> {
        if wire_bytes.is_empty() || wire_bytes.len() > MAX_WIRE_MESSAGE_BYTES {
            return Err(CoreError::MlsInvalidWireMessage);
        }

        let mut group = load_group(&self.provider, group_id)?;
        let incoming = MlsMessageIn::tls_deserialize_exact(wire_bytes)
            .map_err(|_| CoreError::MlsInvalidWireMessage)?;
        let protocol_message = incoming
            .try_into_protocol_message()
            .map_err(|_| CoreError::MlsInvalidWireMessage)?;

        // Reject control messages before handing them to OpenMLS. This avoids
        // advancing receive state for a commit or proposal that this caller
        // has not authorized against the server-side group roster.
        if !allow_control_messages
            && protocol_message.content_type() != ContentType::Application
        {
            return Err(CoreError::MlsControlMessageRequiresApproval);
        }

        let processed = group
            .process_message(&self.provider, protocol_message)
            .map_err(|_| CoreError::MlsOperationFailed)?;

        let (kind, plaintext) = match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(application) => {
                (MlsEventKind::Application, Some(application.into_bytes()))
            }
            ProcessedMessageContent::StagedCommitMessage(staged_commit) => {
                if !allow_control_messages {
                    return Err(CoreError::MlsControlMessageRequiresApproval);
                }
                group
                    .merge_staged_commit(&self.provider, *staged_commit)
                    .map_err(|_| CoreError::MlsOperationFailed)?;
                (MlsEventKind::CommitMerged, None)
            }
            ProcessedMessageContent::OwnPendingCommit => {
                if !allow_control_messages {
                    return Err(CoreError::MlsControlMessageRequiresApproval);
                }
                group
                    .merge_pending_commit(&self.provider)
                    .map_err(|_| CoreError::MlsOperationFailed)?;
                (MlsEventKind::CommitMerged, None)
            }
            ProcessedMessageContent::OwnPrivateMessage => (MlsEventKind::OwnEcho, None),
            ProcessedMessageContent::ProposalMessage(_)
            | ProcessedMessageContent::ExternalJoinProposalMessage(_) => {
                return Err(CoreError::MlsControlMessageRequiresApproval);
            }
        };

        Ok(MlsProcessedMessage {
            kind,
            plaintext,
            epoch: group.epoch().as_u64(),
        })
    }

    /// Stage and locally merge a self-update, returning its MLS Commit bytes.
    ///
    /// The returned commit must be distributed to the other group members.
    pub fn rotate_own_leaf(&self, group_id: &str) -> CoreResult<Vec<u8>> {
        let mut group = load_group(&self.provider, group_id)?;
        let signer = group_signer(&self.provider, &group)?;
        let update = group
            .self_update(&self.provider, &signer, LeafNodeParameters::default())
            .map_err(|_| CoreError::MlsOperationFailed)?;
        let (commit, _welcome, _group_info) = update.into_contents();
        let wire_bytes = commit
            .to_bytes()
            .map_err(|_| CoreError::MlsOperationFailed)?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CoreError::MlsOperationFailed)?;
        Ok(wire_bytes)
    }

    /// Return the current local epoch for a group.
    pub fn current_epoch(&self, group_id: &str) -> CoreResult<u64> {
        let group = load_group(&self.provider, group_id)?;
        Ok(group.epoch().as_u64())
    }

    #[cfg(test)]
    pub(crate) fn from_provider(provider: ProtectedOpenMlsProvider) -> Self {
        Self { provider }
    }
}

fn validate_identity(identity: &[u8]) -> CoreResult<()> {
    if identity.is_empty() || identity.len() > MAX_IDENTITY_BYTES {
        return Err(CoreError::MlsInvalidIdentity);
    }
    Ok(())
}

fn create_credential(
    provider: &ProtectedOpenMlsProvider,
    identity: &[u8],
) -> CoreResult<(SignatureKeyPair, CredentialWithKey)> {
    validate_identity(identity)?;
    let signer = SignatureKeyPair::new(CHITCHAT_CIPHERSUITE.signature_algorithm())
        .map_err(|_| CoreError::MlsOperationFailed)?;
    signer
        .store(provider.storage())
        .map_err(|_| CoreError::MlsStorageUnavailable)?;
    let credential = BasicCredential::new(identity.to_vec());
    let credential_with_key = CredentialWithKey {
        credential: credential.into(),
        signature_key: signer.public().into(),
    };
    Ok((signer, credential_with_key))
}

fn decode_group_id(value: &str) -> CoreResult<GroupId> {
    if value.is_empty() || value.len() > 512 {
        return Err(CoreError::MlsInvalidGroupId);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| CoreError::MlsInvalidGroupId)?;
    if bytes.is_empty() || bytes.len() > 255 {
        return Err(CoreError::MlsInvalidGroupId);
    }
    Ok(GroupId::from_slice(&bytes))
}

fn load_group(provider: &ProtectedOpenMlsProvider, value: &str) -> CoreResult<MlsGroup> {
    let group_id = decode_group_id(value)?;
    MlsGroup::load(provider.storage(), &group_id)
        .map_err(|_| CoreError::MlsStorageUnavailable)?
        .ok_or(CoreError::MlsGroupNotFound)
}

fn group_signer(
    provider: &ProtectedOpenMlsProvider,
    group: &MlsGroup,
) -> CoreResult<SignatureKeyPair> {
    let public_key = group
        .own_leaf_node()
        .ok_or(CoreError::MlsOperationFailed)?
        .signature_key();
    SignatureKeyPair::read(
        provider.storage(),
        public_key.as_slice(),
        group.ciphersuite().signature_algorithm(),
    )
    .ok_or(CoreError::MlsStorageUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mls_storage::{clear_mls_storage_key, install_mls_storage_key, MLS_TEST_LOCK};

    #[test]
    fn runtime_creates_joins_encrypts_decrypts_and_rotates_epoch() {
        let _storage_test_guard = MLS_TEST_LOCK.lock().expect("acquire serialized MLS storage test lock");
        clear_mls_storage_key().expect("clear previous MLS storage key");
        install_mls_storage_key(&[0x6b; 32]).expect("install ephemeral test storage key");

        let alice_provider = ProtectedOpenMlsProvider::in_memory().expect("open Alice provider");
        let bob_provider = ProtectedOpenMlsProvider::in_memory().expect("open Bob provider");
        let alice = MlsRuntime::from_provider(alice_provider);
        let bob = MlsRuntime::from_provider(bob_provider);

        let bob_key_package = bob.generate_key_package(b"bob-device-1").expect("generate Bob KeyPackage");
        let group_id = alice.create_group(b"alice-device-1").expect("create Alice group");
        assert_eq!(alice.current_epoch(&group_id).unwrap(), 0);

        let invite = alice.add_member(&group_id, &bob_key_package.wire_bytes).expect("add Bob");
        assert!(!invite.commit.is_empty());
        assert!(!invite.welcome.is_empty());
        assert!(invite.epoch > 0);

        let joined_group_id = bob.join_group(&invite.welcome).expect("join from Welcome");
        assert_eq!(joined_group_id, group_id);
        assert_eq!(bob.current_epoch(&joined_group_id).unwrap(), invite.epoch);

        let content = MessageContent {
            version: 1,
            blocks: vec![crate::MessageBlock::Text {
                text: "Hello from ChitChat 🔐".into(),
                concealed: false,
            }],
        };
        let encrypted = alice.encrypt_content(&group_id, &content).expect("encrypt validated content");
        assert_ne!(encrypted, serde_json::to_vec(&content).unwrap());
        let received = bob.process_incoming(&group_id, &encrypted, false).expect("decrypt application");
        assert_eq!(received.kind, MlsEventKind::Application);
        let decoded = MlsRuntime::decode_application_content(
            received.plaintext.as_deref().expect("application plaintext"),
        )
        .expect("decode validated ChitChat content");
        assert_eq!(decoded, content);

        let prior_epoch = bob.current_epoch(&group_id).unwrap();
        let commit = bob.rotate_own_leaf(&group_id).expect("rotate Bob leaf");
        assert!(!commit.is_empty());
        assert_eq!(
            alice.process_incoming(&group_id, &commit, false),
            Err(CoreError::MlsControlMessageRequiresApproval)
        );
        let applied = alice.process_incoming(&group_id, &commit, true).expect("apply authorized key update");
        assert_eq!(applied.kind, MlsEventKind::CommitMerged);
        assert!(applied.epoch > prior_epoch);
        assert_eq!(applied.epoch, bob.current_epoch(&group_id).unwrap());

        let next_message = b"New epoch key material is active.";
        let encrypted = bob.encrypt_application(&group_id, next_message).expect("encrypt after rotation");
        let received = alice.process_incoming(&group_id, &encrypted, false).expect("decrypt after rotation");
        assert_eq!(received.plaintext.as_deref(), Some(next_message.as_slice()));

        let removed = alice.remove_member(&group_id, 1).expect("remove Bob from group");
        assert!(removed.epoch > applied.epoch);
        let removal_event = bob
            .process_incoming(&group_id, &removed.commit, true)
            .expect("process Bob's removal commit");
        assert_eq!(removal_event.kind, MlsEventKind::CommitMerged);
        assert!(bob.encrypt_application(&group_id, b"must not send after removal").is_err());

        clear_mls_storage_key().expect("clear test storage key");
    }

    #[test]
    fn runtime_rejects_empty_identity_and_malformed_wire_data() {
        let _storage_test_guard = MLS_TEST_LOCK.lock().expect("acquire serialized MLS storage test lock");
        clear_mls_storage_key().expect("clear previous MLS storage key");
        install_mls_storage_key(&[0x31; 32]).expect("install ephemeral test storage key");
        let provider = ProtectedOpenMlsProvider::in_memory().expect("open test provider");
        let runtime = MlsRuntime::from_provider(provider);

        assert_eq!(runtime.create_group(&[]), Err(CoreError::MlsInvalidIdentity));
        assert_eq!(runtime.join_group(b"not a Welcome"), Err(CoreError::MlsInvalidWelcome));
        assert_eq!(runtime.current_epoch("###"), Err(CoreError::MlsInvalidGroupId));
        assert_eq!(
            MlsRuntime::decode_application_content(b"{}"),
            Err(CoreError::InvalidMessageContent)
        );
        let empty_content = MessageContent {
            version: 1,
            blocks: Vec::new(),
        };
        assert_eq!(
            runtime.encrypt_content("unused-group", &empty_content),
            Err(CoreError::InvalidMessageContent)
        );

        clear_mls_storage_key().expect("clear test storage key");
    }
}
