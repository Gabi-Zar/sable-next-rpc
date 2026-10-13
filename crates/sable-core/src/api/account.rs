use std::sync::Arc;

use matrix_sdk::ruma::api::client::profile::{PropagateTo, set_profile_field};
use matrix_sdk::ruma::api::client::state::get_state_event_for_key;
use matrix_sdk::ruma::api::error::ErrorKind;
use matrix_sdk::ruma::events::room::member::MembershipState;
use matrix_sdk::ruma::profile::{ProfileFieldName, ProfileFieldValue};
use matrix_sdk::ruma::{OwnedEventId, OwnedRoomId, OwnedUserId, UserId};
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::api::support::state_event_content;
use crate::media::mxc_uri;
use crate::profile_overrides::OverrideEdit;
use crate::profiles::profile_view;
use crate::protocol::{BookmarkView, RpcError, FieldEdit, InviteTriageView, MediaPreviewConfigView, MutualRoomView, PresenceView, ProfileOverridesView, ProfileView, SealedAccountDataView, UserDirectoryEntryView};
use crate::{Core, ResultExt, presence};

domain! {
    user_profile,
    user_relations,
    account_data_types,
    account_data,
    set_account_data,
    sealed_account_data,
    set_sealed_account_data,
    set_display_name,
    set_avatar_url,
    set_profile_field,
    account_contacts,
    ignored_users,
    invite_triage,
    set_direct,
    ignore_user,
    unignore_user,
    report_user,
    set_presence,
    fetch_presence,
    search_user_directory,
    dismissed_invites,
    set_invite_dismissed,
    bookmarks,
    set_bookmark,
    media_preview_config,
    set_media_preview_config,
    profile_overrides,
    set_profile_override,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ProfilePropagationView {
    All,
    Unchanged,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AvatarEditView {
    Keep,
    Clear,
    Url {
        url: String,
    },
    /// Encrypted in the webview with the account data key in hand.
    Encrypted {
        #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
        file: serde_json::Value,
    },
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UserProfileParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
}

impl Handler for UserProfileParams {
    type Ok = ProfileView;

    async fn run(self, core: &Arc<Core>) -> Result<ProfileView, RpcError> {
        let response = core
            .client()
            .await?
            .account()
            .fetch_user_profile_of(&self.user_id)
            .await
            .map_err(|error| core.profile_error(error))?;
        Ok(profile_view(self.user_id, &response))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UserRelationsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UserRelationsOk {
    pub mutual_rooms: Vec<MutualRoomView>,
    pub ignored: bool,
}

impl Handler for UserRelationsParams {
    type Ok = UserRelationsOk;

    async fn run(self, core: &Arc<Core>) -> Result<UserRelationsOk, RpcError> {
        let client = core.client().await?;
        let ignored = client
            .subscribe_to_ignore_user_list_changes()
            .get()
            .iter()
            .any(|ignored| ignored == self.user_id.as_str());
        // Sliding sync never delivers a leave for a silent member, so
        // stored rooms are confirmed with the server.
        let target = &self.user_id;
        let lookups = client.joined_rooms().into_iter().map(|room| async move {
            let stored = room
                .get_member_no_sync(target)
                .await
                .ok()
                .flatten()
                .is_some_and(|member| member.membership() == &MembershipState::Join);
            let joined = stored && confirmed_member_join(&room, target).await;
            joined.then(|| MutualRoomView {
                name: room
                    .cached_display_name()
                    .map(|name| name.to_string())
                    .or_else(|| room.name()),
                room_id: room.room_id().to_owned(),
                is_space: room.is_space(),
            })
        });
        let mutual_rooms = futures_util::future::join_all(lookups)
            .await
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();

        Ok(UserRelationsOk {
            mutual_rooms,
            ignored,
        })
    }
}

async fn confirmed_member_join(room: &matrix_sdk::Room, user_id: &UserId) -> bool {
    let response = room
        .client()
        .send(get_state_event_for_key::v3::Request::new(
            room.room_id().to_owned(),
            matrix_sdk::ruma::events::StateEventType::RoomMember,
            user_id.to_string(),
        ))
        .await;
    match response {
        Ok(response) => state_event_content(response.event_or_content.get())
            .and_then(|content| content.get("membership")?.as_str().map(|m| m == "join"))
            .unwrap_or(true),
        Err(error) if error.client_api_error_kind() == Some(&ErrorKind::NotFound) => false,
        Err(_) => true,
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AccountDataTypesParams {}

impl Handler for AccountDataTypesParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, RpcError> {
        core.account_data_types().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AccountDataParams {
    pub event_type: String,
}

/// The event's content, `null` when the account has none.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(transparent)]
pub struct AccountDataContent(
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Unknown>))]
    pub  Option<serde_json::Value>,
);

impl Handler for AccountDataParams {
    type Ok = AccountDataContent;

    async fn run(self, core: &Arc<Core>) -> Result<AccountDataContent, RpcError> {
        core.remember_account_data_type(self.event_type.as_str())
            .await;
        let content = core
            .global_account_data(self.event_type.into(), "account_data")
            .await?
            .and_then(|raw| raw.deserialize_as::<serde_json::Value>().ok());
        Ok(AccountDataContent(content))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetAccountDataParams {
    pub event_type: String,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub content: serde_json::Value,
}

impl Handler for SetAccountDataParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.set_account_data(&self.event_type, &self.content).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SealedAccountDataParams {
    pub event_type: String,
}

impl Handler for SealedAccountDataParams {
    type Ok = SealedAccountDataView;

    async fn run(self, core: &Arc<Core>) -> Result<SealedAccountDataView, RpcError> {
        core.remember_account_data_type(self.event_type.as_str())
            .await;
        core.sealed_account_data(&self.event_type).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetSealedAccountDataParams {
    pub event_type: String,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub content: serde_json::Value,
}

impl Handler for SetSealedAccountDataParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.remember_account_data_type(self.event_type.as_str())
            .await;
        core.set_sealed_account_data(&self.event_type, &self.content)
            .await
    }
}

/// `null` clears it.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetDisplayNameParams {
    pub name: Option<String>,
    pub propagate_to: ProfilePropagationView,
}

impl Handler for SetDisplayNameParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let client = core.client().await?;
        if client
            .unstable_features()
            .await
            .or_failed(core, "set_display_name")?
            .contains(&matrix_sdk::ruma::api::FeatureFlag::from(
                "computer.gingershaped.msc4466",
            ))
        {
            let value = ProfileFieldValue::new(
                "displayname",
                serde_json::Value::String(self.name.unwrap_or_default()),
            )
            .or_failed(core, "set_display_name")?;
            let mut request = set_profile_field::v3::Request::new(
                client.user_id().ok_or(RpcError::NotLoggedIn)?.to_owned(),
                value,
            );
            request.propagate_to = profile_propagation(self.propagate_to);
            client
                .send(request)
                .await
                .or_failed(core, "set_display_name")?;
        } else {
            client
                .account()
                .set_display_name(self.name.as_deref())
                .await
                .or_failed(core, "set_display_name")?;
        }

        Ok(())
    }
}

/// An `mxc:` URI from the carrier's `uploadMedia`. `null` clears it.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetAvatarUrlParams {
    pub url: Option<String>,
    pub propagate_to: ProfilePropagationView,
}

impl Handler for SetAvatarUrlParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let url = match self.url {
            Some(url) => Some(mxc_uri(&url)?),
            None => None,
        };

        let client = core.client().await?;
        if client
            .unstable_features()
            .await
            .or_failed(core, "set_avatar_url")?
            .contains(&matrix_sdk::ruma::api::FeatureFlag::from(
                "computer.gingershaped.msc4466",
            ))
        {
            let value = ProfileFieldValue::new(
                "avatar_url",
                serde_json::Value::String(url.map(|url| url.to_string()).unwrap_or_default()),
            )
            .or_failed(core, "set_avatar_url")?;
            let mut request = set_profile_field::v3::Request::new(
                client.user_id().ok_or(RpcError::NotLoggedIn)?.to_owned(),
                value,
            );
            request.propagate_to = profile_propagation(self.propagate_to);
            client
                .send(request)
                .await
                .or_failed(core, "set_avatar_url")?;
        } else {
            client
                .account()
                .set_avatar_url(url.as_deref())
                .await
                .or_failed(core, "set_avatar_url")?;
        }

        Ok(())
    }
}

