use matrix_sdk::ruma::events::GlobalAccountDataEventType;
use matrix_sdk::ruma::{OwnedEventId, OwnedRoomId};
use serde::Serialize;
use serde_json::Value;

use crate::Core;
use crate::ResultExt;
use crate::protocol::BookmarkView;
use crate::protocol::CommandErr;
use crate::room_settings::EmptyContent;

const INDEX_EVENT: &str = "pl.chrome.bookmarks.index";
const ITEM_PREFIX: &str = "pl.chrome.bookmark.";
const PREVIEW_LIMIT: usize = 120;

pub(crate) fn bookmark_id(room_id: &str, event_id: &str) -> String {
    let mut hash: i32 = 0;
    for ch in format!("{room_id}|{event_id}").encode_utf16() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(i32::from(ch));
    }
    format!("bmk_{:08x}", hash.cast_unsigned())
}

#[derive(Serialize)]
struct IndexOut<'a> {
    version: u8,
    revision: u64,
    updated_ts: u64,
    bookmark_ids: &'a [String],
}

#[derive(Serialize)]
struct ItemOut<'a> {
    version: u8,
    bookmark_id: &'a str,
    uri: String,
    room_id: &'a OwnedRoomId,
    event_id: &'a OwnedEventId,
    event_ts: u64,
    bookmarked_ts: u64,
    sender: Option<&'a str>,
    room_name: Option<String>,
    body_preview: Option<String>,
    msgtype: Option<&'a str>,
}

fn item_event(id: &str) -> GlobalAccountDataEventType {
    GlobalAccountDataEventType::from(format!("{ITEM_PREFIX}{id}"))
}

impl Core {
    async fn bookmark_account_data(&self, event_type: GlobalAccountDataEventType) -> Option<Value> {
        self.global_account_data(event_type, "bookmarks")
            .await
            .ok()
            .flatten()
            .and_then(|raw| raw.deserialize_as::<Value>().ok())
    }

    async fn bookmark_ids(&self) -> Vec<String> {
        self.bookmark_account_data(GlobalAccountDataEventType::from(INDEX_EVENT))
            .await
            .and_then(|index| {
                index.get("bookmark_ids")?.as_array().map(|ids| {
                    let mut seen = std::collections::BTreeSet::new();
                    ids.iter()
                        .filter_map(|id| id.as_str())
                        .filter(|id| seen.insert(*id))
                        .map(str::to_owned)
                        .collect()
                })
            })
            .unwrap_or_default()
    }

    pub(crate) async fn bookmarks(&self) -> Result<Vec<BookmarkView>, CommandErr> {
        let mut bookmarks = Vec::new();

        for id in self.bookmark_ids().await {
            let Some(item) = self.bookmark_account_data(item_event(&id)).await else {
                continue;
            };
            let (Some(room_id), Some(event_id)) = (
                item.get("room_id").and_then(Value::as_str),
                item.get("event_id").and_then(Value::as_str),
            ) else {
                continue;
            };

            bookmarks.push(BookmarkView {
                bookmark_id: id,
                room_id: room_id.to_owned(),
                event_id: event_id.to_owned(),
                room_name: item
                    .get("room_name")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                sender: item
                    .get("sender")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                body_preview: item
                    .get("body_preview")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                event_ts: item.get("event_ts").and_then(Value::as_u64).unwrap_or(0),
                bookmarked_ts: item
                    .get("bookmarked_ts")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            });
        }

        bookmarks.sort_by_key(|bookmark| std::cmp::Reverse(bookmark.bookmarked_ts));
        Ok(bookmarks)
    }

