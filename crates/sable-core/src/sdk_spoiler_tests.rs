use std::time::Duration;

use matrix_sdk::{
    attachment::AttachmentConfig, ruma::room_id, test_utils::mocks::MatrixMockServer,
};

use crate::{
    api::timeline::TimelineFocusView,
    protocol::TimelineItemContentView,
    timelines::build_room_timeline,
    view::{Highlights, LocalContent, timeline_item},
};

#[tokio::test]
async fn uploading_media_keeps_its_spoiler_in_the_local_echo() {
    for mime in ["image/png", "video/mp4"] {
        for spoiler in [false, true] {
            let server = MatrixMockServer::new().await;
            let client = server.client_builder().build().await;
            client.send_queue().set_enabled(false).await;
            let room_id = room_id!("!spoiler-upload:example.org");
            server.mock_room_state_encryption().plain().mount().await;
            let room = server.sync_joined_room(&client, room_id).await;
            let timeline = build_room_timeline(&room, &TimelineFocusView::Live, false)
                .await
                .unwrap();
            let (_, mut updates) = room.send_queue().subscribe().await.unwrap();

            room.send_queue()
                .send_attachment(
                    "spoiler-media",
                    mime.parse().unwrap(),
                    vec![1, 2, 3],
                    AttachmentConfig {
                        extra_content: spoiler.then(|| {
                            serde_json::Map::from_iter([(
                                "page.codeberg.everypizza.msc4193.spoiler".to_owned(),
                                true.into(),
                            )])
                        }),
                        ..AttachmentConfig::default()
                    },
                )
                .await
                .unwrap();

            let mut live_content = LocalContent::default();
            while let Ok(update) = updates.try_recv() {
                live_content.apply(&update);
            }
            let (echoes, _) = room.send_queue().subscribe().await.unwrap();
            let restored_content = LocalContent::new(&echoes);
            let items = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let items = timeline.items().await;
                    if items.iter().any(|item| item.as_event().is_some()) {
                        break items;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("the upload's local echo reaches the timeline");

            for local_content in [&live_content, &restored_content] {
                let item = items.iter().find(|item| item.as_event().is_some()).unwrap();
                let view = timeline_item(
                    item,
                    client.user_id(),
                    &Highlights::default(),
                    local_content,
                );
                assert!(view.event_id.is_none());
                assert!(view.send_state.is_some());
                let (TimelineItemContentView::Image {
                    spoiler: actual, ..
                }
                | TimelineItemContentView::Video {
                    spoiler: actual, ..
                }) = view.content
                else {
                    panic!("expected image or video content");
                };
                assert_eq!(actual, spoiler.then(String::new), "{mime}");
            }
        }
    }
}