const fn profile_propagation(view: ProfilePropagationView) -> PropagateTo {
    match view {
        ProfilePropagationView::All => PropagateTo::All,
        ProfilePropagationView::Unchanged => PropagateTo::Unchanged,
        ProfilePropagationView::None => PropagateTo::None,
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetProfileFieldParams {
    pub field: String,
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Unknown>))]
    pub value: Option<serde_json::Value>,
}

impl Handler for SetProfileFieldParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        let account = core.client().await?.account();
        match self.value {
            Some(value) => {
                let value = ProfileFieldValue::new(&self.field, value)
                    .map_err(|error| core.failed("set_profile_field_invalid_value", error))?;
                account
                    .set_profile_field(value)
                    .await
                    .or_failed(core, "set_profile_field")?;
            }
            None => {
                account
                    .delete_profile_field(ProfileFieldName::from(self.field.as_str()))
                    .await
                    .or_failed(core, "delete_profile_field")?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AccountContactsParams {}

impl Handler for AccountContactsParams {
    /// The account's email addresses.
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, RpcError> {
        Ok(core
            .client()
            .await?
            .account()
            .get_3pids()
            .await
            .or_failed(core, "account_contacts")?
            .threepids
            .into_iter()
            .filter(|identifier| identifier.medium.as_str() == "email")
            .map(|identifier| identifier.address)
            .collect())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct IgnoredUsersParams {}

impl Handler for IgnoredUsersParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, RpcError> {
        let mut users = core
            .client()
            .await?
            .subscribe_to_ignore_user_list_changes()
            .get();
        users.sort();

        Ok(users.iter().map(ToString::to_string).collect())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct InviteTriageParams {}

impl Handler for InviteTriageParams {
    type Ok = Vec<InviteTriageView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<InviteTriageView>, RpcError> {
        Ok(crate::invites::triage(&core.client().await?).await)
    }
}

/// `m.direct` is client-owned account data. Nothing else will correct it.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetDirectParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub direct: bool,
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub user_id: Option<OwnedUserId>,
}

impl Handler for SetDirectParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.set_direct(&self.room_id, self.direct, self.user_id)
            .await
    }
}

/// Server-side, so it survives a reinstall.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct IgnoreUserParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
}

impl Handler for IgnoreUserParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.client()
            .await?
            .account()
            .ignore_user(&self.user_id)
            .await
            .or_failed(core, "ignore_user")
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UnignoreUserParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
}

