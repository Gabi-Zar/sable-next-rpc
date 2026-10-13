use std::sync::Arc;

use serde::Deserialize;

use super::Handler;
use crate::protocol::{
    CommandErr, DiagnosticPushView, PusherView, RegisteredPusherView, WebPusherView,
};
use crate::{Core, ResultExt, notifications, push_check, webpush};

domain! {
    set_pusher => SetPusherParams,
    remove_pusher => RemovePusherParams,
    web_pusher_support => WebPusherSupportParams,
    set_web_pusher => SetWebPusherParams,
    web_pushers => WebPushersParams,
    ping_push_gateway => PingPushGatewayParams,
    discover_push_gateway => DiscoverPushGatewayParams,
    send_diagnostic_push => SendDiagnosticPushParams,
    ack_web_pusher => AckWebPusherParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetPusherParams {
    pub pusher: PusherView,
}

impl Handler for SetPusherParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        notifications::set_pusher(&core.client().await?, self.pusher)
            .await
            .or_failed(core, "set_pusher")
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RemovePusherParams {
    pub pushkey: String,
    pub app_id: String,
}

impl Handler for RemovePusherParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        notifications::remove_pusher(&core.client().await?, self.pushkey, self.app_id)
            .await
            .or_failed(core, "remove_pusher")
    }
}

/// The homeserver's web push support: a VAPID key means server delivery.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct WebPusherSupportParams {}

impl Handler for WebPusherSupportParams {
    /// `Some` carries the VAPID key subscriptions must be minted under.
    type Ok = Option<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Option<String>, CommandErr> {
        webpush::support(&core.client().await?)
            .await
            .or_failed(core, "webpusher_support")
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetWebPusherParams {
    pub pusher: WebPusherView,
}

impl Handler for SetWebPusherParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        webpush::set_pusher(&core.client().await?, self.pusher)
            .await
            .or_failed(core, "set_webpusher")
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct WebPushersParams {}

impl Handler for WebPushersParams {
    type Ok = Vec<RegisteredPusherView>;

    async fn run(self, core: &Arc<Core>) -> Result<Vec<RegisteredPusherView>, CommandErr> {
        webpush::pushers(&core.client().await?)
            .await
            .or_failed(core, "webpushers")
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PingPushGatewayParams {
    pub url: String,
}

impl Handler for PingPushGatewayParams {
    type Ok = Option<bool>;

    async fn run(self, _core: &Arc<Core>) -> Result<Option<bool>, CommandErr> {
        Ok(push_check::ping_gateway(&self.url).await)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DiscoverPushGatewayParams {
    pub endpoint: String,
}

impl Handler for DiscoverPushGatewayParams {
    type Ok = Option<String>;

    async fn run(self, _core: &Arc<Core>) -> Result<Option<String>, CommandErr> {
        Ok(push_check::discover_gateway(&self.endpoint).await)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SendDiagnosticPushParams {
    pub pushkey: String,
    pub app_id: String,
}

impl Handler for SendDiagnosticPushParams {
    type Ok = DiagnosticPushView;

    async fn run(self, core: &Arc<Core>) -> Result<DiagnosticPushView, CommandErr> {
        push_check::send_diagnostic_push(&core.client().await?, &self.pushkey, &self.app_id)
            .await
            .or_failed(core, "send_diagnostic_push")
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AckWebPusherParams {
    pub app_id: String,
    pub ack_token: String,
}

impl Handler for AckWebPusherParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        webpush::ack(&core.client().await?, self.app_id, self.ack_token)
            .await
            .or_failed(core, "ack_webpusher")
    }
}
