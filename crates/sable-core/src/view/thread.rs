use matrix_sdk::ruma::OwnedEventId;
use matrix_sdk::ruma::events::room::message::MessageType;
use matrix_sdk_ui::timeline::{
    MsgLikeContent, MsgLikeKind, TimelineDetails, TimelineEventItemId, TimelineItemContent,
};
use serde::Deserialize as _;
use serde_with::{DefaultOnError, serde_as};

use crate::matrix_html::preview_body;
use sable_model::event_preview::VERIFICATION_REQUEST_MSGTYPE;

use crate::protocol::{ReplyFallbackView, ReplyView, ThreadSummaryView};

use super::content::formatted_body;
use super::media::gallery_filenames;
use super::raw::{ObjectOnly, ObjectOrDefault};

pub(super) const fn msg_like(content: &TimelineItemContent) -> Option<&MsgLikeContent> {
    match content {
        TimelineItemContent::MsgLike(msg) => Some(msg),
        _ => None,
    }
}

/// The event `content` replies to, while the SDK holds no body for it.
pub(crate) fn reply_without_body(content: &TimelineItemContent) -> Option<OwnedEventId> {
    in_reply_to(content)
        .filter(|reply| reply.body.is_none() && reply.fallback.is_none())
        .map(|reply| reply.event_id)
}

/// An unloaded event still yields its id.
pub(super) fn in_reply_to(content: &TimelineItemContent) -> Option<ReplyView> {
    let reply = msg_like(content)?.in_reply_to.as_ref()?;

    let embedded = match &reply.event {
        TimelineDetails::Ready(event) => Some(event),
        _ => None,
    };
    let sender = embedded.map(|event| event.sender.clone());
    let sender_mentioned = msg_like(content)
        .and_then(|msg| match &msg.kind {
            MsgLikeKind::Message(message) => message.mentions(),
            _ => None,
        })
        .is_some_and(|mentions| {
            sender
                .as_ref()
                .is_some_and(|sender| mentions.user_ids.contains(sender))
        });

    let (body, fallback) = embedded.map_or((None, None), |event| reply_preview(&event.content));

    Some(ReplyView {
        event_id: reply.event_id.clone(),
        sender,
        sender_mentioned,
        sender_name: embedded.and_then(|event| match &event.sender_profile {
            TimelineDetails::Ready(profile) => profile.display_name.clone(),
            _ => None,
        }),
        body,
        fallback,
    })
}

pub(super) fn thread_summary(content: &TimelineItemContent) -> Option<ThreadSummaryView> {
    let summary = msg_like(content)?.thread_summary.as_ref()?;

    // The SDK embeds no raw content for the latest reply, so the profile is looked up by id.
    let (latest_event_id, (latest_body, latest_fallback)) = match &summary.latest_event {
        TimelineDetails::Ready(event) => (
            match &event.identifier {
                TimelineEventItemId::EventId(event_id) => Some(event_id.to_string()),
                TimelineEventItemId::TransactionId(_) => None,
            },
            reply_preview(&event.content),
        ),
        _ => (None, (None, None)),
    };

    Some(ThreadSummaryView {
        num_replies: summary.num_replies,
        latest_event_id,
        latest_body,
        latest_fallback,
    })
}

#[serde_as]
#[derive(Default, serde::Deserialize)]
#[serde(default)]
struct BundledRelationsIn {
    #[serde_as(as = "ObjectOnly")]
    #[serde(rename = "m.thread")]
    thread: Option<BundledThreadIn>,
}

#[serde_as]
#[derive(Default, serde::Deserialize)]
#[serde(default)]
struct BundledThreadIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    count: Option<u64>,
    #[serde_as(as = "ObjectOrDefault")]
    latest_event: Option<BundledReplyIn>,
}

#[serde_as]
#[derive(Default, serde::Deserialize)]
#[serde(default)]
struct BundledReplyIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    event_id: Option<String>,
    #[serde_as(as = "ObjectOnly")]
    content: Option<BundledReplyContentIn>,
}

#[serde_as]
#[derive(Default, serde::Deserialize)]
#[serde(default)]
struct BundledReplyContentIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    msgtype: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    body: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    formatted_body: Option<String>,
}

