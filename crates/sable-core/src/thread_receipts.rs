use std::collections::BTreeSet;

use matrix_sdk::Room;
use matrix_sdk::ruma::OwnedEventId;
use matrix_sdk_base::read_receipts::ReadReceipts;
use matrix_sdk_common::serde_helpers::extract_thread_root;

/// Threads are found among the events the room's cache holds, so one whose
/// replies have all left the cache is not seen.
pub(crate) async fn thread_receipts(room: &Room) -> Vec<(OwnedEventId, ReadReceipts)> {
    let Ok((cache, _handles)) = room
        .event_cache()
        .await
        .inspect_err(|error| tracing::warn!("thread read state unavailable: {error}"))
    else {
        return Vec::new();
    };
    let Ok(events) = cache
        .events()
        .await
        .inspect_err(|error| tracing::warn!("thread read state unavailable: {error}"))
    else {
        return Vec::new();
    };
    let roots: BTreeSet<_> = events
        .iter()
        .filter_map(|event| extract_thread_root(event.raw()))
        .collect();

    let client = room.client();
    let event_cache = client.event_cache();
    let mut threads = Vec::new();
    for root in roots {
        let Ok(Some(info)) = event_cache.thread_info(room.room_id(), &root).await else {
            continue;
        };
        threads.push((root, info.read_receipts));
    }
    threads
}
