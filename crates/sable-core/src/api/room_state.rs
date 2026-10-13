use std::sync::Arc;

use matrix_sdk::ruma::OwnedRoomId;
use matrix_sdk::ruma::api::client::state::get_state_events;
use matrix_sdk::ruma::events::room::avatar::RoomAvatarEventContent;
use matrix_sdk::ruma::serde::Raw;
use serde::{Deserialize, Serialize};
use sable_model::bot_commands::BotCommand;

use super::Handler;
use crate::protocol::{
    AbbreviationView, CommandErr, HistoryVisibilityView, JoinRuleView, RoomStateEventView,
};
use crate::{Core, ResultExt};
use crate::media::mxc_uri;
use crate::room_settings::AclEdit;

domain! {
    set_room_name => SetRoomNameParams,
    set_room_topic => SetRoomTopicParams,
    set_room_avatar => SetRoomAvatarParams,
    set_room_join_rule => SetRoomJoinRuleParams,
    history_visibility => HistoryVisibilityParams,
    set_history_visibility => SetHistoryVisibilityParams,
    enable_encryption => EnableEncryptionParams,
    room_banner => RoomBannerParams,
    set_room_banner => SetRoomBannerParams,
    member_list_threshold => MemberListThresholdParams,
    set_member_list_threshold => SetMemberListThresholdParams,
    update_server_acl => UpdateServerAclParams,
    room_abbreviations => RoomAbbreviationsParams,
    set_room_abbreviations => SetRoomAbbreviationsParams,
    room_state_event => RoomStateEventParams,
    room_state_events => RoomStateEventsParams,
    room_state_events_raw => RoomStateEventsRawParams,
    room_full_state => RoomFullStateParams,
    send_state_event => SendStateEventParams,
    room_account_data => RoomAccountDataParams,
    set_room_account_data => SetRoomAccountDataParams,
    room_account_data_raw => RoomAccountDataRawParams,
    add_room_widget => AddRoomWidgetParams,
    remove_room_widget => RemoveRoomWidgetParams,
    bot_commands => BotCommandsParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomNameParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub name: Option<String>,
}

impl Handler for SetRoomNameParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        // The spec clears a name with an empty one.
        core.room(&self.room_id)
            .await?
            .set_name(self.name.unwrap_or_default())
            .await
            .map_err(|error| core.room_error("set_room_name", error))?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomTopicParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub topic: String,
}

impl Handler for SetRoomTopicParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.room(&self.room_id)
            .await?
            .set_room_topic(&self.topic)
            .await
            .map_err(|error| core.room_error("set_room_topic", error))?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomAvatarParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub url: Option<String>,
}

impl Handler for SetRoomAvatarParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let room = core.room(&self.room_id).await?;

        match self.url {
            Some(url) => {
                room.set_avatar_url(&mxc_uri(&url)?, None)
                    .await
                    .map_err(|error| core.room_error("set_room_avatar", error))?;
            }
            // State cannot be deleted, so empty content is the removal.
            None => {
                room.send_state_event(RoomAvatarEventContent::new())
                    .await
                    .map_err(|error| core.room_error("clear_room_avatar", error))?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomJoinRuleParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub rule: JoinRuleView,
}

impl Handler for SetRoomJoinRuleParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.set_room_join_rule(&self.room_id, self.rule).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct HistoryVisibilityParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for HistoryVisibilityParams {
    type Ok = HistoryVisibilityView;

    async fn run(self, core: &Arc<Core>) -> Result<HistoryVisibilityView, CommandErr> {
        core.history_visibility(&self.room_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetHistoryVisibilityParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub visibility: HistoryVisibilityView,
}

impl Handler for SetHistoryVisibilityParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.set_history_visibility(self.room_id, self.visibility)
            .await
    }
}

/// Cannot be undone.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct EnableEncryptionParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for EnableEncryptionParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.enable_encryption(self.room_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomBannerParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomBannerParams {
    type Ok = Option<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Option<String>, CommandErr> {
        core.room_banner(&self.room_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomBannerParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub url: Option<String>,
}

impl Handler for SetRoomBannerParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.set_room_banner(self.room_id, self.url.as_deref())
            .await
    }
}

/// The power level from which members are listed whatever their presence.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct MemberListThresholdParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(transparent)]
pub struct MemberListThresholdOk(
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub  Option<i64>,
);

impl Handler for MemberListThresholdParams {
    type Ok = MemberListThresholdOk;

    async fn run(self, core: &Arc<Core>) -> Result<MemberListThresholdOk, CommandErr> {
        core.member_list_threshold(&self.room_id)
            .await
            .map(MemberListThresholdOk)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetMemberListThresholdParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub always_listed_from: Option<i64>,
}

impl Handler for SetMemberListThresholdParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.set_member_list_threshold(self.room_id, self.always_listed_from)
            .await
    }
}

/// Server globs to add to and remove from each list.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UpdateServerAclParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub remove_allow: Vec<String>,
    pub remove_deny: Vec<String>,
}

