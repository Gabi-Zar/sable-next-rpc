use std::time::Duration;

use matrix_sdk::ruma::api::FeatureFlag;
use matrix_sdk::ruma::api::client::delayed_events::{
    DelayParameters, delayed_message_event, get_all_delayed_events, update_delayed_event,
};
use matrix_sdk::ruma::events::AnyMessageLikeEventContent;
use matrix_sdk::ruma::events::room::message::RoomMessageEventContent;
use matrix_sdk::ruma::{OwnedMxcUri, OwnedRoomId, TransactionId};
use mime::Mime;
use serde::Serialize;

use crate::Core;
use crate::ResultExt;
use crate::protocol::{AttachmentInfoView, CommandErr, ScheduledMessageView};

const MSC4140: &str = "org.matrix.msc4140";

#[derive(Serialize)]
struct MediaInfoOut<'a> {
    mimetype: &'a str,
    size: u64,
    #[serde(rename = "w", skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(rename = "h", skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
    #[serde(rename = "duration", skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u32>,
    #[serde(
        rename = "xyz.amorgan.blurhash",
        skip_serializing_if = "Option::is_none"
    )]
    blurhash: Option<&'a str>,
}

#[derive(Serialize)]
struct AttachmentOut<'a> {
    msgtype: &'static str,
    body: &'a str,
    url: &'a str,
    info: MediaInfoOut<'a>,
    #[serde(
        rename = "org.matrix.msc4230.is_spoiler",
        skip_serializing_if = "std::ops::Not::not"
    )]
    spoiler: bool,
}

fn attachment_content<'a>(
    filename: &'a str,
    mime: &'a Mime,
    url: &'a OwnedMxcUri,
    size: u64,
    info: &'a AttachmentInfoView,
    spoiler: bool,
) -> AttachmentOut<'a> {
    let msgtype = match mime.type_() {
        mime::IMAGE => "m.image",
        mime::VIDEO => "m.video",
        mime::AUDIO => "m.audio",
        _ => "m.file",
    };
    AttachmentOut {
        msgtype,
        body: filename,
        url: url.as_str(),
        info: MediaInfoOut {
            mimetype: mime.essence_str(),
            size,
            width: info.width,
            height: info.height,
            duration_ms: info.duration_ms,
            blurhash: info.blurhash.as_deref(),
        },
        spoiler,
    }
}

impl Core {
    pub(crate) async fn delayed_events_supported(&self) -> Result<bool, CommandErr> {
        let client = self.client().await?;
        let features = client
            .unstable_features()
            .await
            .or_failed(self, "delayed_events_supported")?;
        Ok(features.contains(&FeatureFlag::from(MSC4140)))
    }

    pub(crate) async fn schedule_message(
        &self,
        room_id: &OwnedRoomId,
        content: RoomMessageEventContent,
        delay_ms: u64,
    ) -> Result<String, CommandErr> {
        if !self.delayed_events_supported().await? {
            return Err(CommandErr::DelayedEventsUnsupported);
        }
        let room = self.room(room_id).await?;
        if self.room_is_encrypted(&room).await? {
            return Err(CommandErr::EncryptedScheduleUnsupported);
        }

        let request = delayed_message_event::unstable::Request::new(
            room_id.clone(),
            TransactionId::new(),
            DelayParameters::Timeout {
                timeout: Duration::from_millis(delay_ms),
            },
            &AnyMessageLikeEventContent::RoomMessage(content),
        )
        .or_failed(self, "schedule_message")?;

        let response = self
            .client()
            .await?
            .send(request)
            .await
            .or_failed(self, "schedule_message")?;
        Ok(response.delay_id)
    }

    #[expect(clippy::too_many_arguments, reason = "mirrors the protocol fields")]
    pub(crate) async fn schedule_attachment(
        &self,
        room_id: &OwnedRoomId,
        filename: String,
        mime: String,
        url: String,
        size: u64,
        info: Option<AttachmentInfoView>,
        spoiler: bool,
        delay_ms: u64,
    ) -> Result<String, CommandErr> {
        let mime: Mime = mime.parse().map_err(|_| CommandErr::InvalidMedia)?;
        let url = OwnedMxcUri::from(url);
        if url.parts().is_err() {
            return Err(CommandErr::InvalidMedia);
        }

        let info = info.unwrap_or_default();
        let content = serde_json::to_value(attachment_content(
            &filename, &mime, &url, size, &info, spoiler,
        ))
        .and_then(serde_json::from_value::<RoomMessageEventContent>)
        .or_failed(self, "schedule_attachment")?;
        self.schedule_message(room_id, content, delay_ms).await
    }

