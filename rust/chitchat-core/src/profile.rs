use serde::{Deserialize, Serialize};

use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDraft {
    pub username: String,
    pub display_name: String,
    pub bio: String,
    pub discoverable: bool,
}

pub fn validate_profile(profile: &ProfileDraft) -> CoreResult<()> {
    let username = profile.username.trim();
    if !(3..=20).contains(&username.len())
        || !username.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
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
