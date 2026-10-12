use std::sync::Arc;

use matrix_sdk::executor::spawn;
use matrix_sdk::ruma::{
    OwnedEventId, OwnedRoomId, UserId,
    events::room::message::Relation,
    events::{
        AnyMessageLikeEventContent, AnySyncMessageLikeEvent, AnySyncTimelineEvent,
        MessageLikeEventType, poll::unstable_start::UnstablePollStartEventContent,
    },
    room_version_rules::RoomVersionRules,
};
use matrix_sdk_ui::timeline::{
    RoomExt, Timeline, TimelineEventFocusThreadMode, TimelineFocus, default_event_filter,
};

use matrix_sdk_base::event_cache::Event;

use crate::ResultExt;
use crate::protocol::{CommandErr, SubscriptionId, TimelineFocusView, TimelineItemView};
use crate::view::{CUTE_EVENT_MSGTYPE, aggregation_item};

use crate::{CachedTimeline, Core, SubscriptionKind, ThreadKey};

const MAX_CACHED_INACTIVE_TIMELINES: usize = 4;
const MAX_CACHED_THREAD_TIMELINES: usize = 4;

impl Core {
    /// Cached: a second subscriber would give the UI two streams for one room.
    pub(crate) async fn timeline(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<Arc<Timeline>, CommandErr> {
        {
            let session = self.session.read().await;
            session.as_ref().ok_or(CommandErr::NotLoggedIn)?;
            if let Some(cached) = self.timelines.lock().await.get(room_id) {
                return Ok(cached.timeline.clone());
            }
        }
        self.live_timeline(room_id, false).await
    }

    /// The cache holds one live timeline per room, so a `hidden_events` that no
    /// longer matches replaces it rather than sitting alongside it.
    #[cfg_attr(
        target_family = "wasm",
        expect(
            clippy::arc_with_non_send_sync,
            reason = "matrix timelines are single-threaded on WASM"
        )
    )]
    pub(crate) async fn live_timeline(
        &self,
        room_id: &OwnedRoomId,
        hidden_events: bool,
    ) -> Result<Arc<Timeline>, CommandErr> {
        tracing::info!(%room_id, "live_timeline: waiting for session");
        let session = self.session.read().await;
        let room = session
            .as_ref()
            .ok_or(CommandErr::NotLoggedIn)?
            .client
            .get_room(room_id)
            .ok_or(CommandErr::UnknownRoom)?;
        {
            let mut timelines = self.timelines.lock().await;
            if let Some(cached) = timelines.get_mut(room_id)
                && cached.hidden_events == hidden_events
            {
                cached.last_access = self.next_timeline_access();
                return Ok(cached.timeline.clone());
            }
        }

        tracing::info!(%room_id, "live_timeline: building");
        let timeline = Arc::new(
            build_room_timeline(&room, &TimelineFocusView::Live, hidden_events)
                .await
                .or_failed(self, "build_timeline")?,
        );
        tracing::info!(%room_id, "live_timeline: built");

        let subscribed_room_ids = self
            .subscriptions
            .lock()
            .await
            .values()
            .filter_map(|subscription| match &subscription.kind {
                SubscriptionKind::LiveTimeline(room_id) => Some(room_id.clone()),
                SubscriptionKind::Other | SubscriptionKind::FocusedTimeline(_) => None,
            })
            .collect::<std::collections::HashSet<_>>();
        let mut timelines = self.timelines.lock().await;
        match timelines.get_mut(room_id) {
            Some(cached) if cached.hidden_events == hidden_events => {
                cached.last_access = self.next_timeline_access();
                Ok(cached.timeline.clone())
            }
            _ => {
                let inactive = timelines
                    .keys()
                    .filter(|id| !subscribed_room_ids.contains(*id))
                    .count();
                if inactive >= MAX_CACHED_INACTIVE_TIMELINES
                    && let Some(evicted) = timelines
                        .iter()
                        .filter(|(id, _)| !subscribed_room_ids.contains(*id))
                        .min_by_key(|(_, cached)| cached.last_access)
                        .map(|(id, _)| id.clone())
                {
                    timelines.remove(&evicted);
                }
                timelines.insert(
                    room_id.clone(),
                    CachedTimeline {
                        timeline: timeline.clone(),
                        hidden_events,
                        last_access: self.next_timeline_access(),
                    },
                );
                Ok(timeline)
            }
        }
    }

    pub(crate) async fn restore_history_gap(
        &self,
        room: &matrix_sdk::Room,
    ) -> Result<bool, CommandErr> {
        let room_id = room.room_id().to_owned();
        if self
            .restored_history_rooms
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(&room_id)
        {
            return Ok(false);
        }
        let (cache, _handles) = room
            .event_cache()
            .await
            .or_failed(self, "history_gap_cache")?;
        let cached = cache.events().await.or_failed(self, "history_gap_events")?;
        if cached
            .first()
            .is_none_or(|event| starts_history(event, room))
        {
            return Ok(false);
        }

        let mut page = None;
        for _ in 0..HISTORY_GAP_ATTEMPTS {
            let mut options = matrix_sdk::room::MessagesOptions::backward();
            options.limit = HISTORY_GAP_PAGE.into();
            let messages = room
                .messages(options)
                .await
                .or_failed(self, "history_gap_messages")?;
            let latest = cache
                .events()
                .await
                .or_failed(self, "history_gap_events")?
                .pop()
                .and_then(|event| event.event_id().map(ToOwned::to_owned));
            let covered = latest.is_none_or(|latest| {
                messages
                    .chunk
                    .iter()
                    .any(|event| event.event_id() == Some(&*latest))
            });
            if covered {
                page = Some(messages);
                break;
            }
        }
        let Some(page) = page else {
            return Ok(false);
        };
        self.restored_history_rooms
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(room_id.clone());
        let Some(prev_batch) = page.end else {
            return Ok(false);
        };

        tracing::warn!(%room_id, "event cache lost its history gap; re-seeding from the server");
        let mut events = page.chunk;
        events.reverse();
        let mut updates = matrix_sdk::sync::RoomUpdates::default();
        updates.joined.insert(
            room_id,
            matrix_sdk::sync::JoinedRoomUpdate {
                timeline: matrix_sdk::sync::Timeline {
                    limited: true,
                    prev_batch: Some(prev_batch),
                    events,
                },
                ..Default::default()
            },
        );
        room.client()
            .event_cache()
            .handle_room_updates(updates)
            .await
            .or_failed(self, "history_gap_reseed")?;
        Ok(true)
    }
}

