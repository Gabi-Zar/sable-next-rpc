use std::sync::Arc;

use matrix_sdk::ruma::api::client::alias::{create_alias, delete_alias};
use matrix_sdk::ruma::api::client::directory::{get_room_visibility, set_room_visibility};
use matrix_sdk::ruma::api::client::discovery::get_capabilities;
use matrix_sdk::ruma::api::client::discovery::get_capabilities::v3::RoomVersionStability;
use matrix_sdk::ruma::api::client::room::Visibility;
use matrix_sdk::ruma::api::client::room::aliases;
use matrix_sdk::ruma::api::client::room::create_room::{self, v3::RoomPreset};
use matrix_sdk::ruma::api::client::room::upgrade_room;
use matrix_sdk::ruma::events::InitialStateEvent;
use matrix_sdk::ruma::events::room::create::{PreviousRoom, RoomCreateEventContent};
use matrix_sdk::ruma::events::room::encryption::RoomEncryptionEventContent;
use matrix_sdk::ruma::events::tag::{TagInfo, TagName};
use matrix_sdk::ruma::room::RoomType;
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::{
    OwnedRoomId, OwnedUserId, RoomAliasId, RoomOrAliasId, RoomVersionId, ServerName,
};
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::api::support::{
    MAX_SEARCH_RESULTS, StateEventOut, join_rule_content, voice_power_level_override,
};
use crate::protocol::{
    CommandErr, CreateJoinRuleView, CreateRoomKind, DirectoryRoomType, PublicRoomView,
    RoomAttachmentKind, RoomAttachmentView, RoomCosmeticsView, RoomOpenView, RoomPreviewView,
    RoomListItemView, RoomTag, RoomVersionView, RoomVersionsView,
};
use crate::{Core, ResultExt, power_levels, view};

const WIDGETS_EVENT_TYPE: &str = "im.vector.modular.widgets";