pub(super) fn bundled_thread_summary(unsigned: &serde_json::Value) -> Option<ThreadSummaryView> {
    #[serde_as]
    #[derive(Default, serde::Deserialize)]
    #[serde(default)]
    struct UnsignedIn {
        #[serde_as(as = "ObjectOnly")]
        #[serde(rename = "m.relations")]
        relations: Option<BundledRelationsIn>,
    }

    if !unsigned.is_object() {
        return None;
    }
    let summary = UnsignedIn::deserialize(unsigned).ok()?.relations?.thread?;
    let count = u32::try_from(summary.count?).ok()?;
    let latest = summary.latest_event?;
    let verification = latest
        .content
        .as_ref()
        .is_some_and(|content| content.msgtype.as_deref() == Some(VERIFICATION_REQUEST_MSGTYPE));
    let latest_body = latest
        .content
        .filter(|_| !verification)
        .and_then(|content| {
            let formatted = content.formatted_body.as_deref();
            content
                .body
                .as_deref()
                .map(|body| preview_body(body, formatted))
        });

    Some(ThreadSummaryView {
        num_replies: count,
        latest_event_id: latest.event_id,
        latest_body,
        latest_fallback: verification.then_some(ReplyFallbackView::VerificationRequest),
    })
}

/// The quoted body as plain text, since a preview must not run untrusted HTML,
/// or what the event was when it has none.
fn reply_preview(content: &TimelineItemContent) -> (Option<String>, Option<ReplyFallbackView>) {
    let TimelineItemContent::MsgLike(msg) = content else {
        return (None, None);
    };
    let body = match &msg.kind {
        MsgLikeKind::Message(message) => match message.msgtype() {
            MessageType::VerificationRequest(_) => {
                return (None, Some(ReplyFallbackView::VerificationRequest));
            }
            MessageType::Gallery(gallery) if gallery.body.is_empty() => {
                gallery_filenames(gallery).join(", ")
            }
            _ => preview_body(message.body(), formatted_body(message.msgtype()).as_deref()),
        },
        MsgLikeKind::Sticker(sticker) => sticker.content().body.clone(),
        MsgLikeKind::Poll(state) => state.results().question,
        _ => return (None, None),
    };
    (Some(body), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;

    #[test]
    fn standalone_thread_root_uses_bundled_reply_summary() {
        let unsigned = json!({
            "m.relations": {
                "m.thread": {
                    "count": 3,
                    "latest_event": {
                        "event_id": "$reply:example.org",
                        "content": { "body": "Latest reply" }
                    }
                }
            }
        });

        let summary = bundled_thread_summary(&unsigned).expect("thread summary");
        assert_eq!(summary.num_replies, 3);
        assert_eq!(
            summary.latest_event_id.as_deref(),
            Some("$reply:example.org")
        );
        assert_eq!(summary.latest_body.as_deref(), Some("Latest reply"));
    }

    #[test]
    fn a_verification_request_as_the_latest_reply_shows_its_fallback_not_its_body() {
        let unsigned = json!({
            "m.relations": {
                "m.thread": {
                    "count": 1,
                    "latest_event": {
                        "event_id": "$request:example.org",
                        "content": {
                            "msgtype": "m.key.verification.request",
                            "body": "Your client does not support verification"
                        }
                    }
                }
            }
        });

        let summary = bundled_thread_summary(&unsigned).expect("thread summary");
        assert_eq!(summary.latest_body, None);
        assert_eq!(
            summary.latest_fallback,
            Some(ReplyFallbackView::VerificationRequest)
        );
    }

    #[test]
    fn a_bundled_thread_summary_tolerates_a_sparse_latest_event() {
        let summary = bundled_thread_summary(&json!({
            "m.relations": { "m.thread": { "count": 3, "latest_event": null } },
        }))
        .expect("summary");
        assert_eq!(summary.num_replies, 3);
        assert_eq!(summary.latest_event_id, None);
        assert_eq!(summary.latest_body, None);

        assert!(
            bundled_thread_summary(&json!({
                "m.relations": { "m.thread": { "count": "3", "latest_event": {} } },
            }))
            .is_none()
        );
        assert!(
            bundled_thread_summary(&json!({ "m.relations": { "m.thread": { "count": 3 } } }))
                .is_none()
        );
    }
}