const HISTORY_GAP_PAGE: u32 = 20;
const HISTORY_GAP_ATTEMPTS: usize = 3;

fn starts_history(event: &Event, room: &matrix_sdk::Room) -> bool {
    use matrix_sdk::ruma::events::room::history_visibility::HistoryVisibility;
    let raw = event.raw();
    match raw.get_field::<String>("type").ok().flatten().as_deref() {
        Some("m.room.create") => true,
        Some("m.room.member") => {
            !matches!(
                room.history_visibility_or_default(),
                HistoryVisibility::Shared | HistoryVisibility::WorldReadable
            ) && raw
                .get_field::<String>("state_key")
                .ok()
                .flatten()
                .as_deref()
                == Some(room.own_user_id().as_str())
        }
        _ => false,
    }
}

impl Core {
    pub(crate) async fn timeline_for(
        &self,
        room_id: &OwnedRoomId,
        thread_root: Option<&OwnedEventId>,
    ) -> Result<Arc<Timeline>, CommandErr> {
        match thread_root {
            Some(root) => self.thread_timeline(room_id, root).await,
            None => self.timeline(room_id).await,
        }
    }

    pub(crate) async fn subscribed_timeline(
        &self,
        room_id: &OwnedRoomId,
        thread_root: Option<&OwnedEventId>,
        subscription: Option<SubscriptionId>,
    ) -> Result<Arc<Timeline>, CommandErr> {
        let Some(subscription) = subscription else {
            return self.timeline_for(room_id, thread_root).await;
        };
        let timeline = self
            .subscriptions
            .lock()
            .await
            .get(&subscription)
            .filter(|subscription| subscription.thread_root.as_ref() == thread_root)
            .and_then(|subscription| subscription.timeline.clone())
            .ok_or(CommandErr::UnknownSubscription)?;
        if timeline.room().room_id() != room_id {
            return Err(CommandErr::UnknownSubscription);
        }
        Ok(timeline)
    }

