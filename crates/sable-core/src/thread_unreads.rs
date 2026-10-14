//! The SDK keeps a room's own counts to its main timeline and counts each thread
//! apart, so the room list adds the threads back in.

use std::collections::{BTreeSet, HashMap};

use matrix_sdk::executor::{JoinHandleExt, spawn};
use matrix_sdk::ruma::{OwnedEventId, OwnedRoomId, RoomId};
use matrix_sdk::{Client, Room};
use matrix_sdk_base::read_receipts::ReadReceipts;
use matrix_sdk_common::serde_helpers::extract_thread_root;
use tokio::sync::mpsc;

use crate::Task;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ThreadCounts {
    pub unread: u32,
    pub notifying: u32,
    pub highlight: u32,
}

impl ThreadCounts {
    fn of(receipts: &ReadReceipts) -> Self {
        let count = |value: u64| u32::try_from(value).unwrap_or(u32::MAX);
        Self {
            unread: count(receipts.num_unread),
            notifying: count(receipts.num_notifications),
            highlight: count(receipts.num_mentions),
        }
    }

    const fn any(self) -> bool {
        self.unread > 0 || self.notifying > 0 || self.highlight > 0
    }

    pub(crate) const fn plus(self, other: Self) -> Self {
        Self {
            unread: self.unread.saturating_add(other.unread),
            notifying: self.notifying.saturating_add(other.notifying),
            highlight: self.highlight.saturating_add(other.highlight),
        }
    }

    pub(crate) const fn minus(self, other: Self) -> Self {
        Self {
            unread: self.unread.saturating_sub(other.unread),
            notifying: self.notifying.saturating_sub(other.notifying),
            highlight: self.highlight.saturating_sub(other.highlight),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ThreadUnread {
    pub counts: ThreadCounts,
    pub roots: Vec<OwnedEventId>,
}

/// Threads are found among the events the room's cache holds, so one whose
/// replies have all left the cache is not seen.
pub(crate) async fn thread_unread(room: &Room) -> ThreadUnread {
    let Ok((cache, _handles)) = room
        .event_cache()
        .await
        .inspect_err(|error| tracing::warn!("thread unread counts unavailable: {error}"))
    else {
        return ThreadUnread::default();
    };
    let Ok(events) = cache
        .events()
        .await
        .inspect_err(|error| tracing::warn!("thread unread counts unavailable: {error}"))
    else {
        return ThreadUnread::default();
    };
    let roots: BTreeSet<_> = events
        .iter()
        .filter_map(|event| extract_thread_root(event.raw()))
        .collect();

    let client = room.client();
    let event_cache = client.event_cache();
    let mut unread = ThreadUnread::default();
    for root in roots {
        let Ok(Some(info)) = event_cache.thread_info(room.room_id(), &root).await else {
            continue;
        };
        let counts = ThreadCounts::of(&info.read_receipts);
        if counts.any() {
            unread.counts = unread.counts.plus(counts);
            unread.roots.push(root);
        }
    }
    unread
}

/// Tells when a thread holding unread messages is read from another device,
/// which changes no count of the room.
pub(crate) struct ThreadWatch {
    client: Client,
    changed: mpsc::UnboundedSender<OwnedRoomId>,
    watched: HashMap<(OwnedRoomId, OwnedEventId), Task>,
}

impl ThreadWatch {
    pub(crate) fn new(client: Client) -> (Self, mpsc::UnboundedReceiver<OwnedRoomId>) {
        let (changed, receiver) = mpsc::unbounded_channel();
        (
            Self {
                client,
                changed,
                watched: HashMap::new(),
            },
            receiver,
        )
    }

    pub(crate) fn watch(&mut self, room_id: &RoomId, roots: &[OwnedEventId]) {
        self.watched
            .retain(|(room, root), _| room != room_id || roots.contains(root));
        for root in roots {
            let key = (room_id.to_owned(), root.clone());
            if self.watched.contains_key(&key) {
                continue;
            }
            let client = self.client.clone();
            let changed = self.changed.clone();
            let task = spawn(async move {
                let (room_id, root) = key;
                let Ok((cache, _handles)) = client.event_cache().thread(&room_id, &root).await
                else {
                    return;
                };
                let Ok(mut info) = cache.subscribe_to_thread_info().await else {
                    return;
                };
                while info.next().await.is_some() {
                    if changed.send(room_id.clone()).is_err() {
                        break;
                    }
                }
            })
            .abort_on_drop();
            self.watched
                .insert((room_id.to_owned(), root.clone()), task);
        }
    }
}
