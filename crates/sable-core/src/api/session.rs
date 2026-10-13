use std::sync::Arc;
use std::sync::atomic::Ordering;

use matrix_sdk::ruma::OwnedRoomId;
use matrix_sdk::ruma::api::federation::discovery::get_server_version;
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::protocol::{
    CommandErr, HomeserverSoftwareView, OpenIdTokenView, SearchTuning, SessionInfo, SyncStatus,
};
use crate::{Core, ResultExt};

domain! {
    restore => RestoreParams,
    list_accounts => ListAccountsParams,
    switch_account => SwitchAccountParams,
    remove_account => RemoveAccountParams,
    logout => LogoutParams,
    reset_local_cache => ResetLocalCacheParams,
    homeserver_info => HomeserverInfoParams,
    request_open_id_token => RequestOpenIdTokenParams,
    access_token => AccessTokenParams,
    open_id_token => OpenIdTokenParams,
    sync_status => SyncStatusParams,
    server_features => ServerFeaturesParams,
    delayed_events_supported => DelayedEventsSupportedParams,
    set_search_options => SetSearchOptionsParams,
    set_read_room => SetReadRoomParams,
    integration_manager_url => IntegrationManagerUrlParams,
    known_rooms => KnownRoomsParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RestoreParams {}

impl Handler for RestoreParams {
    type Ok = Option<SessionInfo>;

    async fn run(self, core: &Arc<Core>) -> Result<Option<SessionInfo>, CommandErr> {
        core.restore().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ListAccountsParams {}

impl Handler for ListAccountsParams {
    type Ok = Vec<SessionInfo>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<SessionInfo>, CommandErr> {
        core.list_accounts().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SwitchAccountParams {
    pub account_id: String,
}

impl Handler for SwitchAccountParams {
    type Ok = SessionInfo;

    async fn run(self, core: &Arc<Core>) -> Result<SessionInfo, CommandErr> {
        core.switch_account(self.account_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RemoveAccountParams {
    pub account_id: String,
}

impl Handler for RemoveAccountParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.remove_inactive_account(self.account_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct LogoutParams {}

impl Handler for LogoutParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.logout().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ResetLocalCacheParams {}

impl Handler for ResetLocalCacheParams {
    type Ok = ();

    #[cfg(not(target_family = "wasm"))]
    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.reset_local_cache().await
    }

    #[cfg(target_family = "wasm")]
    fn run(self, _core: &Arc<Core>) -> impl Future<Output = Result<(), CommandErr>> {
        std::future::ready(Err(CommandErr::Unsupported))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct HomeserverInfoParams {}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct HomeserverInfoOk {
    pub homeserver: String,
    pub server: Option<HomeserverSoftwareView>,
}

impl Handler for HomeserverInfoParams {
    type Ok = HomeserverInfoOk;

    async fn run(self, core: &Arc<Core>) -> Result<HomeserverInfoOk, CommandErr> {
        let client = core.client().await?;
        let server = match client.send(get_server_version::v1::Request::new()).await {
            Ok(response) => response.server.map(|server| HomeserverSoftwareView {
                name: server.name,
                version: server.version,
            }),
            Err(error) => {
                tracing::debug!(%error, "the homeserver did not report its version");
                None
            }
        };

        Ok(HomeserverInfoOk {
            homeserver: client.homeserver().to_string(),
            server,
        })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RequestOpenIdTokenParams {}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RequestOpenIdTokenOk {
    pub access_token: String,
    pub matrix_server_name: String,
    pub expires_in: u32,
}

impl Handler for RequestOpenIdTokenParams {
    type Ok = RequestOpenIdTokenOk;

    async fn run(self, core: &Arc<Core>) -> Result<RequestOpenIdTokenOk, CommandErr> {
        let response = core
            .client()
            .await?
            .account()
            .request_openid_token()
            .await
            .or_failed(core, "request_openid_token")?;

        Ok(RequestOpenIdTokenOk {
            access_token: response.access_token,
            matrix_server_name: response.matrix_server_name.to_string(),
            expires_in: u32::try_from(response.expires_in.as_secs()).unwrap_or(u32::MAX),
        })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AccessTokenParams {}

impl Handler for AccessTokenParams {
    type Ok = Option<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Option<String>, CommandErr> {
        Ok(core.client().await?.access_token())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct OpenIdTokenParams {}

impl Handler for OpenIdTokenParams {
    type Ok = OpenIdTokenView;

    async fn run(self, core: &Arc<Core>) -> Result<OpenIdTokenView, CommandErr> {
        core.openid_token().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SyncStatusParams {}

impl Handler for SyncStatusParams {
    type Ok = SyncStatus;

    async fn run(self, core: &Arc<Core>) -> Result<SyncStatus, CommandErr> {
        Ok(crate::watchers::sync_status(
            core.sync_service().await?.state().get(),
        ))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ServerFeaturesParams {}

impl Handler for ServerFeaturesParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, CommandErr> {
        core.server_features().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DelayedEventsSupportedParams {}

impl Handler for DelayedEventsSupportedParams {
    type Ok = bool;

    async fn run(self, core: &Arc<Core>) -> Result<bool, CommandErr> {
        core.delayed_events_supported().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[expect(
    clippy::struct_excessive_bools,
    reason = "wire type mirroring the protocol"
)]
pub struct SetSearchOptionsParams {
    pub disk_budget_mb: u32,
    pub crawler: bool,
    pub unmetered_only: bool,
    pub server_search: bool,
    pub tuning: SearchTuning,
    pub foreground: bool,
}

impl Handler for SetSearchOptionsParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.search_foreground
            .store(self.foreground, Ordering::Relaxed);
        core.search_network
            .set_unmetered_only(self.unmetered_only);
        core.search_crawl.lock().await.tuning = self.tuning.clamped();
        core.search_crawler_enabled
            .store(self.crawler, Ordering::Relaxed);
        core.server_search_enabled
            .store(self.server_search, Ordering::Relaxed);
        core.search_index
            .lock()
            .await
            .set_disk_budget(usize::try_from(self.disk_budget_mb).unwrap_or(usize::MAX) << 20);
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetReadRoomParams {
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub room_id: Option<OwnedRoomId>,
}

impl Handler for SetReadRoomParams {
    type Ok = ();

    fn run(self, core: &Arc<Core>) -> impl Future<Output = Result<(), CommandErr>> {
        core.set_read_room(self.room_id);
        std::future::ready(Ok(()))
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct IntegrationManagerUrlParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for IntegrationManagerUrlParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        core.integration_manager_url(&self.room_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct KnownRoomsParams {}

impl Handler for KnownRoomsParams {
    type Ok = Vec<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<String>, CommandErr> {
        Ok(core
            .known_room_ids()
            .await?
            .iter()
            .map(ToString::to_string)
            .collect())
    }
}