    #[cfg_attr(
        target_family = "wasm",
        expect(
            clippy::arc_with_non_send_sync,
            reason = "matrix timelines are single-threaded on WASM"
        )
    )]
    pub(crate) async fn thread_timeline(
        &self,
        room_id: &OwnedRoomId,
        root_event_id: &OwnedEventId,
    ) -> Result<Arc<Timeline>, CommandErr> {
        let session = self.session.read().await;
        let room = session
            .as_ref()
            .ok_or(CommandErr::NotLoggedIn)?
            .client
            .get_room(room_id)
            .ok_or(CommandErr::UnknownRoom)?;
        let key: ThreadKey = (room_id.clone(), root_event_id.clone());
        {
            let mut threads = self.thread_timelines.lock().await;
            if let Some(cached) = threads.get_mut(&key) {
                cached.last_access = self.next_timeline_access();
                return Ok(cached.timeline.clone());
            }
        }

        let focus = TimelineFocusView::Thread {
            root_event_id: root_event_id.clone(),
        };
        let timeline = Arc::new(
            build_room_timeline(&room, &focus, false)
                .await
                .or_failed(self, "build_thread_timeline")?,
        );

        let mut threads = self.thread_timelines.lock().await;
        if let Some(cached) = threads.get_mut(&key) {
            cached.last_access = self.next_timeline_access();
            return Ok(cached.timeline.clone());
        }

        if threads.len() >= MAX_CACHED_THREAD_TIMELINES
            && let Some(evicted) = threads
                .iter()
                .min_by_key(|(_, cached)| cached.last_access)
                .map(|(id, _)| id.clone())
        {
            threads.remove(&evicted);
        }
        threads.insert(
            key,
            CachedTimeline {
                timeline: timeline.clone(),
                hidden_events: false,
                last_access: self.next_timeline_access(),
            },
        );
        Ok(timeline)
    }
}

pub(crate) fn fill_sender_profiles(room: &matrix_sdk::Room, timeline: &Arc<Timeline>) {
    if room.are_members_synced() {
        return;
    }

    let timeline = timeline.clone();
    drop(spawn(async move {
        timeline.fetch_members().await;
    }));
}

fn is_aggregation(event: &AnySyncTimelineEvent, rules: &RoomVersionRules) -> bool {
    let AnySyncTimelineEvent::MessageLike(message) = event else {
        return false;
    };

    if let AnySyncMessageLikeEvent::RoomRedaction(redaction) = message {
        return redaction.redacts(&rules.redaction).is_some();
    }

    let Some(content) = message.original_content() else {
        return message.event_type() == MessageLikeEventType::Reaction;
    };

    match content {
        AnyMessageLikeEventContent::Reaction(_)
        | AnyMessageLikeEventContent::Beacon(_)
        | AnyMessageLikeEventContent::RtcDecline(_)
        | AnyMessageLikeEventContent::UnstablePollResponse(_)
        | AnyMessageLikeEventContent::UnstablePollEnd(_) => true,
        AnyMessageLikeEventContent::UnstablePollStart(poll) => {
            matches!(poll, UnstablePollStartEventContent::Replacement(_))
        }
        AnyMessageLikeEventContent::RoomMessage(message) => {
            matches!(message.relates_to, Some(Relation::Replacement(_)))
        }
        _ => false,
    }
}

pub(crate) fn hidden_event_filter(event: &AnySyncTimelineEvent, rules: &RoomVersionRules) -> bool {
    default_event_filter(event, rules) || !is_aggregation(event, rules)
}

