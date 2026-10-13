use std::future::{self, Future};
use std::sync::Arc;

use matrix_sdk::ruma::OwnedRoomId;
use serde::Deserialize;

use super::Handler;
use crate::Core;
use crate::protocol::{RpcError, PersonaCatalogView, PersonaView};

domain! {
    personas,
    save_persona,
    remove_persona,
    reorder_personas,
    set_persona_selection,
    disable_room_personas,
    persona_backup,
    check_persona_backup,
    restore_persona_backup,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PersonasParams {}

impl Handler for PersonasParams {
    type Ok = PersonaCatalogView;

    async fn run(self, core: &Arc<Core>) -> Result<PersonaCatalogView, RpcError> {
        core.personas().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SavePersonaParams {
    pub persona: PersonaView,
    #[serde(default)]
    pub previous_id: Option<String>,
}

impl Handler for SavePersonaParams {
    type Ok = Vec<PersonaView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<PersonaView>, RpcError> {
        core.save_persona(self.persona, self.previous_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RemovePersonaParams {
    pub id: String,
}

impl Handler for RemovePersonaParams {
    type Ok = Vec<PersonaView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<PersonaView>, RpcError> {
        core.remove_persona(&self.id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ReorderPersonasParams {
    pub ids: Vec<String>,
}

impl Handler for ReorderPersonasParams {
    type Ok = Vec<PersonaView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<PersonaView>, RpcError> {
        core.reorder_personas(self.ids).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetPersonaSelectionParams {
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub room_id: Option<OwnedRoomId>,
    pub persona_id: Option<String>,
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub valid_until: Option<u64>,
}

impl Handler for SetPersonaSelectionParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.set_persona_selection(self.room_id, self.persona_id, self.valid_until)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DisableRoomPersonasParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for DisableRoomPersonasParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.disable_room_personas(self.room_id).await
    }
}

/// The persona catalog as a backup file's text.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PersonaBackupParams {}

impl Handler for PersonaBackupParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, RpcError> {
        core.persona_backup().await
    }
}

/// Refuses a file that is not a persona backup, without touching anything.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CheckPersonaBackupParams {
    pub backup: String,
}

impl Handler for CheckPersonaBackupParams {
    type Ok = ();

    fn run(self, _core: &Arc<Core>) -> impl Future<Output = Result<(), RpcError>> {
        future::ready(Core::check_persona_backup(&self.backup))
    }
}

/// Replaces the persona catalog with the one in a backup file.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RestorePersonaBackupParams {
    pub backup: String,
}

impl Handler for RestorePersonaBackupParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), RpcError> {
        core.restore_persona_backup(&self.backup).await
    }
}