domain! {
    room_open => RoomOpenParams,
    room_list_item => RoomListItemParams,
    room_preview => RoomPreviewParams,
    join_room => JoinRoomParams,
    knock_room => KnockRoomParams,
    room_via_servers => RoomViaServersParams,
    leave_room => LeaveRoomParams,
    invite_user => InviteUserParams,
    create_room => CreateRoomParams,
    create_dm => CreateDmParams,
    room_versions => RoomVersionsParams,
    upgrade_room => UpgradeRoomParams,
    public_rooms => PublicRoomsParams,
    room_directory_visibility => RoomDirectoryVisibilityParams,
    set_room_directory_visibility => SetRoomDirectoryVisibilityParams,
    room_aliases => RoomAliasesParams,
    create_room_alias => CreateRoomAliasParams,
    delete_room_alias => DeleteRoomAliasParams,
    canonical_alias => CanonicalAliasParams,
    set_canonical_alias => SetCanonicalAliasParams,
    replaced_rooms => ReplacedRoomsParams,
    set_tombstone => SetTombstoneParams,
    report_room => ReportRoomParams,
    set_room_tag => SetRoomTagParams,
    room_attachments => RoomAttachmentsParams,
    room_cosmetics => RoomCosmeticsParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomOpenParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomOpenParams {
    type Ok = RoomOpenView;

    async fn run(self, core: &Arc<Core>) -> Result<RoomOpenView, CommandErr> {
        let room_id = self.room_id;
        let (permissions, power_level_tags, widgets, pinned_event_ids) = futures_util::join!(
            core.room_permissions(&room_id),
            core.room_state_event_content(
                room_id.clone(),
                power_levels::TAGS_EVENT.to_owned(),
                String::new(),
            ),
            core.room_state_events(&room_id, WIDGETS_EVENT_TYPE),
            core.pinned_events(&room_id),
        );
        if pinned_event_ids.as_ref().is_ok_and(|ids| !ids.is_empty()) {
            core.watch_pinned(&room_id).await;
        }
        let predecessor = core
            .room(&room_id)
            .await
            .ok()
            .and_then(|room| view::predecessor(&room));
        Ok(RoomOpenView {
            permissions: permissions?,
            power_level_tags: power_levels::parse_tags(
                power_level_tags
                    .unwrap_or_else(|error| {
                        tracing::warn!(?error, "power level tags unavailable");
                        None
                    })
                    .as_ref(),
            ),
            widgets: widgets.unwrap_or_else(|error| {
                tracing::warn!(?error, "widgets unavailable");
                Vec::new()
            }),
            pinned_event_ids: pinned_event_ids.unwrap_or_else(|error| {
                tracing::warn!(?error, "pinned events unavailable");
                Vec::new()
            }),
            predecessor,
        })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomListItemParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomListItemParams {
    type Ok = RoomListItemView;

    async fn run(self, core: &Arc<Core>) -> Result<RoomListItemView, CommandErr> {
        let room = core.room(&self.room_id).await?;
        Ok(view::listless_room_list_item(room, &core.push_rules().await?.snapshot().await).await)
    }
}

/// Accepting an invite is `JoinRoom`, declining it `LeaveRoom`.
///
/// Describes a room this account has not joined, so a link to one can be
/// shown before committing to the join.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomPreviewParams {
    /// A room id or an alias, as `JoinRoom` takes.
    pub address: String,
    /// Servers to try when the id is not resolvable on ours, or empty.
    pub via: Vec<String>,
}

impl Handler for RoomPreviewParams {
    type Ok = RoomPreviewView;

    async fn run(self, core: &Arc<Core>) -> Result<RoomPreviewView, CommandErr> {
        core.room_preview(&self.address, &self.via).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct JoinRoomParams {
    /// A room id or an alias. A pasted address could be either.
    pub address: String,
    /// Servers to try when the id is not resolvable on ours, or empty.
    pub via: Vec<String>,
}

impl Handler for JoinRoomParams {
    /// Resolved, since the caller may have joined by alias.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        let address = RoomOrAliasId::parse(&self.address).map_err(|_| CommandErr::UnknownRoom)?;

        let via = self
            .via
            .iter()
            .filter_map(|server| ServerName::parse(server).ok())
            .collect::<Vec<_>>();

        let room = core
            .client()
            .await?
            .join_room_by_id_or_alias(&address, &via)
            .await
            .map_err(|error| core.room_error("join_room", error))?;

        Ok(room.room_id().to_string())
    }
}

/// Asks to be let into a `knock` room. A separate endpoint from joining, and
/// the only one that works when the join rule is `knock`.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct KnockRoomParams {
    pub address: String,
    pub via: Vec<String>,
    pub reason: Option<String>,
}

impl Handler for KnockRoomParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        core.knock_room(&self.address, &self.via, self.reason)
            .await
            .map(|room_id| room_id.to_string())
    }
}

/// The servers to advertise in a permalink to this room, per the routing
/// rules in the spec appendices. Empty when the room has a canonical alias,
/// which is routable on its own.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomViaServersParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomViaServersParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, CommandErr> {
        let room = core.room(&self.room_id).await?;
        core.room_via_servers(&room).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct LeaveRoomParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for LeaveRoomParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.room(&self.room_id)
            .await?
            .leave()
            .await
            .map_err(|error| core.room_error("leave_room", error))?;

        // Keeping it would hand a stale timeline back on rejoin.
        core.timelines.lock().await.remove(&self.room_id);

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct InviteUserParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
}

impl Handler for InviteUserParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.room(&self.room_id)
            .await?
            .invite_user_by_id(&self.user_id)
            .await
            .map_err(|error| core.room_error("invite_user", error))?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CreateRoomParams {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub kind: CreateRoomKind,
    /// Published in the directory, joinable by link.
    pub public: bool,
    /// Ignored for a space or a public room.
    pub encrypted: bool,
    #[cfg_attr(feature = "typegen", specta(type = Vec<String>))]
    pub invite: Vec<OwnedUserId>,
    /// Adds an `m.space.child` edge from this space.
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub parent_space: Option<OwnedRoomId>,
    pub alias: Option<String>,
    pub room_version: Option<String>,
    pub join_rule: Option<CreateJoinRuleView>,
    pub federate: bool,
    #[serde(default)]
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub predecessor: Option<OwnedRoomId>,
}