pub(crate) fn aggregation_items(
    events: impl IntoIterator<Item = Event>,
    rules: &RoomVersionRules,
    own_user_id: Option<&UserId>,
) -> Vec<TimelineItemView> {
    events
        .into_iter()
        .filter_map(|event| {
            let parsed = event.raw().deserialize().ok()?;
            if !is_aggregation(&parsed, rules) {
                return None;
            }
            let content = event.raw().get_field::<serde_json::Value>("content").ok()?;
            let redacts = match &parsed {
                AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomRedaction(
                    redaction,
                )) => redaction.redacts(&rules.redaction).map(ToOwned::to_owned),
                _ => None,
            };
            Some(aggregation_item(&parsed, content, redacts, own_user_id))
        })
        .collect()
}

fn timeline_event_filter(event: &AnySyncTimelineEvent, rules: &RoomVersionRules) -> bool {
    !is_signaling_event(event) && (default_event_filter(event, rules) || is_cute_event(event))
}

fn is_cute_event(event: &AnySyncTimelineEvent) -> bool {
    let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(message)) = event
    else {
        return false;
    };
    message.as_original().is_some_and(|message| {
        message.content.msgtype.msgtype() == CUTE_EVENT_MSGTYPE
            && !matches!(message.content.relates_to, Some(Relation::Replacement(_)))
    })
}

fn is_signaling_event(event: &AnySyncTimelineEvent) -> bool {
    let event_type = event.event_type().to_string();
    matches!(
        event_type.as_str(),
        "m.rtc.member"
            | "org.matrix.msc4143.rtc.member"
            | "io.element.call.encryption_keys"
            | "org.matrix.msc4075.rtc.notification"
            | "org.matrix.msc4310.rtc.decline"
    )
}

pub(crate) async fn build_room_timeline(
    room: &matrix_sdk::Room,
    focus: &TimelineFocusView,
    hidden_events: bool,
) -> Result<Timeline, matrix_sdk_ui::timeline::Error> {
    let builder = room.timeline_builder().with_focus(match focus {
        TimelineFocusView::Live => TimelineFocus::Live {
            hide_threaded_events: true,
        },
        TimelineFocusView::Event { event_id } => TimelineFocus::Event {
            target: event_id.clone(),
            num_context_events: 20,
            thread_mode: TimelineEventFocusThreadMode::Automatic {
                hide_threaded_events: false,
            },
        },
        TimelineFocusView::Thread { root_event_id } => TimelineFocus::Thread {
            thread_id: root_event_id.clone(),
        },
    });
    let builder = if hidden_events {
        builder.event_filter(hidden_event_filter)
    } else {
        builder.event_filter(timeline_event_filter)
    };
    builder.build().await
}

#[cfg(test)]
mod tests {
    use matrix_sdk::ruma::{event_id, serde::Raw};

    use super::TimelineFocusView;

