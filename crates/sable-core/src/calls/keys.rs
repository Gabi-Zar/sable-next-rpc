use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use matrix_sdk::Room;
use matrix_sdk::ruma::events::macros::EventContent;
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::{MilliSecondsSinceUnixEpoch, OwnedDeviceId, OwnedRoomId, OwnedUserId};
use matrix_sdk_base::crypto::CollectStrategy;
use serde::{Deserialize, Serialize};

use super::membership::CallMember;

pub(crate) const KEY_BYTES: usize = 16;
pub(crate) const ROTATION_GRACE_MS: u64 = 10_000;
pub(crate) const USE_KEY_DELAY_MS: u64 = 5_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct KeyPayload {
    pub(crate) index: u8,
    pub(crate) key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct MemberRef {
    pub(crate) claimed_device_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SessionRef {
    pub(crate) call_id: String,
    pub(crate) application: String,
    pub(crate) scope: String,
}

impl Default for SessionRef {
    fn default() -> Self {
        Self {
            call_id: String::new(),
            application: "m.call".to_owned(),
            scope: "m.room".to_owned(),
        }
    }
}

impl SessionRef {
    pub(crate) fn is_legacy_room_call(&self) -> bool {
        self.call_id.is_empty() && self.application == "m.call" && self.scope == "m.room"
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, EventContent)]
#[ruma_event(type = "io.element.call.encryption_keys", kind = ToDevice)]
pub(crate) struct ToDeviceCallEncryptionKeysEventContent {
    pub(crate) keys: KeyPayload,
    pub(crate) room_id: OwnedRoomId,
    pub(crate) member: MemberRef,
    #[serde(default)]
    pub(crate) session: SessionRef,
    pub(crate) sent_ts: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OutboundKey {
    pub(crate) key: [u8; KEY_BYTES],
    pub(crate) index: u8,
    pub(crate) created_ts: u64,
    pub(crate) shared_with: Vec<CallMember>,
    pub(crate) failed: Vec<CallMember>,
}

impl OutboundKey {
    pub(crate) fn generate(index: u8, created_ts: u64) -> Result<Self, getrandom::Error> {
        let mut key = [0u8; KEY_BYTES];
        getrandom::fill(&mut key)?;
        Ok(Self {
            key,
            index,
            created_ts,
            shared_with: Vec::new(),
            failed: Vec::new(),
        })
    }

    pub(crate) const fn next_index(current: Option<&Self>) -> u8 {
        match current {
            Some(key) => key.index.wrapping_add(1),
            None => 0,
        }
    }

    pub(crate) fn encoded(&self) -> String {
        STANDARD.encode(self.key)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Rollout {
    Unchanged,
    Share { targets: Vec<CallMember> },
    Rotate { targets: Vec<CallMember> },
}

pub(crate) fn plan_rollout(
    current: Option<&OutboundKey>,
    members: &[CallMember],
    now_ms: u64,
    grace_ms: u64,
) -> Rollout {
    let Some(current) = current else {
        return Rollout::Rotate {
            targets: members.to_vec(),
        };
    };

    let still_valid: Vec<&CallMember> = current
        .shared_with
        .iter()
        .filter(|shared| !rejoined(shared, members))
        .collect();

    let anyone_left = still_valid
        .iter()
        .any(|shared| !members.iter().any(|member| member.same_generation(shared)));
    if anyone_left {
        return Rollout::Rotate {
            targets: members.to_vec(),
        };
    }

    let (retry, fresh): (Vec<CallMember>, Vec<CallMember>) = members
        .iter()
        .filter(|member| {
            !still_valid
                .iter()
                .any(|shared| shared.same_generation(member))
        })
        .cloned()
        .partition(|member| {
            current
                .failed
                .iter()
                .any(|failed| failed.same_generation(member))
        });

    if fresh.is_empty() {
        return if retry.is_empty() {
            Rollout::Unchanged
        } else {
            Rollout::Share { targets: retry }
        };
    }

    if now_ms.saturating_sub(current.created_ts) < grace_ms {
        Rollout::Share {
            targets: [fresh, retry].concat(),
        }
    } else {
        Rollout::Rotate {
            targets: members.to_vec(),
        }
    }
}

pub(crate) fn rotation_wait_ms(
    current: Option<&OutboundKey>,
    now_ms: u64,
    delay_ms: u64,
) -> Option<u64> {
    let age = now_ms.saturating_sub(current?.created_ts);
    (age < delay_ms).then(|| delay_ms - age)
}

fn rejoined(shared: &CallMember, members: &[CallMember]) -> bool {
    members.iter().any(|member| {
        member.user_id == shared.user_id
            && member.device_id == shared.device_id
            && !member.same_generation(shared)
    })
}

pub(crate) struct Announcement {
    pub(crate) identity: String,
    pub(crate) index: u8,
    pub(crate) encoded: String,
}

pub(crate) enum Rolled {
    Nothing,
    Shared,
    Deferred {
        wait_ms: u64,
    },
    Rotated {
        announcement: Announcement,
        first: bool,
    },
}

pub(crate) struct KeyDistributor {
    room_id: OwnedRoomId,
    user_id: OwnedUserId,
    device_id: OwnedDeviceId,
    member_id: String,
    identity: String,
    outbound: Option<OutboundKey>,
}

impl KeyDistributor {
    pub(crate) const fn new(
        room_id: OwnedRoomId,
        user_id: OwnedUserId,
        device_id: OwnedDeviceId,
        member_id: String,
        identity: String,
    ) -> Self {
        Self {
            room_id,
            user_id,
            device_id,
            member_id,
            identity,
            outbound: None,
        }
    }

    pub(crate) async fn roll(&mut self, room: &Room, members: &[CallMember]) -> Rolled {
        match plan_rollout(self.outbound.as_ref(), members, now_ms(), ROTATION_GRACE_MS) {
            Rollout::Unchanged => Rolled::Nothing,
            Rollout::Share { targets } => {
                self.share_current(room, &targets).await;
                Rolled::Shared
            }
            Rollout::Rotate { targets } => {
                if let Some(wait_ms) =
                    rotation_wait_ms(self.outbound.as_ref(), now_ms(), USE_KEY_DELAY_MS)
                {
                    let fresh = self.unshared(&targets);
                    self.share_current(room, &fresh).await;
                    return Rolled::Deferred { wait_ms };
                }
                let first = self.outbound.is_none();
                let index = OutboundKey::next_index(self.outbound.as_ref());
                let Ok(key) = OutboundKey::generate(index, now_ms()) else {
                    tracing::error!("no entropy available for a call encryption key");
                    return Rolled::Nothing;
                };

                let reached = self.send(room, &key, &targets).await;

                let announcement = Announcement {
                    identity: self.identity.clone(),
                    index: key.index,
                    encoded: key.encoded(),
                };
                let failed = unreached(&targets, &reached);
                warn_unreached(&failed, &[]);
                self.outbound = Some(OutboundKey {
                    failed,
                    shared_with: reached,
                    ..key
                });
                Rolled::Rotated {
                    announcement,
                    first,
                }
            }
        }
    }

    fn unshared(&self, members: &[CallMember]) -> Vec<CallMember> {
        let shared = self
            .outbound
            .as_ref()
            .map_or(&[][..], |key| &key.shared_with);
        members
            .iter()
            .filter(|member| !shared.iter().any(|shared| shared.same_generation(member)))
            .cloned()
            .collect()
    }

    async fn share_current(&mut self, room: &Room, targets: &[CallMember]) {
        let Some(key) = self.outbound.clone() else {
            return;
        };
        if targets.is_empty() {
            return;
        }
        let reached = self.send(room, &key, targets).await;
        if let Some(outbound) = self.outbound.as_mut() {
            let unreached = unreached(targets, &reached);
            warn_unreached(&unreached, &outbound.failed);
            outbound
                .failed
                .retain(|failed| !targets.iter().any(|target| target.same_generation(failed)));
            outbound.failed.extend(unreached);
            outbound.shared_with.extend(reached);
        }
    }

    async fn send(
        &self,
        room: &Room,
        key: &OutboundKey,
        targets: &[CallMember],
    ) -> Vec<CallMember> {
        let encryption = room.client().encryption();
        let mut devices = Vec::new();
        let mut reached = Vec::new();
        let mut queried = Vec::new();
        for target in targets {
            if target.is_own(&self.user_id, &self.device_id) {
                reached.push(target.clone());
                continue;
            }
            let mut device = encryption
                .get_device(&target.user_id, &target.device_id)
                .await;
            if matches!(device, Ok(None)) && !queried.contains(&target.user_id) {
                queried.push(target.user_id.clone());
                if let Err(error) = encryption.request_user_identity(&target.user_id).await {
                    tracing::warn!(?error, "could not query a call member's devices");
                }
                device = encryption
                    .get_device(&target.user_id, &target.device_id)
                    .await;
            }
            match device {
                Ok(Some(device)) => {
                    devices.push(device);
                    reached.push(target.clone());
                }
                Ok(None) => tracing::warn!(
                    user_id = %target.user_id,
                    device_id = %target.device_id,
                    "call member device is unknown, cannot send it a media key"
                ),
                Err(error) => tracing::warn!(?error, "could not look up a call member device"),
            }
        }

        if devices.is_empty() {
            return reached;
        }

        let content = ToDeviceCallEncryptionKeysEventContent {
            keys: KeyPayload {
                index: key.index,
                key: key.encoded(),
            },
            room_id: self.room_id.clone(),
            member: MemberRef {
                claimed_device_id: self.device_id.to_string(),
                id: Some(self.member_id.clone()),
            },
            session: SessionRef::default(),
            sent_ts: now_ms(),
        };

        let Ok(raw) = Raw::new(&content) else {
            tracing::error!("could not serialize a call media key");
            return Vec::new();
        };

        match encryption
            .encrypt_and_send_raw_to_device(
                devices.iter().collect(),
                "io.element.call.encryption_keys",
                raw.cast_unchecked(),
                CollectStrategy::AllDevices,
            )
            .await
        {
            Ok(failures) if failures.is_empty() => reached,
            Ok(failures) => {
                tracing::warn!(
                    count = failures.len(),
                    "some call members did not receive the media key"
                );
                reached.retain(|member| {
                    !failures.iter().any(|(user_id, device_id)| {
                        *user_id == member.user_id && *device_id == member.device_id
                    })
                });
                reached
            }
            Err(error) => {
                tracing::warn!(?error, "could not send the call media key");
                reached.retain(|member| member.is_own(&self.user_id, &self.device_id));
                reached
            }
        }
    }
}

fn unreached(targets: &[CallMember], reached: &[CallMember]) -> Vec<CallMember> {
    targets
        .iter()
        .filter(|target| !reached.contains(target))
        .cloned()
        .collect()
}

fn warn_unreached(unreached: &[CallMember], known: &[CallMember]) {
    for member in unreached
        .iter()
        .filter(|member| !known.iter().any(|known| known.same_generation(member)))
    {
        tracing::warn!(
            user_id = %member.user_id,
            device_id = %member.device_id,
            "a call member did not receive the media key"
        );
    }
}

pub(crate) fn decode_key(encoded: &str) -> Option<Vec<u8>> {
    STANDARD
        .decode(encoded)
        .or_else(|_| STANDARD_NO_PAD.decode(encoded))
        .ok()
        .filter(|key| key.len() == KEY_BYTES)
}

pub(crate) fn now_ms() -> u64 {
    MilliSecondsSinceUnixEpoch::now().get().into()
}

#[cfg(test)]
mod tests {
    use matrix_sdk::ruma::owned_user_id;

    use super::super::membership::CallMember;
    use super::{
        KEY_BYTES, OutboundKey, Rollout, SessionRef, ToDeviceCallEncryptionKeysEventContent,
        decode_key, plan_rollout, rotation_wait_ms,
    };

    fn member(device: &str, created_ts: u64) -> CallMember {
        CallMember {
            user_id: owned_user_id!("@erwan:localhost"),
            device_id: device.into(),
            member_id: None,
            identity: format!("@erwan:localhost:{device}"),
            mode: crate::protocol::CallMode::Legacy,
            created_ts,
            joined_ts: created_ts,
            expires_at_ms: None,
            foci: Vec::new(),
            screen_sharing: false,
        }
    }

    fn key_shared_with(members: &[CallMember], created_ts: u64) -> OutboundKey {
        OutboundKey {
            key: [7u8; KEY_BYTES],
            index: 3,
            created_ts,
            shared_with: members.to_vec(),
            failed: Vec::new(),
        }
    }

    #[test]
    fn test_the_first_key_goes_to_everyone() {
        let members = vec![member("LAPTOP", 100), member("PHONE", 100)];

        assert_eq!(
            plan_rollout(None, &members, 1_000, 10_000),
            Rollout::Rotate { targets: members }
        );
    }

    #[test]
    fn test_a_leaver_rotates_the_key_for_everyone_still_here() {
        let laptop = member("LAPTOP", 100);
        let phone = member("PHONE", 100);
        let current = key_shared_with(&[laptop.clone(), phone], 1_000);

        assert_eq!(
            plan_rollout(Some(&current), std::slice::from_ref(&laptop), 1_100, 10_000),
            Rollout::Rotate {
                targets: vec![laptop]
            },
            "a device that left keeps the old key, so it must stop working"
        );
    }

    #[test]
    fn test_a_fresh_key_is_shared_with_a_joiner_rather_than_rotated() {
        let laptop = member("LAPTOP", 100);
        let phone = member("PHONE", 200);
        let current = key_shared_with(std::slice::from_ref(&laptop), 1_000);

        assert_eq!(
            plan_rollout(Some(&current), &[laptop, phone.clone()], 1_500, 10_000),
            Rollout::Share {
                targets: vec![phone]
            }
        );
    }

    #[test]
    fn test_a_stale_key_rotates_for_a_joiner() {
        let laptop = member("LAPTOP", 100);
        let phone = member("PHONE", 200);
        let current = key_shared_with(std::slice::from_ref(&laptop), 1_000);
        let members = vec![laptop, phone];

        assert_eq!(
            plan_rollout(Some(&current), &members, 20_000, 10_000),
            Rollout::Rotate { targets: members }
        );
    }

    #[test]
    fn test_nothing_moves_when_the_roster_is_unchanged() {
        let members = vec![member("LAPTOP", 100)];
        let current = key_shared_with(&members, 1_000);

        assert_eq!(
            plan_rollout(Some(&current), &members, 1_100, 10_000),
            Rollout::Unchanged
        );
    }

    #[test]
    fn test_a_rejoin_is_resent_to_even_though_the_device_is_the_same() {
        let before = member("PHONE", 100);
        let after = member("PHONE", 500);
        let current = key_shared_with(&[before], 1_000);

        assert_eq!(
            plan_rollout(Some(&current), std::slice::from_ref(&after), 1_100, 10_000),
            Rollout::Share {
                targets: vec![after]
            },
            "a rejoiner cleared its keys, so it needs the current one again"
        );
    }

    #[test]
    fn test_a_renewed_sticky_membership_is_not_a_rejoin() {
        let sticky = |created_ts| CallMember {
            member_id: Some("member".to_owned()),
            mode: crate::protocol::CallMode::Matrix2,
            ..member("PHONE", created_ts)
        };
        let current = key_shared_with(&[sticky(100)], 1_000);

        assert_eq!(
            plan_rollout(Some(&current), &[sticky(3_600_100)], 3_600_200, 10_000),
            Rollout::Unchanged,
            "a renewal keeps its member id, so it still holds the current key"
        );
    }

    #[test]
    fn test_a_member_that_could_not_be_reached_does_not_rotate_the_key_again() {
        let laptop = member("LAPTOP", 100);
        let ghost = member("GHOST", 200);
        let members = vec![laptop.clone(), ghost.clone()];
        let current = OutboundKey {
            failed: vec![ghost.clone()],
            ..key_shared_with(std::slice::from_ref(&laptop), 1_000)
        };

        assert_eq!(
            plan_rollout(Some(&current), &members, 20_000, 10_000),
            Rollout::Share {
                targets: vec![ghost]
            },
            "a retry is not a new joiner, so it must not force a rotation"
        );
    }

    #[test]
    fn test_a_new_joiner_still_rotates_a_stale_key_beside_a_failed_member() {
        let laptop = member("LAPTOP", 100);
        let ghost = member("GHOST", 200);
        let phone = member("PHONE", 300);
        let members = vec![laptop.clone(), ghost.clone(), phone];
        let current = OutboundKey {
            failed: vec![ghost],
            ..key_shared_with(std::slice::from_ref(&laptop), 1_000)
        };

        assert_eq!(
            plan_rollout(Some(&current), &members, 20_000, 10_000),
            Rollout::Rotate { targets: members }
        );
    }

    #[test]
    fn test_the_index_wraps_rather_than_overflowing() {
        let last = OutboundKey {
            key: [0u8; KEY_BYTES],
            index: u8::MAX,
            created_ts: 0,
            shared_with: Vec::new(),
            failed: Vec::new(),
        };

        assert_eq!(OutboundKey::next_index(Some(&last)), 0);
        assert_eq!(OutboundKey::next_index(None), 0);
    }

    #[test]
    fn test_a_key_survives_the_round_trip_padded_or_not() {
        let key = OutboundKey {
            key: [9u8; KEY_BYTES],
            index: 0,
            created_ts: 0,
            shared_with: Vec::new(),
            failed: Vec::new(),
        };
        let encoded = key.encoded();

        assert_eq!(decode_key(&encoded).as_deref(), Some(&key.key[..]));
        assert_eq!(
            decode_key(encoded.trim_end_matches('=')).as_deref(),
            Some(&key.key[..])
        );
        assert_eq!(decode_key(""), None);
    }

    #[test]
    fn test_missing_key_session_uses_the_legacy_room_call() {
        let content =
            serde_json::from_value::<ToDeviceCallEncryptionKeysEventContent>(serde_json::json!({
                "keys": { "index": 0, "key": "CQkJCQkJCQkJCQkJCQkJCQ==" },
                "room_id": "!room:example.org",
                "member": { "claimed_device_id": "DEVICE" },
                "sent_ts": 0
            }));

        assert!(content.is_ok_and(|content| content.session.is_legacy_room_call()));
    }

    #[test]
    fn test_only_the_legacy_room_call_session_is_accepted() {
        assert!(SessionRef::default().is_legacy_room_call());
        assert!(
            !SessionRef {
                application: "m.other".to_owned(),
                ..SessionRef::default()
            }
            .is_legacy_room_call()
        );
        assert!(
            !SessionRef {
                scope: "m.space".to_owned(),
                ..SessionRef::default()
            }
            .is_legacy_room_call()
        );
        assert!(
            !SessionRef {
                call_id: "call".to_owned(),
                ..SessionRef::default()
            }
            .is_legacy_room_call()
        );
    }

    #[test]
    fn test_a_rotation_waits_until_the_previous_key_is_in_use() {
        let key = OutboundKey::generate(0, 1_000).unwrap();

        assert_eq!(rotation_wait_ms(None, 1_000, 5_000), None);
        assert_eq!(rotation_wait_ms(Some(&key), 1_000, 5_000), Some(5_000));
        assert_eq!(rotation_wait_ms(Some(&key), 3_000, 5_000), Some(3_000));
        assert_eq!(rotation_wait_ms(Some(&key), 6_000, 5_000), None);
        assert_eq!(rotation_wait_ms(Some(&key), 500, 5_000), Some(5_000));
    }
}

#[cfg(all(test, not(target_family = "wasm")))]
#[expect(clippy::unwrap_used, reason = "test code")]
mod sdk_tests {
    use matrix_sdk::ruma::{device_id, owned_room_id, owned_user_id, room_id, user_id};
    use matrix_sdk::test_utils::mocks::MatrixMockServer;
    use serde_json::json;
    use wiremock::matchers::{method, path_regex};
    use wiremock::{Mock, ResponseTemplate};

    use super::super::membership::CallMember;
    use super::{KeyDistributor, OutboundKey, Rolled, now_ms};

    fn member(user_id: &str, device_id: &str) -> CallMember {
        CallMember {
            user_id: user_id.try_into().unwrap(),
            device_id: device_id.into(),
            member_id: None,
            identity: format!("{user_id}:{device_id}"),
            mode: crate::protocol::CallMode::Legacy,
            created_ts: 100,
            joined_ts: 100,
            expires_at_ms: None,
            foci: Vec::new(),
            screen_sharing: false,
        }
    }

    #[tokio::test]
    async fn a_media_key_reaches_a_device_the_store_has_not_seen() {
        let server = MatrixMockServer::new().await;
        server.mock_crypto_endpoints_preset().await;
        let alice = server
            .client_builder_for_crypto_end_to_end(
                user_id!("@alice:example.org"),
                device_id!("ALICE"),
            )
            .build()
            .await;
        let bob = server
            .client_builder_for_crypto_end_to_end(user_id!("@bob:example.org"), device_id!("BOB"))
            .build()
            .await;
        server.mock_sync().ok_and_run(&bob, |_| {}).await;
        let room = server
            .sync_joined_room(&alice, room_id!("!call:example.org"))
            .await;
        assert!(
            alice
                .encryption()
                .get_device(user_id!("@bob:example.org"), device_id!("BOB"))
                .await
                .unwrap()
                .is_none()
        );
        Mock::given(method("PUT"))
            .and(path_regex(r"/sendToDevice/m\.room\.encrypted/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(server.server())
            .await;

        let distributor = KeyDistributor::new(
            owned_room_id!("!call:example.org"),
            owned_user_id!("@alice:example.org"),
            "ALICE".into(),
            "@alice:example.org:ALICE".to_owned(),
            "@alice:example.org:ALICE".to_owned(),
        );
        let key = OutboundKey::generate(0, 100).unwrap();
        let bob_member = member("@bob:example.org", "BOB");
        let reached = distributor
            .send(&room, &key, std::slice::from_ref(&bob_member))
            .await;

        assert_eq!(reached, vec![bob_member]);
    }

    #[tokio::test]
    async fn a_leave_right_after_a_rotation_is_rotated_once_the_key_is_in_use() {
        let server = MatrixMockServer::new().await;
        let alice = server
            .client_builder_for_crypto_end_to_end(
                user_id!("@alice:example.org"),
                device_id!("ALICE"),
            )
            .build()
            .await;
        let room = server
            .sync_joined_room(&alice, room_id!("!call:example.org"))
            .await;
        let me = member("@alice:example.org", "ALICE");
        let leaver = member("@bob:example.org", "BOB");
        let mut distributor = KeyDistributor::new(
            owned_room_id!("!call:example.org"),
            owned_user_id!("@alice:example.org"),
            "ALICE".into(),
            me.identity.clone(),
            me.identity.clone(),
        );
        distributor.outbound = Some(OutboundKey {
            shared_with: vec![me.clone(), leaver],
            ..OutboundKey::generate(4, now_ms()).unwrap()
        });

        let rolled = distributor.roll(&room, std::slice::from_ref(&me)).await;

        assert!(matches!(rolled, Rolled::Deferred { wait_ms } if wait_ms > 0));
        assert_eq!(distributor.outbound.as_ref().unwrap().index, 4);

        distributor.outbound.as_mut().unwrap().created_ts = 0;
        let rolled = distributor.roll(&room, std::slice::from_ref(&me)).await;

        assert!(matches!(
            rolled,
            Rolled::Rotated { announcement, first: false } if announcement.index == 5
        ));
    }
}