impl Handler for UpdateServerAclParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let edit = AclEdit {
            allow: self.allow,
            deny: self.deny,
            remove_allow: self.remove_allow,
            remove_deny: self.remove_deny,
        };
        core.update_server_acl(self.room_id, &edit).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomAbbreviationsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomAbbreviationsParams {
    type Ok = Vec<AbbreviationView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<AbbreviationView>, CommandErr> {
        core.room_abbreviations(&self.room_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomAbbreviationsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub entries: Vec<AbbreviationView>,
}

impl Handler for SetRoomAbbreviationsParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.set_room_abbreviations(self.room_id, &self.entries)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomStateEventParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
    pub state_key: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(transparent)]
pub struct RoomStateEventOk(
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Unknown>))]
    pub  Option<serde_json::Value>,
);

impl Handler for RoomStateEventParams {
    type Ok = RoomStateEventOk;

    async fn run(self, core: &Arc<Core>) -> Result<RoomStateEventOk, CommandErr> {
        core.room_state_event_content(self.room_id, self.event_type, self.state_key)
            .await
            .map(RoomStateEventOk)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomStateEventsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
}

impl Handler for RoomStateEventsParams {
    type Ok = Vec<RoomStateEventView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<RoomStateEventView>, CommandErr> {
        core.room_state_events(&self.room_id, &self.event_type)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomStateEventsRawParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
    #[serde(default)]
    pub state_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(transparent)]
pub struct RoomStateEventsRawOk(
    #[cfg_attr(feature = "typegen", specta(type = Vec<specta_typescript::Unknown>))]
    pub  Vec<serde_json::Value>,
);

impl Handler for RoomStateEventsRawParams {
    type Ok = RoomStateEventsRawOk;

    async fn run(self, core: &Arc<Core>) -> Result<RoomStateEventsRawOk, CommandErr> {
        core.room_state_events_raw(&self.room_id, &self.event_type, self.state_key.as_deref())
            .await
            .map(RoomStateEventsRawOk)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomFullStateParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomFullStateParams {
    type Ok = RoomStateEventsRawOk;

    async fn run(self, core: &Arc<Core>) -> Result<RoomStateEventsRawOk, CommandErr> {
        let client = core.client().await?;
        let response = client
            .send(get_state_events::v3::Request::new(self.room_id))
            .await
            .or_failed(core, "room_full_state")?;
        Ok(RoomStateEventsRawOk(
            response
                .room_state
                .iter()
                .filter_map(|raw| raw.deserialize_as::<serde_json::Value>().ok())
                .collect(),
        ))
    }
}

/// Escape hatch for unmodelled state. `content` is validated only by the
/// server, so prefer a typed command.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SendStateEventParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
    pub state_key: String,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub content: serde_json::Value,
}

impl Handler for SendStateEventParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        core.send_state(self.room_id, &self.event_type, &self.state_key, &self.content)
            .await
            .map(|event_id| event_id.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomAccountDataParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(transparent)]
pub struct RoomAccountDataOk(
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Unknown>))]
    pub  Option<serde_json::Value>,
);

impl Handler for RoomAccountDataParams {
    type Ok = RoomAccountDataOk;

    async fn run(self, core: &Arc<Core>) -> Result<RoomAccountDataOk, CommandErr> {
        let event = core
            .room(&self.room_id)
            .await?
            .account_data(self.event_type.into())
            .await
            .map_err(|error| core.room_error("room_account_data", error))?;

        Ok(RoomAccountDataOk(event.and_then(|raw| {
            raw.get_field::<serde_json::Value>("content").ok().flatten()
        })))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetRoomAccountDataParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub content: serde_json::Value,
}

impl Handler for SetRoomAccountDataParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let raw = Raw::new(&self.content)
            .or_failed(core, "set_room_account_data")?
            .cast_unchecked();
        core.room(&self.room_id)
            .await?
            .set_account_data_raw(self.event_type.into(), raw)
            .await
            .map_err(|error| core.room_error("set_room_account_data", error))?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomAccountDataRawParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub event_type: String,
}

impl Handler for RoomAccountDataRawParams {
    type Ok = RoomAccountDataOk;

    async fn run(self, core: &Arc<Core>) -> Result<RoomAccountDataOk, CommandErr> {
        core.room_account_data_raw(&self.room_id, &self.event_type)
            .await
            .map(RoomAccountDataOk)
    }
}

/// A custom widget whose URL is given the template variables hosts fill in.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AddRoomWidgetParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub name: String,
    pub url: String,
}

impl Handler for AddRoomWidgetParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        core.add_room_widget(self.room_id, &self.name, &self.url)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RemoveRoomWidgetParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub widget_id: String,
}

impl Handler for RemoveRoomWidgetParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.remove_room_widget(self.room_id, &self.widget_id)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct BotCommandsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for BotCommandsParams {
    type Ok = Vec<BotCommand>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<BotCommand>, CommandErr> {
        let client = core.client().await?;
        let room = core.room(&self.room_id).await?;
        core.bot_commands_for(&client, &room)
            .await
            .map_err(|error| core.room_error("bot_commands", error))
    }
}