impl Handler for CreateRoomParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        let client = core.client().await?;
        let mut request = create_room::v3::Request::new();
        request.name = self.name;
        request.topic = self.topic;
        request.invite = self.invite;
        request.room_alias_name = self.alias;
        request.room_version = self.room_version
            .map(RoomVersionId::try_from)
            .transpose()
            .or_failed(core, "create_room_room_version")?;
        request.visibility = if self.public {
            Visibility::Public
        } else {
            Visibility::Private
        };
        request.preset = Some(if self.public {
            RoomPreset::PublicChat
        } else {
            RoomPreset::PrivateChat
        });

        let room_type = match self.kind {
            CreateRoomKind::Text => None,
            CreateRoomKind::Space => Some(RoomType::Space),
            CreateRoomKind::Voice => Some(RoomType::Call),
            CreateRoomKind::Forum => Some(RoomType::from(view::FORUM_ROOM_TYPE)),
            CreateRoomKind::Calendar => Some(RoomType::from(crate::calendar::CALENDAR_ROOM_TYPE)),
        };
        if room_type.is_some() || !self.federate || self.predecessor.is_some() {
            let mut creation = RoomCreateEventContent::new_v11();
            creation.room_type = room_type;
            creation.federate = self.federate;
            creation.predecessor = self.predecessor.map(PreviousRoom::new);
            request.creation_content = Some(
                Raw::new(&creation)
                    .or_failed(core, "create_room_creation_content")?
                    .cast_unchecked(),
            );
        }

        if let Some(rule) = join_rule_content(self.join_rule, self.parent_space.as_deref()) {
            request.initial_state.push(rule.to_raw_any());
        }

        if matches!(self.kind, CreateRoomKind::Voice) {
            // The override is a shallow merge: naming `events` drops the
            // server's default map, so it is re-stated.
            request.power_level_content_override = Some(
                Raw::new(&voice_power_level_override())
                    .or_failed(core, "create_room_call_power_levels")?
                    .cast_unchecked(),
            );
            request.initial_state.push(
                Raw::new(&StateEventOut {
                    kind: view::CALL_TYPE,
                    state_key: "",
                    content: crate::room_settings::EmptyContent {},
                })
                .or_failed(core, "create_room_call_state")?
                .cast_unchecked(),
            );
            request.initial_state.push(
                Raw::new(&StateEventOut {
                    kind: view::RTC_SLOT_TYPE,
                    state_key: view::CALL_SLOT_ID,
                    content: crate::calls::OpenSlot::new(self.encrypted && !self.public),
                })
                .or_failed(core, "create_room_call_slot")?
                .cast_unchecked(),
            );
        }

        // Anyone can join and read a public room, so encryption only
        // breaks previews.
        if self.encrypted && !self.public {
            request.initial_state.push(
                InitialStateEvent::with_empty_state_key(
                    RoomEncryptionEventContent::with_recommended_defaults(),
                )
                .to_raw_any(),
            );
        }

        let room = client
            .create_room(request)
            .await
            .or_failed(core, "create_room")?;

        if matches!(self.kind, CreateRoomKind::Calendar)
            && let Err(error) = core.calendar_id(&room).await
        {
            tracing::warn!(?error, "calendar setup failed");
        }

        if let Some(space_id) = self.parent_space {
            core.add_to_space(&space_id, room.room_id(), None).await?;
        }

        Ok(room.room_id().to_string())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CreateDmParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    #[serde(default)]
    pub encrypted: Option<bool>,
}