    pub(crate) async fn set_bookmark(
        &self,
        room_id: &OwnedRoomId,
        event_id: &OwnedEventId,
        bookmarked: bool,
        now_ms: u64,
    ) -> Result<bool, CommandErr> {
        let _guard = self.account_data_lock.lock().await;
        let id = bookmark_id(room_id.as_str(), event_id.as_str());
        let mut ids = self.bookmark_ids().await;
        let held = ids.iter().any(|candidate| candidate == &id);

        if bookmarked == held {
            return Ok(held);
        }

        if bookmarked {
            self.write_bookmark_item(&id, room_id, event_id, now_ms)
                .await?;
            ids.push(id);
        } else {
            self.put_global_account_data(item_event(&id), &EmptyContent {}, "bookmarks")
                .await?;
            ids.retain(|candidate| candidate != &id);
        }

        let revision = self
            .bookmark_account_data(GlobalAccountDataEventType::from(INDEX_EVENT))
            .await
            .and_then(|index| index.get("revision").and_then(Value::as_u64))
            .unwrap_or(0);

        self.put_global_account_data(
            GlobalAccountDataEventType::from(INDEX_EVENT),
            &IndexOut {
                version: 1,
                revision: revision.saturating_add(1),
                updated_ts: now_ms,
                bookmark_ids: &ids,
            },
            "bookmarks",
        )
        .await?;

        Ok(bookmarked)
    }

    async fn write_bookmark_item(
        &self,
        id: &str,
        room_id: &OwnedRoomId,
        event_id: &OwnedEventId,
        now_ms: u64,
    ) -> Result<(), CommandErr> {
        let room = self.room(room_id).await?;
        let encrypted = self.room_is_encrypted(&room).await?;
        let event = room
            .event(event_id, None)
            .await
            .or_failed(self, "set_bookmark")?;
        let raw = event.raw().deserialize_as::<Value>().ok();

        let body = raw
            .as_ref()
            .and_then(|value| value.pointer("/content/body"))
            .and_then(Value::as_str)
            .map(|body| {
                if body.chars().count() <= PREVIEW_LIMIT {
                    body.to_owned()
                } else {
                    format!("{}…", body.chars().take(PREVIEW_LIMIT).collect::<String>())
                }
            });

        let item = ItemOut {
            version: 1,
            bookmark_id: id,
            uri: room_id.matrix_event_uri(event_id.clone()).to_string(),
            room_id,
            event_id,
            event_ts: raw
                .as_ref()
                .and_then(|value| value.get("origin_server_ts"))
                .and_then(Value::as_u64)
                .unwrap_or(now_ms),
            bookmarked_ts: now_ms,
            sender: raw
                .as_ref()
                .and_then(|value| value.get("sender"))
                .and_then(Value::as_str),
            room_name: room.cached_display_name().map(|name| name.to_string()),
            body_preview: (!encrypted).then_some(body).flatten(),
            msgtype: raw
                .as_ref()
                .and_then(|value| value.pointer("/content/msgtype"))
                .and_then(Value::as_str),
        };
        self.put_global_account_data(item_event(id), &item, "bookmarks")
            .await
    }
}

#[cfg(test)]
mod tests {
    use matrix_sdk::ruma::{owned_event_id, owned_room_id};
    use serde_json::json;

    use super::{IndexOut, ItemOut};

    #[test]
    fn the_index_is_the_stored_shape() {
        let ids = ["bmk_1".to_owned()];
        assert_eq!(
            serde_json::to_value(IndexOut {
                version: 1,
                revision: 3,
                updated_ts: 9,
                bookmark_ids: &ids,
            })
            .unwrap(),
            json!({ "version": 1, "revision": 3, "updated_ts": 9, "bookmark_ids": ["bmk_1"] })
        );
    }

    #[test]
    fn an_item_keeps_absent_fields_as_null() {
        let room_id = owned_room_id!("!r:example.org");
        let event_id = owned_event_id!("$e");
        assert_eq!(
            serde_json::to_value(ItemOut {
                version: 1,
                bookmark_id: "bmk_1",
                uri: "matrix:roomid/r:example.org/e/e".to_owned(),
                room_id: &room_id,
                event_id: &event_id,
                event_ts: 5,
                bookmarked_ts: 6,
                sender: None,
                room_name: Some("Room".to_owned()),
                body_preview: None,
                msgtype: Some("m.text"),
            })
            .unwrap(),
            json!({
                "version": 1,
                "bookmark_id": "bmk_1",
                "uri": "matrix:roomid/r:example.org/e/e",
                "room_id": "!r:example.org",
                "event_id": "$e",
                "event_ts": 5,
                "bookmarked_ts": 6,
                "sender": null,
                "room_name": "Room",
                "body_preview": null,
                "msgtype": "m.text",
            })
        );
    }
}