impl Handler for UnignoreUserParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.client()
            .await?
            .account()
            .unignore_user(&self.user_id)
            .await
            .or_failed(core, "unignore_user")
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ReportUserParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    pub reason: String,
}

impl Handler for ReportUserParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.report_user(self.user_id, self.reason).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetPresenceParams {
    pub presence: PresenceView,
    pub status_message: Option<String>,
}

impl Handler for SetPresenceParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.set_desired_presence(self.presence);

        core.client()
            .await?
            .set_presence(presence::state(self.presence), self.status_message, true)
            .await
            .or_failed(core, "set_presence")
    }
}

/// Fills in users the presence poll has not pushed yet.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct FetchPresenceParams {
    #[cfg_attr(feature = "typegen", specta(type = Vec<String>))]
    pub user_ids: Vec<OwnedUserId>,
}

impl Handler for FetchPresenceParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.fetch_presence(self.user_ids).await;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SearchUserDirectoryParams {
    pub term: String,
    #[serde(default)]
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SearchUserDirectoryOk {
    pub limited: bool,
    pub results: Vec<UserDirectoryEntryView>,
}

impl Handler for SearchUserDirectoryParams {
    type Ok = SearchUserDirectoryOk;

    async fn run(self, core: &Arc<Core>) -> Result<SearchUserDirectoryOk, RpcError> {
        let (limited, results) = core.search_user_directory(&self.term, self.limit).await?;
        Ok(SearchUserDirectoryOk { limited, results })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DismissedInvitesParams {}

impl Handler for DismissedInvitesParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, RpcError> {
        Ok(room_id_strings(core.dismissed_invites().await?))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetInviteDismissedParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub dismissed: bool,
}

impl Handler for SetInviteDismissedParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, RpcError> {
        Ok(room_id_strings(
            core.set_invite_dismissed(self.room_id, self.dismissed)
                .await?,
        ))
    }
}

fn room_id_strings(room_ids: Vec<OwnedRoomId>) -> Vec<String> {
    room_ids.into_iter().map(String::from).collect()
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct BookmarksParams {}

impl Handler for BookmarksParams {
    type Ok = Vec<BookmarkView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<BookmarkView>, RpcError> {
        core.bookmarks().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetBookmarkParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub event_id: OwnedEventId,
    pub bookmarked: bool,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Number))]
    pub now_ms: u64,
}

impl Handler for SetBookmarkParams {
    /// Whether the event is bookmarked now.
    type Ok = bool;

    async fn run(self, core: &Arc<Core>) -> Result<bool, RpcError> {
        core.set_bookmark(&self.room_id, &self.event_id, self.bookmarked, self.now_ms)
            .await
    }
}

/// The room's own config when `room_id` is set, the account's otherwise.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct MediaPreviewConfigParams {
    #[serde(default)]
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub room_id: Option<OwnedRoomId>,
}

impl Handler for MediaPreviewConfigParams {
    type Ok = MediaPreviewConfigView;

    async fn run(self, core: &Arc<Core>) -> Result<MediaPreviewConfigView, RpcError> {
        core.media_preview_settings(self.room_id.as_ref()).await
    }
}

/// Merges into the account's config; a field left `None` is kept.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetMediaPreviewConfigParams {
    pub config: MediaPreviewConfigView,
}

impl Handler for SetMediaPreviewConfigParams {
    type Ok = MediaPreviewConfigView;

    async fn run(self, core: &Arc<Core>) -> Result<MediaPreviewConfigView, RpcError> {
        core.set_media_preview_settings(self.config).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ProfileOverridesParams {}

impl Handler for ProfileOverridesParams {
    type Ok = ProfileOverridesView;

    async fn run(self, core: &Arc<Core>) -> Result<ProfileOverridesView, RpcError> {
        core.profile_overrides().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetProfileOverrideParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    pub display_name: FieldEdit,
    pub avatar: AvatarEditView,
    pub color: FieldEdit,
}

impl Handler for SetProfileOverrideParams {
    type Ok = ProfileOverridesView;

    async fn run(self, core: &Arc<Core>) -> Result<ProfileOverridesView, RpcError> {
        let edit = OverrideEdit {
            display_name: self.display_name,
            avatar: self.avatar,
            color: self.color,
        };
        core.set_profile_override(&self.user_id, &edit).await
    }
}