    #[test]
    fn a_live_focus_is_what_an_absent_one_means() {
        let parsed: TimelineFocusView = serde_json::from_str(r#"{"kind":"live"}"#).unwrap();

        assert_eq!(parsed, TimelineFocusView::Live);
        assert_eq!(TimelineFocusView::default(), TimelineFocusView::Live);
    }

    #[test]
    fn a_thread_focus_carries_its_root() {
        let parsed: TimelineFocusView =
            serde_json::from_str(r#"{"kind":"thread","root_event_id":"$root"}"#).unwrap();

        assert_eq!(
            parsed,
            TimelineFocusView::Thread {
                root_event_id: event_id!("$root").to_owned(),
            }
        );
    }

    #[test]
    fn an_event_focus_carries_its_target() {
        let parsed: TimelineFocusView =
            serde_json::from_str(r#"{"kind":"event","event_id":"$target"}"#).unwrap();

        assert_eq!(
            parsed,
            TimelineFocusView::Event {
                event_id: event_id!("$target").to_owned(),
            }
        );
    }

    #[test]
    fn signaling_events_are_filtered_unless_hidden_events_are_on() {
        let rules = matrix_sdk::ruma::room_version_rules::RoomVersionRules::V11;
        let event_json = [
            ("m.rtc.member", "{}", true),
            ("org.matrix.msc4143.rtc.member", "{}", true),
            ("io.element.call.encryption_keys", "{}", true),
            (
                "org.matrix.msc4075.rtc.notification",
                r#"{"m.mentions":{"room":true,"user_ids":[]},"notification_type":"ring","m.relates_to":{"rel_type":"m.reference","event_id":"$root"},"sender_ts":1,"lifetime":30000,"m.text":[]}"#,
                true,
            ),
            (
                "org.matrix.msc4310.rtc.decline",
                r#"{"m.relates_to":{"rel_type":"m.reference","event_id":"$root"}}"#,
                false,
            ),
        ];
        for (event_type, content, hidden) in event_json {
            let event = Raw::<matrix_sdk::ruma::events::AnySyncTimelineEvent>::from_json_string(
                format!(
                    r#"{{"type":"{event_type}","event_id":"$signal","sender":"@alice:example.org","origin_server_ts":1,"content":{content},"unsigned":{{}}}}"#
                ),
            )
            .unwrap()
            .deserialize()
            .unwrap();

            assert!(!super::timeline_event_filter(&event, &rules));
            assert_eq!(super::hidden_event_filter(&event, &rules), hidden);
        }

        let ordinary = Raw::<matrix_sdk::ruma::events::AnySyncTimelineEvent>::from_json_string(
            r#"{"type":"com.example.signal","event_id":"$ordinary","sender":"@alice:example.org","origin_server_ts":1,"content":{},"unsigned":{}}"#.to_owned(),
        )
        .unwrap()
        .deserialize()
        .unwrap();
        assert!(super::hidden_event_filter(&ordinary, &rules));
    }

    #[test]
    fn fluffychat_cute_events_reach_the_timeline() {
        let rules = matrix_sdk::ruma::room_version_rules::RoomVersionRules::V11;
        let event = |content: &str| {
            Raw::<matrix_sdk::ruma::events::AnySyncTimelineEvent>::from_json_string(format!(
                r#"{{"type":"m.room.message","event_id":"$cute","sender":"@alice:example.org","origin_server_ts":1,"content":{content},"unsigned":{{}}}}"#
            ))
            .unwrap()
            .deserialize()
            .unwrap()
        };

        let hug = event(r#"{"msgtype":"im.fluffychat.cute_event","cute_type":"hug","body":"🤗"}"#);
        assert!(super::timeline_event_filter(&hug, &rules));

        let other = event(r#"{"msgtype":"com.example.custom","body":"x"}"#);
        assert!(!super::timeline_event_filter(&other, &rules));
    }

    #[test]
    fn aggregations_become_hidden_rows() {
        use matrix_sdk_base::deserialized_responses::TimelineEvent;

        let rules = matrix_sdk::ruma::room_version_rules::RoomVersionRules::V11;
        let event = |json: &str| {
            TimelineEvent::from_plaintext(
                Raw::<matrix_sdk::ruma::events::AnySyncTimelineEvent>::from_json_string(
                    json.to_owned(),
                )
                .unwrap()
                .cast_unchecked(),
            )
        };
        let reaction = event(
            r#"{"type":"m.reaction","event_id":"$reaction","sender":"@alice:example.org","origin_server_ts":7,"content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}},"unsigned":{}}"#,
        );
        let message = event(
            r#"{"type":"m.room.message","event_id":"$message","sender":"@alice:example.org","origin_server_ts":8,"content":{"msgtype":"m.text","body":"hi"},"unsigned":{}}"#,
        );

        let items = super::aggregation_items([reaction, message], &rules, None);

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].timestamp, 7);
        assert!(matches!(
            &items[0].content,
            crate::protocol::TimelineItemContentView::HiddenEvent { event_type, .. }
                if event_type == "m.reaction"
        ));
    }
}
