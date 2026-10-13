use std::sync::Arc;

use matrix_sdk::ruma::{OwnedRoomId, RoomId};
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::protocol::{RpcError, SidebarItemView, SpaceHierarchyRoomView, SpaceParentView};
use crate::{Core, view};

domain! {
    add_to_space,
    set_space_child_order,
    set_space_child_suggested,
    space_hierarchy,
    remove_from_space,
    space_sidebar,
    set_space_sidebar,
    room_has_space_parent,
    unjoined_space_parents,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AddToSpaceParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub space_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub suggested: Option<bool>,
}

impl Handler for AddToSpaceParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.add_to_space(&self.space_id, &self.room_id, self.suggested)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetSpaceChildOrderParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub space_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub order: Option<String>,
}

impl Handler for SetSpaceChildOrderParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.set_space_child_order(&self.space_id, &self.room_id, self.order)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetSpaceChildSuggestedParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub space_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub suggested: bool,
}

impl Handler for SetSpaceChildSuggestedParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.set_space_child_suggested(&self.space_id, &self.room_id, self.suggested)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SpaceHierarchyParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub space_id: OwnedRoomId,
    pub from: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SpaceHierarchyOk {
    pub rooms: Vec<SpaceHierarchyRoomView>,
    /// Pass back as `from` for the next page; `null` at the end.
    pub next_batch: Option<String>,
}

impl Handler for SpaceHierarchyParams {
    type Ok = SpaceHierarchyOk;

    async fn run(self, core: &Arc<Core>) -> Result<SpaceHierarchyOk, RpcError> {
        core.space_hierarchy(&self.space_id, self.from).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RemoveFromSpaceParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub space_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RemoveFromSpaceParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        // The spec delists by omitting `via`. The typed content has it
        // non-optional and would send `{"via": []}`, a valid array.
        core.room(&self.space_id)
            .await?
            .send_state_event_raw(
                "m.space.child",
                self.room_id.as_str(),
                &serde_json::Value::Object(serde_json::Map::new()),
            )
            .await
            .map_err(|error| core.room_error("remove_from_space", error))?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SpaceSidebarParams {}

impl Handler for SpaceSidebarParams {
    type Ok = Vec<SidebarItemView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<SidebarItemView>, RpcError> {
        core.space_sidebar().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetSpaceSidebarParams {
    pub items: Vec<SidebarItemView>,
}

impl Handler for SetSpaceSidebarParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        if sable_model::sidebar::layout_space_ids(&self.items)
            .iter()
            .any(|room_id| RoomId::parse(room_id).is_err())
        {
            return Err(RpcError::UnknownRoom);
        }
        core.set_space_sidebar(&self.items).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RoomHasSpaceParentParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for RoomHasSpaceParentParams {
    type Ok = bool;

    async fn run(self, core: &Arc<Core>) -> Result<bool, RpcError> {
        let client = core.client().await?;
        let room = core.room(&self.room_id).await?;
        Ok(!view::restricted_parents(&client, &room).await.is_empty())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UnjoinedSpaceParentsParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for UnjoinedSpaceParentsParams {
    type Ok = Vec<SpaceParentView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<SpaceParentView>, RpcError> {
        let client = core.client().await?;
        let room = core.room(&self.room_id).await?;
        Ok(crate::cosmetics::unjoined_space_parents(&client, &room).await)
    }
}
