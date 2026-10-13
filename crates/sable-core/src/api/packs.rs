use std::sync::Arc;

use matrix_sdk::ruma::OwnedRoomId;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::Core;
use crate::protocol::{RpcError, ImagePackView, PackAddressView, PackDraftView, PackImageDraftView};

domain! {
    list,
    list_all,
    save,
    create_room_pack,
    delete_room_pack,
    convert_legacy,
    remove_legacy,
    add_account_images,
    subscriptions,
    set_subscriptions,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PackTargetView {
    Room {
        #[cfg_attr(feature = "typegen", specta(type = String))]
        room_id: OwnedRoomId,
        state_key: String,
    },
    /// `im.ponies.user_emotes`, the account's own pack.
    Account,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct ListParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[serde(default)]
    pub cached_only: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct ListOk {
    pub packs: Vec<ImagePackView>,
    pub complete: bool,
}

impl Handler for ListParams {
    type Ok = ListOk;

    async fn run(self, core: &Arc<Core>) -> Result<ListOk, RpcError> {
        core.image_packs(self.room_id, self.cached_only).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct ListAllParams {}

impl Handler for ListAllParams {
    type Ok = Vec<ImagePackView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<ImagePackView>, RpcError> {
        core.all_image_packs().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct SaveParams {
    pub target: PackTargetView,
    pub draft: PackDraftView,
}

impl Handler for SaveParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.save_image_pack(self.target, &self.draft).await
    }
}

/// The state key is derived from the name and kept unique in the room.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct CreateRoomPackParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub name: String,
}

impl Handler for CreateRoomPackParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, RpcError> {
        core.create_room_image_pack(self.room_id, &self.name)
            .await
    }
}

/// Clears the legacy copy too, or the pack would come back from it.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct DeleteRoomPackParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub state_key: String,
}

impl Handler for DeleteRoomPackParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.delete_room_image_pack(self.room_id, &self.state_key)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct ConvertLegacyParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub state_keys: Vec<String>,
}

impl Handler for ConvertLegacyParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.convert_legacy_image_packs(&self.room_id, &self.state_keys)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct RemoveLegacyParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub state_keys: Vec<String>,
}

impl Handler for RemoveLegacyParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.remove_legacy_image_packs(&self.room_id, &self.state_keys)
            .await
    }
}

/// Merges into the account pack, renaming a shortcode that is taken.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct AddAccountImagesParams {
    pub images: Vec<PackImageDraftView>,
}

impl Handler for AddAccountImagesParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.add_account_pack_images(&self.images).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct SubscriptionsParams {}

impl Handler for SubscriptionsParams {
    type Ok = Vec<PackAddressView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<PackAddressView>, RpcError> {
        core.pack_subscriptions().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type), specta(inline))]
pub struct SetSubscriptionsParams {
    pub added: Vec<PackAddressView>,
    pub removed: Vec<PackAddressView>,
}

impl Handler for SetSubscriptionsParams {
    type Ok = Vec<PackAddressView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<PackAddressView>, RpcError> {
        core.set_pack_subscriptions(&self.added, &self.removed)
            .await
    }
}
