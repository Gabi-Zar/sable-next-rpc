use std::sync::Arc;

use matrix_sdk::ruma::OwnedRoomId;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::Core;
use crate::protocol::{
    CommandErr, ImagePackView, PackAddressView, PackDraftView, PackImageDraftView, PackTargetView,
};

domain! {
    image_packs => ImagePacksParams,
    all_image_packs => AllImagePacksParams,
    save_image_pack => SaveImagePackParams,
    create_room_image_pack => CreateRoomImagePackParams,
    delete_room_image_pack => DeleteRoomImagePackParams,
    convert_legacy_image_packs => ConvertLegacyImagePacksParams,
    remove_legacy_image_packs => RemoveLegacyImagePacksParams,
    add_account_pack_images => AddAccountPackImagesParams,
    pack_subscriptions => PackSubscriptionsParams,
    set_pack_subscriptions => SetPackSubscriptionsParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ImagePacksParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[serde(default)]
    pub cached_only: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ImagePacksOk {
    pub packs: Vec<ImagePackView>,
    pub complete: bool,
}

impl Handler for ImagePacksParams {
    type Ok = ImagePacksOk;

    async fn run(self, core: &Arc<Core>) -> Result<ImagePacksOk, CommandErr> {
        core.image_packs(self.room_id, self.cached_only).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AllImagePacksParams {}

impl Handler for AllImagePacksParams {
    type Ok = Vec<ImagePackView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<ImagePackView>, CommandErr> {
        core.all_image_packs().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SaveImagePackParams {
    pub target: PackTargetView,
    pub draft: PackDraftView,
}

impl Handler for SaveImagePackParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.save_image_pack(self.target, &self.draft).await
    }
}

/// The state key is derived from the name and kept unique in the room.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CreateRoomImagePackParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub name: String,
}

impl Handler for CreateRoomImagePackParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        core.create_room_image_pack(self.room_id, &self.name)
            .await
    }
}

/// Clears the legacy copy too, or the pack would come back from it.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DeleteRoomImagePackParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub state_key: String,
}

impl Handler for DeleteRoomImagePackParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.delete_room_image_pack(self.room_id, &self.state_key)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ConvertLegacyImagePacksParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub state_keys: Vec<String>,
}

impl Handler for ConvertLegacyImagePacksParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.convert_legacy_image_packs(&self.room_id, &self.state_keys)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RemoveLegacyImagePacksParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    pub state_keys: Vec<String>,
}

impl Handler for RemoveLegacyImagePacksParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.remove_legacy_image_packs(&self.room_id, &self.state_keys)
            .await
    }
}

/// Merges into the account pack, renaming a shortcode that is taken.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AddAccountPackImagesParams {
    pub images: Vec<PackImageDraftView>,
}

impl Handler for AddAccountPackImagesParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.add_account_pack_images(&self.images).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PackSubscriptionsParams {}

impl Handler for PackSubscriptionsParams {
    type Ok = Vec<PackAddressView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<PackAddressView>, CommandErr> {
        core.pack_subscriptions().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetPackSubscriptionsParams {
    pub added: Vec<PackAddressView>,
    pub removed: Vec<PackAddressView>,
}

impl Handler for SetPackSubscriptionsParams {
    type Ok = Vec<PackAddressView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<PackAddressView>, CommandErr> {
        core.set_pack_subscriptions(&self.added, &self.removed)
            .await
    }
}
