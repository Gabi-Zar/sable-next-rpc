use std::sync::Arc;
use std::sync::atomic::Ordering;

use matrix_sdk::executor::{JoinHandleExt, spawn};
use matrix_sdk::{Client, config::RequestConfig};
use matrix_sdk_ui::sync_service::{State, SyncService};

use crate::{Core, ResultExt, protocol::RpcError};

impl Core {
    pub(crate) fn watch_ignored_history(
        self: &Arc<Self>,
        client: &Client,
        sync_service: &Arc<SyncService>,
    ) {
        let core = self.clone();
        let client = client.clone();
        let sync_service = sync_service.clone();
        let mut changes = client.subscribe_to_ignore_user_list_changes();

        self.track_session_task(
            spawn(async move {
                while changes.next().await.is_some() {
                    let _serial = core.activity_lock.lock().await;
                    let running = matches!(sync_service.state().get(), State::Running)
                        && !core.sync_suspended.load(Ordering::SeqCst);
                    if let Err(error) = client.event_cache().clear_all_rooms().await {
                        tracing::warn!(%error, "clearing the event cache after an ignore change");
                    }
                    sync_service.expire_sessions().await;
                    if running {
                        sync_service.start().await;
                    }
                }
            })
            .abort_on_drop(),
        );
    }

    pub(crate) async fn server_features(&self) -> Result<Vec<String>, RpcError> {
        let features = self
            .client()
            .await?
            .unstable_features()
            .await
            .or_failed(self, "server_features")?;
        Ok(features
            .iter()
            .map(|feature| feature.as_str().to_owned())
            .collect())
    }

    pub(crate) async fn require_sliding_sync(&self, client: &Client) -> Result<(), RpcError> {
        let versions = client
            .fetch_server_versions(Some(
                RequestConfig::new()
                    .timeout(std::time::Duration::from_secs(15))
                    .disable_retry(),
            ))
            .await
            .map_err(|error| self.homeserver_http_error("sliding_sync_support", error))?;
        if versions
            .unstable_features
            .get("org.matrix.simplified_msc3575")
            == Some(&true)
        {
            Ok(())
        } else {
            Err(RpcError::SlidingSyncUnsupported)
        }
    }
}

#[cfg(test)]
mod tests {
    use matrix_sdk::test_utils::mocks::MatrixMockServer;
    use serde_json::json;
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path},
    };

    #[tokio::test]
    async fn support_checks_distinguish_unsupported_servers_from_failures() {
        for supported in [None, Some(false), Some(true)] {
            let server = MatrixMockServer::new().await;
            let client = server.client_builder().no_server_versions().build().await;
            let features = supported.map_or_else(
                || json!({}),
                |value| json!({"org.matrix.simplified_msc3575": value}),
            );
            Mock::given(method("GET"))
                .and(path("/_matrix/client/versions"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(
                        json!({"versions": ["v1.19"], "unstable_features": features}),
                    ),
                )
                .mount(server.server())
                .await;
            let (core, _events) = crate::Core::new(
                "sync-support",
                Box::new(crate::store::MemorySessionStore::default()),
            );
            let outcome = core.require_sliding_sync(&client).await;
            assert_eq!(outcome.is_ok(), supported == Some(true));
            if supported != Some(true) {
                assert!(matches!(
                    outcome,
                    Err(crate::protocol::RpcError::SlidingSyncUnsupported)
                ));
            }
        }
        let server = MatrixMockServer::new().await;
        let client = server.client_builder().no_server_versions().build().await;
        Mock::given(method("GET"))
            .and(path("/_matrix/client/versions"))
            .respond_with(
                ResponseTemplate::new(503)
                    .set_body_json(json!({"errcode": "M_UNKNOWN", "error": "unavailable"})),
            )
            .mount(server.server())
            .await;
        let (core, _events) = crate::Core::new(
            "sync-support",
            Box::new(crate::store::MemorySessionStore::default()),
        );
        assert!(matches!(
            core.require_sliding_sync(&client).await,
            Err(crate::protocol::RpcError::Unavailable)
        ));
    }
}
