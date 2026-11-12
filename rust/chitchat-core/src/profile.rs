use serde::{Deserialize, Serialize};

use crate::{CoreError, CoreResult};

/// User profile values shared by the Android and iOS clients.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDraft {
    /// ChitChat username, lowercase letters, numbers, and underscores only.
    pub username: String,
    /// Display name shown to other users.
    pub display_name: String,
    /// Optional profile biography, limited to 160 Unicode scalar values.
    pub bio: String,
    /// Whether exact username lookup is enabled.
    pub discoverable: bool,
}

/// Validate the fields accepted by profile onboarding.
pub fn validate_profile(profile: &ProfileDraft) -> CoreResult<()> {
    let username = profile.username.trim();
    if !(3..=20).contains(&username.len())
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(CoreError::InvalidUsername);
    }

    let display_name = profile.display_name.trim();
    if !(2..=40).contains(&display_name.chars().count()) {
        return Err(CoreError::InvalidDisplayName);
    }

    if profile.bio.chars().count() > 160 {
        return Err(CoreError::BioTooLong);
    }

    Ok(())
}