    pub(crate) async fn cancel_scheduled_message(
        &self,
        delay_id: String,
    ) -> Result<(), CommandErr> {
        let request = update_delayed_event::unstable_v1::Request::new(
            delay_id,
            update_delayed_event::UpdateAction::Cancel,
        );
        self.client()
            .await?
            .send(request)
            .await
            .or_failed(self, "cancel_scheduled_message")?;
        Ok(())
    }

    pub(crate) async fn send_scheduled_message_now(
        &self,
        delay_id: String,
    ) -> Result<(), CommandErr> {
        let request = update_delayed_event::unstable_v1::Request::new(
            delay_id,
            update_delayed_event::UpdateAction::Send,
        );
        self.client()
            .await?
            .send(request)
            .await
            .or_failed(self, "send_scheduled_message")?;
        Ok(())
    }

    pub(crate) async fn scheduled_messages(
        &self,
        room_id: Option<&OwnedRoomId>,
    ) -> Result<Vec<ScheduledMessageView>, CommandErr> {
        if !self.delayed_events_supported().await? {
            return Ok(Vec::new());
        }
        let client = self.client().await?;
        let response = client
            .send(get_all_delayed_events::unstable::Request::new())
            .await
            .map_err(|error| self.homeserver_http_error("scheduled_messages", error))?;

        Ok(response
            .delayed_events
            .into_iter()
            .filter(|item| {
                item.event_type == matrix_sdk::ruma::events::TimelineEventType::RoomMessage
            })
            .filter(|item| item.finalized_ts.is_none())
            .filter(|item| room_id.is_none_or(|wanted| &item.room_id == wanted))
            .filter_map(|item| {
                let content = item
                    .content
                    .deserialize_as_unchecked::<RoomMessageEventContent>()
                    .ok()?;
                let delay_ms = u64::try_from(item.delay.as_millis()).unwrap_or(u64::MAX);
                let formatted = match &content.msgtype {
                    matrix_sdk::ruma::events::room::message::MessageType::Text(text) => text
                        .formatted
                        .as_ref()
                        .map(|formatted| formatted.body.clone()),
                    matrix_sdk::ruma::events::room::message::MessageType::Notice(notice) => notice
                        .formatted
                        .as_ref()
                        .map(|formatted| formatted.body.clone()),
                    matrix_sdk::ruma::events::room::message::MessageType::Emote(emote) => emote
                        .formatted
                        .as_ref()
                        .map(|formatted| formatted.body.clone()),
                    _ => None,
                };
                Some(ScheduledMessageView {
                    delivery_ts: Some(u64::from(item.running_since.get()).saturating_add(delay_ms)),
                    body: content.body().to_owned(),
                    formatted,
                    delay_id: item.delay_id,
                    room_id: item.room_id,
                    delay_ms,
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn attachment_content_keeps_the_wire_shape() {
        let mime: Mime = "image/png; charset=binary".parse().expect("mime");
        let url = OwnedMxcUri::from("mxc://example.org/abc");
        let info = AttachmentInfoView {
            width: Some(10),
            height: Some(20),
            duration_ms: Some(30),
            blurhash: Some("LEHV6n".to_owned()),
            ..AttachmentInfoView::default()
        };
        assert_eq!(
            serde_json::to_value(attachment_content("a.png", &mime, &url, 7, &info, true)).unwrap(),
            json!({
                "msgtype": "m.image",
                "body": "a.png",
                "url": "mxc://example.org/abc",
                "info": {
                    "mimetype": "image/png",
                    "size": 7,
                    "w": 10,
                    "h": 20,
                    "duration": 30,
                    "xyz.amorgan.blurhash": "LEHV6n"
                },
                "org.matrix.msc4230.is_spoiler": true
            })
        );
    }

    #[test]
    fn attachment_content_omits_absent_fields() {
        let mime: Mime = "application/pdf".parse().expect("mime");
        let url = OwnedMxcUri::from("mxc://example.org/abc");
        assert_eq!(
            serde_json::to_value(attachment_content(
                "a.pdf",
                &mime,
                &url,
                7,
                &AttachmentInfoView::default(),
                false
            ))
            .unwrap(),
            json!({
                "msgtype": "m.file",
                "body": "a.pdf",
                "url": "mxc://example.org/abc",
                "info": { "mimetype": "application/pdf", "size": 7 }
            })
        );
    }
}
