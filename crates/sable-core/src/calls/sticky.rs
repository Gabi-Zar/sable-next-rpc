use std::time::Duration;

use crate::delayed_events::DelayedEventsSupport;
use matrix_sdk::{Client, Room};
use ruma::api::client::{message::send_message_event::v3, sync::sync_events::v5};
use ruma::events::{MessageLikeEventType, sticky::StickyDurationMs};
use ruma::serde::Raw;
use serde_json::Value;

const STICKY_DURATION_MS: u32 = 3_600_000;

#[derive(Debug)]
pub(super) enum StickySyncError {
    Matrix,
}

pub(super) struct StickySync {
    conn_id: String,
    pos: Option<String>,
    since: Option<String>,
}

impl StickySync {
    pub(super) fn new(session: u32) -> Self {
        Self {
            conn_id: format!("call-{session}"),
            pos: None,
            since: None,
        }
    }

    fn request(&self, room: &Room, timeout: Duration) -> v5::Request {
        let mut request = v5::Request::new();
        request.pos.clone_from(&self.pos);
        request.conn_id = Some(self.conn_id.clone());
        request.timeout = Some(timeout);
        request.room_subscriptions.insert(
            room.room_id().to_owned(),
            v5::request::RoomSubscription::default(),
        );
        request.extensions.to_device.enabled = Some(false);
        request.extensions.sticky_events.enabled = Some(true);
        request
            .extensions
            .sticky_events
            .since
            .clone_from(&self.since);
        request
    }

    pub(super) async fn sync(
        &mut self,
        room: &Room,
        timeout: Duration,
    ) -> Result<Vec<Value>, StickySyncError> {
        let Ok(response) = room.client().send(self.request(room, timeout)).await else {
            self.pos = None;
            self.since = None;
            return Err(StickySyncError::Matrix);
        };
        let sticky = response.extensions.sticky_events;
        self.pos = Some(response.pos);
        if sticky.next_batch.is_some() {
            self.since = sticky.next_batch;
        }
        let mut events = Vec::new();
        if let Some(room_events) = sticky.rooms.get(room.room_id()) {
            events.extend(
                room_events
                    .events
                    .iter()
                    .filter_map(|event| serde_json::from_str(event.json().get()).ok()),
            );
        }
        if let Some(room_events) = response.rooms.get(room.room_id()) {
            events.extend(
                room_events
                    .timeline
                    .iter()
                    .filter_map(|event| serde_json::from_str(event.json().get()).ok()),
            );
        }
        Ok(events)
    }
}

pub(crate) fn live_events(room: &Room) -> Vec<Value> {
    room.sticky_events()
        .live()
        .iter()
        .filter_map(|event| {
            let object: serde_json::Map<String, Value> =
                serde_json::from_str(event.raw().json().get()).ok()?;
            let sticky = if object.contains_key("msc4354_sticky") || object.contains_key("sticky") {
                None
            } else {
                let sent = object.get("origin_server_ts").and_then(Value::as_u64)?;
                let expires = u64::from(event.expires_at.get());
                Some(StickyOut {
                    duration_ms: expires.saturating_sub(sent),
                })
            };
            serde_json::to_value(StampedEventOut {
                event: object,
                msc4354_sticky: sticky,
            })
            .ok()
        })
        .collect()
}

#[derive(serde::Serialize)]
struct StickyOut {
    duration_ms: u64,
}

/// Only stamped when the event lacks both sticky keys, so `event` never
/// carries the key that `msc4354_sticky` would override.
#[derive(serde::Serialize)]
struct StampedEventOut {
    #[serde(flatten)]
    event: serde_json::Map<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    msc4354_sticky: Option<StickyOut>,
}

#[derive(serde::Serialize)]
pub(super) struct StickyKeyOut {
    pub(super) msc4354_sticky_key: Option<String>,
}

pub(super) async fn send(
    client: &Client,
    room: &Room,
    content: impl serde::Serialize,
) -> Result<ruma::OwnedEventId, matrix_sdk::Error> {
    let mut request = v3::Request::new_raw(
        room.room_id().to_owned(),
        ruma::TransactionId::new(),
        MessageLikeEventType::from(super::membership::RTC_MEMBER_EVENT_TYPE),
        Raw::new(&content)?.cast_unchecked(),
    );
    request.sticky_duration_ms = Some(StickyDurationMs::new_clamped(STICKY_DURATION_MS));
    Ok(client.send(request).await?.event_id)
}

pub(super) async fn send_delayed(
    client: &Client,
    support: DelayedEventsSupport,
    room: &Room,
    content: impl serde::Serialize,
    delay: Duration,
) -> Result<String, matrix_sdk::Error> {
    send_delayed_event(
        client,
        support,
        room,
        super::membership::RTC_MEMBER_EVENT_TYPE,
        content,
        delay,
        STICKY_DURATION_MS,
    )
    .await
}

pub(crate) async fn send_delayed_event(
    client: &Client,
    support: DelayedEventsSupport,
    room: &Room,
    event_type: &str,
    content: impl serde::Serialize,
    delay: Duration,
    duration_ms: u32,
) -> Result<String, matrix_sdk::Error> {
    let event = crate::delayed_events::DelayedEvent {
        room_id: room.room_id().to_owned(),
        event_type: event_type.to_owned(),
        state_key: None,
        content: serde_json::value::to_raw_value(&content)?,
        delay,
        sticky_duration_ms: Some(duration_ms),
    };
    Ok(crate::delayed_events::send(client, support, event).await?)
}

#[cfg(test)]
#[path = "sticky_tests.rs"]
mod tests;