impl Handler for CreateDmParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        let Self { user_id, encrypted } = self;
        let client = core.client().await?;
        let existing = client.get_dm_rooms(&user_id).find(|room| {
            !room.is_tombstoned()
                && encrypted.is_none_or(|wanted| room.encryption_state().is_encrypted() == wanted)
        });
        let room = match existing {
            Some(room) => room,
            None if encrypted == Some(false) => {
                let mut request = create_room::v3::Request::new();
                request.invite = vec![user_id];
                request.is_direct = true;
                request.preset = Some(RoomPreset::TrustedPrivateChat);
                client
                    .create_room(request)
                    .await
                    .or_failed(core, "create_dm")?
            }
            None => client
                .create_dm(&user_id)
                .await
                .or_failed(core, "create_dm")?,
        };

        Ok(room.room_id().to_string())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomVersionsParams {}

impl Handler for RoomVersionsParams {
    type Ok = RoomVersionsView;

    async fn run(self, core: &Arc<Core>) -> Result<RoomVersionsView, CommandErr> {
        let response = core
            .client()
            .await?
            .send(get_capabilities::v3::Request::new())
            .await
            .or_failed(core, "room_versions")?;

        let versions = response.capabilities.room_versions;
        Ok(RoomVersionsView {
            default: versions.default.to_string(),
            available: versions
                .available
                .into_iter()
                .map(|(id, stability)| RoomVersionView {
                    id: id.to_string(),
                    stable: stability == RoomVersionStability::Stable,
                })
                .collect(),
        })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UpgradeRoomParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub new_version: String,
    #[cfg_attr(feature = "typegen", specta(type = Vec<String>))]
    pub additional_creators: Vec<OwnedUserId>,
}

impl Handler for UpgradeRoomParams {
    /// The replacement room.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        let mut request = upgrade_room::v3::Request::new(
            self.room_id,
            RoomVersionId::try_from(self.new_version).or_failed(core, "upgrade_room")?,
        );
        request.additional_creators = self.additional_creators;

        let client = core.client().await?;
        let old_room = request.room_id.clone();
        let response = client
            .send(request)
            .await
            .map_err(|error| core.room_error("upgrade_room", error.into()))?;
        core.copy_room_packs(&client, &old_room, &response.replacement_room)
            .await;

