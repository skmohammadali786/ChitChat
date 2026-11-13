//! OpenMLS protocol integration tests and shared MLS configuration.
//!
//! This module uses the real OpenMLS 0.9.2 implementation with the RFC 9420
//! mandatory X25519/AES-128-GCM/Ed25519 ciphersuite. It currently runs in the
//! Rust core test/runtime process. It is not yet persisted in protected device
//! storage or exposed through the Android/iOS React Native bridge, so it does
//! not enable the production message composer.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;

/// The mutually supported mandatory-to-implement ChitChat MLS ciphersuite.
pub const CHITCHAT_CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Create a fresh MLS credential and signer for a single device identity.
fn test_identity(
    provider: &OpenMlsRustCrypto,
    identity: &[u8],
) -> (SignatureKeyPair, CredentialWithKey) {
    let credential = BasicCredential::new(identity.to_vec());
    let signer = SignatureKeyPair::new(CHITCHAT_CIPHERSUITE.signature_algorithm())
        .expect("generate Ed25519 signature keys");
    signer.store(provider.storage()).expect("store signature keys");

    let credential_with_key = CredentialWithKey {
        credential: credential.into(),
        signature_key: signer.public().into(),
    };
    (signer, credential_with_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_clients_exchange_mls_application_messages_and_rotate_epoch() {
        let alice_provider = OpenMlsRustCrypto::default();
        let bob_provider = OpenMlsRustCrypto::default();
        let (alice_signer, alice_credential) = test_identity(&alice_provider, b"alice-device-1");
        let (bob_signer, bob_credential) = test_identity(&bob_provider, b"bob-device-1");

        let bob_key_package = KeyPackage::builder()
            .build(
                CHITCHAT_CIPHERSUITE,
                &bob_provider,
                &bob_signer,
                bob_credential,
            )
            .expect("build Bob key package");

        let mut alice_group = MlsGroup::builder()
            .ciphersuite(CHITCHAT_CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build(&alice_provider, &alice_signer, alice_credential)
            .expect("create Alice MLS group");

        let (_commit, welcome, _group_info) = alice_group
            .add_members(
                &alice_provider,
                &alice_signer,
                core::slice::from_ref(bob_key_package.key_package()),
            )
            .expect("add Bob by KeyPackage");
        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("merge group membership commit");

        let mut bob_group = StagedWelcome::new_from_welcome(
            &bob_provider,
            &MlsGroupJoinConfig::default(),
            welcome,
            None,
        )
        .expect("process MLS Welcome")
        .into_group(&bob_provider)
        .expect("join MLS group");

        assert_eq!(alice_group.epoch(), bob_group.epoch());
        assert_eq!(alice_group.members().count(), 2);
        assert_eq!(bob_group.members().count(), 2);

        let secret = "Hello from ChitChat 🔐".as_bytes();
        let encrypted = alice_group
            .create_message(&alice_provider, &alice_signer, secret)
            .expect("encrypt an MLS application message");
        let processed = bob_group
            .process_message(
                &bob_provider,
                encrypted.into_protocol_message().expect("convert MLS message"),
            )
            .expect("authenticate and decrypt MLS message");
        let ProcessedMessageContent::ApplicationMessage(application) = processed.into_content() else {
            panic!("expected an MLS application message");
        };
        assert_eq!(application.into_bytes(), secret);

        let prior_epoch = bob_group.epoch();
        let (commit, _welcome, _group_info) = bob_group
            .self_update(
                &bob_provider,
                &bob_signer,
                LeafNodeParameters::default(),
            )
            .expect("stage Bob's MLS self-update")
            .into_contents();

        let processed_commit = alice_group
            .process_message(
                &alice_provider,
                commit.into_protocol_message().expect("convert MLS commit"),
            )
            .expect("process Bob's MLS key update");
        let ProcessedMessageContent::StagedCommitMessage(staged_commit) =
            processed_commit.into_content()
        else {
            panic!("expected a staged MLS commit");
        };

        alice_group
            .merge_staged_commit(&alice_provider, *staged_commit)
            .expect("merge Bob's key update");
        bob_group
            .merge_pending_commit(&bob_provider)
            .expect("merge own key update");

        assert!(alice_group.epoch() > prior_epoch);
        assert_eq!(alice_group.epoch(), bob_group.epoch());

        let after_rotation = b"New epoch key material is active.";
        let encrypted = bob_group
            .create_message(&bob_provider, &bob_signer, after_rotation)
            .expect("encrypt after MLS key rotation");
        let processed = alice_group
            .process_message(
                &alice_provider,
                encrypted.into_protocol_message().expect("convert new epoch message"),
            )
            .expect("decrypt message from new MLS epoch");
        let ProcessedMessageContent::ApplicationMessage(application) = processed.into_content() else {
            panic!("expected an MLS application message after rotation");
        };
        assert_eq!(application.into_bytes(), after_rotation);
    }
}
