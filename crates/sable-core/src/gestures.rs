use matrix_sdk::ruma::{OwnedRoomId, OwnedUserId};
use serde::Serialize;

use crate::protocol::{CommandErr, GestureView};
use crate::{Core, ResultExt};

#[derive(Serialize)]
struct MentionsOut<'a> {
    user_ids: Vec<&'a OwnedUserId>,
}

#[derive(Serialize)]
pub(crate) struct CuteEventOut<'a> {
    msgtype: &'static str,
    #[serde(rename = "m.mentions")]
    mentions: MentionsOut<'a>,
    cute_type: &'a str,
    body: &'a str,
}

#[derive(Serialize)]
pub(crate) struct HeadpatOut<'a> {
    msgtype: &'static str,
    #[serde(rename = "m.mentions")]
    mentions: MentionsOut<'a>,
    body: String,
    #[serde(rename = "fyi.cisnt.headpat")]
    headpat: bool,
}

fn mentions(target: Option<&OwnedUserId>) -> MentionsOut<'_> {
    MentionsOut {
        user_ids: target.into_iter().collect(),
    }
}

#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum GestureOut<'a> {
    Cute(CuteEventOut<'a>),
    Headpat(HeadpatOut<'a>),
}

/// The cute events `FluffyChat` sends, and the `fyi.cisnt.headpat` emote clients without
/// support still show as text.
pub(crate) fn gesture_content(
    gesture: GestureView,
    target: Option<&OwnedUserId>,
) -> GestureOut<'_> {
    let cute = |kind: &'static str, body: &'static str| {
        GestureOut::Cute(CuteEventOut {
            msgtype: "im.fluffychat.cute_event",
            mentions: mentions(target),
            cute_type: kind,
            body,
        })
    };
    match gesture {
        GestureView::Hug => cute("hug", "🤗"),
        GestureView::Cuddle => cute("cuddle", "😊"),
        GestureView::Wave => cute("wave", "👋"),
        GestureView::Poke => cute("poke", "🫵"),
        GestureView::Headpat => GestureOut::Headpat(HeadpatOut {
            msgtype: "m.emote",
            mentions: mentions(target),
            body: format!("pats {}", target.map_or("you", |user| user.as_str())),
            headpat: true,
        }),
    }
}

impl Core {
    pub(crate) async fn send_gesture(
        &self,
        room_id: &OwnedRoomId,
        gesture: GestureView,
        target: Option<&OwnedUserId>,
    ) -> Result<(), CommandErr> {
        let content = serde_json::value::to_raw_value(&gesture_content(gesture, target))
            .or_failed(self, "send_gesture")?;
        self.room(room_id)
            .await?
            .send_raw("m.room.message", content)
            .await
            .or_failed(self, "send_gesture")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use matrix_sdk::ruma::owned_user_id;
    use serde_json::json;

    use super::gesture_content;
    use crate::protocol::GestureView;

    #[test]
    fn a_cute_event_mentions_its_target() {
        let target = owned_user_id!("@someone:example.org");

        assert_eq!(
            serde_json::to_value(gesture_content(GestureView::Hug, Some(&target))).unwrap(),
            json!({
                "msgtype": "im.fluffychat.cute_event",
                "m.mentions": { "user_ids": ["@someone:example.org"] },
                "cute_type": "hug",
                "body": "🤗",
            })
        );
    }

    #[test]
    fn a_headpat_without_a_target_pats_you() {
        assert_eq!(
            serde_json::to_value(gesture_content(GestureView::Headpat, None)).unwrap(),
            json!({
                "msgtype": "m.emote",
                "m.mentions": { "user_ids": [] },
                "body": "pats you",
                "fyi.cisnt.headpat": true,
            })
        );
    }
}