        Ok(response.replacement_room.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PublicRoomsParams {
    pub server: Option<String>,
    pub search: Option<String>,
    pub since: Option<String>,
    pub room_type: Option<DirectoryRoomType>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PublicRoomsOk {
    pub rooms: Vec<PublicRoomView>,
    pub next_batch: Option<String>,
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub total: Option<u64>,
}

impl Handler for PublicRoomsParams {
    type Ok = PublicRoomsOk;

    async fn run(self, core: &Arc<Core>) -> Result<PublicRoomsOk, CommandErr> {
        core.public_rooms(self.server, self.search, self.since, self.room_type)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomDirectoryVisibilityParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomDirectoryVisibilityParams {
    /// Whether the room is published.
    type Ok = bool;

    async fn run(self, core: &Arc<Core>) -> Result<bool, CommandErr> {
        let response = core
            .client()
            .await?
            .send(get_room_visibility::v3::Request::new(self.room_id))
            .await
            .map_err(|error| core.room_error("room_directory_visibility", error.into()))?;

        Ok(response.visibility == Visibility::Public)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomDirectoryVisibilityParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub public: bool,
}

impl Handler for SetRoomDirectoryVisibilityParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let visibility = if self.public {
            Visibility::Public
        } else {
            Visibility::Private
        };

        core.client()
            .await?
            .send(set_room_visibility::v3::Request::new(
                self.room_id,
                visibility,
            ))
            .await
            .map_err(|error| core.room_error("set_room_directory_visibility", error.into()))?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomAliasesParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomAliasesParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, CommandErr> {
        let response = core
            .client()
            .await?
            .send(aliases::v3::Request::new(self.room_id))
            .await
            .map_err(|error| core.room_error("room_aliases", error.into()))?;

        Ok(response
            .aliases
            .into_iter()
            .map(|alias| alias.to_string())
            .collect())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CreateRoomAliasParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub alias: String,
}

impl Handler for CreateRoomAliasParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let alias = RoomAliasId::parse(self.alias).or_failed(core, "create_room_alias")?;

        core.client()
            .await?
            .send(create_alias::v3::Request::new(alias, self.room_id))
            .await
            .map_err(|error| core.room_error("create_room_alias", error.into()))?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DeleteRoomAliasParams {
    pub alias: String,
}

impl Handler for DeleteRoomAliasParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let alias = RoomAliasId::parse(self.alias).or_failed(core, "delete_room_alias")?;

        core.client()
            .await?
            .send(delete_alias::v3::Request::new(alias))
            .await
            .map_err(|error| core.room_error("delete_room_alias", error.into()))?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CanonicalAliasParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CanonicalAliasOk {
    pub alias: Option<String>,
    pub alt_aliases: Vec<String>,
}

impl Handler for CanonicalAliasParams {
    type Ok = CanonicalAliasOk;

    async fn run(self, core: &Arc<Core>) -> Result<CanonicalAliasOk, CommandErr> {
        let (alias, alt_aliases) = core.canonical_alias(&self.room_id).await?;
        Ok(CanonicalAliasOk { alias, alt_aliases })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetCanonicalAliasParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub alias: Option<String>,
    pub alt_aliases: Vec<String>,
}

impl Handler for SetCanonicalAliasParams {
    type Ok = CanonicalAliasOk;

    async fn run(self, core: &Arc<Core>) -> Result<CanonicalAliasOk, CommandErr> {
        let (alias, alt_aliases) = core
            .set_canonical_alias(self.room_id, self.alias.as_deref(), &self.alt_aliases)
            .await?;
        Ok(CanonicalAliasOk { alias, alt_aliases })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ReplacedRoomsParams {}

impl Handler for ReplacedRoomsParams {
    type Ok = Vec<RoomListItemView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<RoomListItemView>, CommandErr> {
        let client = core.client().await?;
        let rules = core.push_rules().await?.snapshot().await;
        let mut rooms = Vec::new();
        for room in client.joined_rooms() {
            if room.is_tombstoned() {
                rooms.push(view::listless_room_list_item(room, &rules).await);
            }
        }
        Ok(rooms)
    }
}

/// Points readers of this room at `replacement_room` without upgrading it.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetTombstoneParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub replacement_room: OwnedRoomId,
    pub body: String,
}

impl Handler for SetTombstoneParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.set_tombstone(self.room_id, &self.replacement_room, &self.body)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ReportRoomParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub reason: String,
}

impl Handler for ReportRoomParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.report_room(self.room_id, self.reason).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomTagParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub tag: RoomTag,
    /// False removes it.
    pub set: bool,
}

impl Handler for SetRoomTagParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let room = core.room(&self.room_id).await?;
        let name = match self.tag {
            RoomTag::Favourite => TagName::Favorite,
        };

        if self.set {
            room.set_tag(name, TagInfo::new())
                .await
                .map_err(|error| core.room_error("set_room_tag", error))?;
        } else {
            room.remove_tag(name)
                .await
                .map_err(|error| core.room_error("remove_room_tag", error))?;
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomAttachmentsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub kind: RoomAttachmentKind,
    pub limit: u32,
    pub from: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomAttachmentsOk {
    pub items: Vec<RoomAttachmentView>,
    pub next_batch: Option<String>,
}

impl Handler for RoomAttachmentsParams {
    type Ok = RoomAttachmentsOk;

    async fn run(self, core: &Arc<Core>) -> Result<RoomAttachmentsOk, CommandErr> {
        let (items, next_batch) = core
            .room_attachments(
                &self.room_id,
                self.kind,
                (self.limit as usize).min(MAX_SEARCH_RESULTS),
                self.from.as_deref(),
            )
            .await?;
        Ok(RoomAttachmentsOk { items, next_batch })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomCosmeticsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[serde(default)]
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub space_id: Option<OwnedRoomId>,
}

impl Handler for RoomCosmeticsParams {
    type Ok = RoomCosmeticsView;

    async fn run(self, core: &Arc<Core>) -> Result<RoomCosmeticsView, CommandErr> {
        core.room_cosmetics(&self.room_id, self.space_id).await
    }
}
