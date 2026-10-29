use serde_json::{Value, json};

use super::{Invitations, Invite, MAX_ENTRIES, MAX_STICKY_MS};

const ME: &str = "@me:example.org";
const OTHER: &str = "@other:example.org";
const SLOT: &str = "m.call#room";

fn invite(id: &str, sender: &str, origin: u64) -> Value {
    json!({
        "type":"m.rtc.invite", "event_id": id, "sender": sender,
        "origin_server_ts":origin, "sticky":{"duration_ms":300_000},
        "content": {
            "slot_id": SLOT, "sticky_key":SLOT, "sender_ts":origin, "lifetime":90_000,
            "m.mentions":{"room":true}
        }
    })
}

fn member(id: &str, sender: &str, membership: &str, origin: u64) -> Value {
    json!({
        "type":"m.rtc.member", "event_id":id, "sender":sender, "origin_server_ts":origin,
        "sticky":{"duration_ms":300_000},
        "content":{"slot_id":SLOT, "sticky_key":"PHONE", "member":{"id":"PHONE", "membership":membership}}
    })
}

fn decline(id: &str, sender: &str, target: &str, origin: u64) -> Value {
    json!({
        "type":"m.rtc.decline", "event_id":id, "sender":sender, "origin_server_ts":origin,
        "sticky":{"duration_ms":300_000},
        "content":{"sticky_key":target, "m.relates_to":{"rel_type":"m.reference", "event_id":target}}
    })
}

fn state() -> Invitations {
    let mut state = Invitations::default();
    state.slots.insert(SLOT.to_owned(), true);
    state
}

fn start(state: &mut Invitations, event: &Value, now: u64) -> Vec<Invite> {
    state.apply(event, now, true);
    state.reconcile(ME, now).0
}

#[test]
fn validates_required_fields_and_mention_types() {
    let event = invite("$invite", OTHER, 1_000);
    assert!(Invite::parse(&event, 1_000).is_some());
    for field in [
        "slot_id",
        "sender_ts",
        "lifetime",
        "m.mentions",
        "sticky_key",
    ] {
        let mut invalid = event.clone();
        invalid["content"].as_object_mut().unwrap().remove(field);
        assert!(Invite::parse(&invalid, 1_000).is_none(), "{field}");
    }
    for mentions in [
        json!({}),
        json!({"room":false}),
        json!({"user_ids":[]}),
        json!({"room":"true"}),
        json!({"room":true, "user_ids":null}),
        json!({"user_ids":["not a user"]}),
        json!([]),
    ] {
        let mut invalid = event.clone();
        invalid["content"]["m.mentions"] = mentions;
        assert!(Invite::parse(&invalid, 1_000).is_none());
    }
    for lifetime in [json!(-1), json!("90000"), json!(1.5), Value::Null] {
        let mut invalid = event.clone();
        invalid["content"]["lifetime"] = lifetime;
        assert!(Invite::parse(&invalid, 1_000).is_none());
    }
}

#[test]
fn invitations_require_stickiness_and_matching_keys() {
    let event = invite("$invite", OTHER, 1_000);
    for envelope in [
        Value::Null,
        json!({}),
        json!({"duration_ms":0}),
        json!({"duration_ms":-1}),
    ] {
        let mut invalid = event.clone();
        invalid["sticky"] = envelope;
        assert!(Invite::parse(&invalid, 1_000).is_none());
    }
    let mut invalid = event.clone();
    invalid["content"]["sticky_key"] = "different".into();
    assert!(Invite::parse(&invalid, 1_000).is_none());
    invalid = event;
    invalid["content"]["msc4354_sticky_key"] = "different".into();
    assert!(Invite::parse(&invalid, 1_000).is_none());
}

#[test]
fn deployed_slot_invites_and_pre_slot_announcements_are_distinct() {
    let mut modern = invite("$modern", OTHER, 1_000);
    modern["type"] = super::NOTIFICATION_EVENT_TYPE.into();
    modern["content"]["msc4354_sticky_key"] = modern["content"]["sticky_key"].take();
    modern["content"]
        .as_object_mut()
        .unwrap()
        .remove("sticky_key");
    assert!(Invite::parse(&modern, 1_000).unwrap().modern);
    let legacy = json!({
        "type":super::NOTIFICATION_EVENT_TYPE, "event_id":"$legacy", "sender":OTHER,
        "origin_server_ts":1000, "content":{"sender_ts":1000, "notification_type":"notification", "m.mentions":{"room":true}}
    });
    let parsed = Invite::parse(&legacy, 1_000).unwrap();
    assert!(!parsed.modern);
    assert_eq!(parsed.expires, 31_000);
    let mut invalid = legacy;
    invalid["content"]["notification_type"] = "ring".into();
    assert!(Invite::parse(&invalid, 1_000).is_none());
    invalid["content"]["lifetime"] = 30_000.into();
    assert!(Invite::parse(&invalid, 1_000).is_some());
}

#[test]
fn room_mentions_require_permission_at_receipt() {
    let event = invite("$invite", OTHER, 1_000);
    let mut state = state();
    state.apply(&event, 1_000, false);
    assert!(state.reconcile(ME, 1_000).0.is_empty());
    state.apply(&event, 1_100, true);
    assert!(state.reconcile(ME, 1_100).0.is_empty());
    let event = invite("$new", OTHER, 1_200);
    assert_eq!(start(&mut state, &event, 1_200).len(), 1);
    state.apply(&event, 1_300, false);
    assert_eq!(state.reconcile(ME, 1_300).1, Vec::<String>::new());
}

#[test]
fn explicit_recipients_do_not_require_room_mention_permission() {
    let mut event = invite("$invite", OTHER, 1_000);
    event["content"]["m.mentions"] = json!({"user_ids":[ME]});
    let mut state = state();
    state.apply(&event, 1_000, false);
    assert_eq!(state.reconcile(ME, 1_000).0.len(), 1);
    assert!(
        state
            .reconcile("@unmentioned:example.org", 1_000)
            .0
            .is_empty()
    );
    assert!(start(&mut state, &invite("$own", ME, 1_100), 1_100).is_empty());
}

#[test]
fn slot_closure_cancels_and_reopening_does_not_ring_again() {
    let mut state = state();
    assert_eq!(
        start(&mut state, &invite("$invite", OTHER, 1_000), 1_000).len(),
        1
    );
    state.slots.insert(SLOT.to_owned(), false);
    assert_eq!(state.reconcile(ME, 1_100).1, ["$invite"]);
    state.slots.insert(SLOT.to_owned(), true);
    assert!(state.reconcile(ME, 1_200).0.is_empty());
    let mut closed = Invitations::default();
    assert!(start(&mut closed, &invite("$closed", OTHER, 1_000), 1_000).is_empty());
}

#[test]
fn replaces_by_intended_expiry_then_event_id() {
    let mut state = state();
    let mut first = invite("$z", OTHER, 1_000);
    first["sticky"]["duration_ms"] = 500_000.into();
    state.apply(&first, 1_000, true);
    let mut newer_origin = invite("$newer_origin", OTHER, 2_000);
    newer_origin["sticky"]["duration_ms"] = 300_000.into();
    state.apply(&newer_origin, 2_000, true);
    assert_eq!(state.active(2_000)[0].id, "$z");
    let mut tie = invite("$a", OTHER, 1_000);
    tie["sticky"]["duration_ms"] = 500_000.into();
    state.apply(&tie, 2_000, true);
    assert_eq!(state.active(2_000)[0].id, "$z");
    tie["event_id"] = "$zz".into();
    state.apply(&tie, 2_000, true);
    assert_eq!(state.active(2_000)[0].id, "$zz");
}

#[test]
fn malformed_newer_value_replaces_the_previous_invitation() {
    let mut state = state();
    let event = invite("$first", OTHER, 1_000);
    assert_eq!(start(&mut state, &event, 1_000).len(), 1);
    let mut replacement = invite("$invalid", OTHER, 1_100);
    replacement["content"]["m.mentions"] = json!({});
    state.apply(&replacement, 1_100, true);
    assert_eq!(state.reconcile(ME, 1_100).1, ["$first"]);
    state.apply(&event, 1_200, true);
    assert!(state.reconcile(ME, 1_200).0.is_empty());
}

#[test]
fn a_withdrawal_cancels_without_reviving_an_older_value() {
    let mut state = state();
    let event = invite("$invite", OTHER, 1_000);
    assert_eq!(start(&mut state, &event, 1_000).len(), 1);
    let mut withdrawn = invite("$withdrawn", OTHER, 1_100);
    withdrawn["content"] = json!({"sticky_key":SLOT});
    state.apply(&withdrawn, 1_100, true);
    assert_eq!(state.reconcile(ME, 1_100).1, ["$invite"]);
    state.apply(&event, 1_200, true);
    assert!(state.reconcile(ME, 1_200).0.is_empty());
}

#[test]
fn redaction_before_or_after_delivery_prevents_notification() {
    let mut state = state();
    let event = invite("$invite", OTHER, 1_000);
    assert_eq!(start(&mut state, &event, 1_000).len(), 1);
    state.apply(
        &json!({"type":"m.room.redaction", "content":{"redacts":"$invite"}}),
        1_100,
        false,
    );
    assert_eq!(state.reconcile(ME, 1_100).1, ["$invite"]);
    state.apply(&event, 1_200, true);
    assert!(state.reconcile(ME, 1_200).0.is_empty());
    state.apply(
        &json!({"type":"m.room.redaction", "redacts":"$later"}),
        1_300,
        false,
    );
    assert!(start(&mut state, &invite("$later", OTHER, 1_400), 1_400).is_empty());
}

#[test]
fn sdk_removal_retires_the_map_value() {
    let mut state = state();
    let event = invite("$invite", OTHER, 1_000);
    assert_eq!(start(&mut state, &event, 1_000).len(), 1);
    state.remove_key(OTHER, "m.rtc.invite", SLOT, 1_100);
    assert_eq!(state.reconcile(ME, 1_100).1, ["$invite"]);
    assert!(start(&mut state, &event, 1_200).is_empty());
    assert_eq!(
        start(&mut state, &invite("$new", OTHER, 1_300), 1_300).len(),
        1
    );
}

#[test]
fn acting_on_another_device_cancels_the_invitation() {
    for action in [
        member("$join", ME, "join", 1_100),
        decline("$decline", ME, "$invite", 1_100),
    ] {
        let mut state = state();
        assert_eq!(
            start(&mut state, &invite("$invite", OTHER, 1_000), 1_000).len(),
            1
        );
        state.apply(&action, 1_100, false);
        assert_eq!(state.reconcile(ME, 1_100).1, ["$invite"]);
        state.remove(action["event_id"].as_str().unwrap(), 1_200);
        assert!(state.reconcile(ME, 1_200).0.is_empty());
    }
}

#[test]
fn joining_before_an_invite_and_then_leaving_does_not_reactivate_it() {
    let mut state = state();
    state.apply(&member("$join", ME, "join", 500), 500, false);
    assert!(start(&mut state, &invite("$invite", OTHER, 1_000), 1_000).is_empty());
    state.apply(&member("$leave", ME, "leave", 1_100), 1_100, false);
    assert!(state.reconcile(ME, 1_100).0.is_empty());
    state.remove("$leave", 1_200);
    assert!(state.reconcile(ME, 1_200).0.is_empty());
}

#[test]
fn a_leave_before_the_invitation_does_not_count_as_accepting() {
    let mut state = state();
    state.apply(&member("$leave", ME, "leave", 500), 500, false);
    assert_eq!(
        start(&mut state, &invite("$invite", OTHER, 1_000), 1_000).len(),
        1
    );
}

#[test]
fn another_account_cannot_accept_or_decline_for_us() {
    let mut state = state();
    let mut forged = member("$forged", OTHER, "join", 1_100);
    forged["content"]["member"]["user_id"] = ME.into();
    state.apply(&forged, 1_100, false);
    state.apply(&decline("$decline", OTHER, "$invite", 1_100), 1_100, false);
    assert_eq!(
        start(&mut state, &invite("$invite", OTHER, 1_000), 1_100).len(),
        1
    );
}

#[test]
fn malformed_decline_or_membership_does_not_count_as_acting() {
    for mut invalid in [
        member("$join", ME, "join", 1_100),
        decline("$decline", ME, "$invite", 1_100),
    ] {
        invalid["content"]["sticky_key"] = "wrong-key".into();
        let mut state = state();
        state.apply(&invalid, 1_100, false);
        assert_eq!(
            start(&mut state, &invite("$invite", OTHER, 1_000), 1_100).len(),
            1
        );
    }
}

#[test]
fn concurrent_invites_are_coalesced_even_after_the_first_is_withdrawn() {
    let mut state = state();
    let first = invite("$one", OTHER, 1_000);
    let second = invite("$two", "@second:example.org", 1_100);
    assert_eq!(start(&mut state, &first, 1_000).len(), 1);
    assert!(start(&mut state, &second, 1_100).is_empty());
    state.remove("$one", 1_200);
    let (starts, ends) = state.reconcile(ME, 1_200);
    assert!(starts.is_empty());
    assert_eq!(ends, ["$one"]);
    assert!(state.reconcile(ME, 1_300).0.is_empty());
    assert_eq!(
        start(
            &mut state,
            &invite("$later", "@second:example.org", 1_400),
            1_400
        )
        .len(),
        1
    );
}

#[test]
fn separate_slots_and_senders_keep_independent_map_entries() {
    let mut state = state();
    let mut other = invite("$other_slot", OTHER, 1_100);
    other["content"]["slot_id"] = "m.call#other".into();
    other["content"]["sticky_key"] = "m.call#other".into();
    state.slots.insert("m.call#other".into(), true);
    assert_eq!(
        start(&mut state, &invite("$one", OTHER, 1_000), 1_000).len(),
        1
    );
    assert_eq!(start(&mut state, &other, 1_100).len(), 1);
    assert_eq!(state.slots_to_check(1_100).len(), 2);
}

#[test]
fn lifetime_and_clock_skew_follow_the_current_draft() {
    let mut event = invite("$clock", OTHER, 1_000);
    event["content"]["sender_ts"] = 1_001.into();
    assert_eq!(Invite::parse(&event, 1_100).unwrap().expires, 91_000);
    event["content"]["sender_ts"] = 500.into();
    assert_eq!(Invite::parse(&event, 1_100).unwrap().expires, 90_500);
    event["content"]["lifetime"] = 0.into();
    assert!(Invite::parse(&event, 1_100).is_none());
    event["content"]["lifetime"] = 100.into();
    assert!(Invite::parse(&event, 1_100).is_none());
    event["origin_server_ts"] = 50_000_000.into();
    event["content"]["sender_ts"] = 50_000_000.into();
    event["content"]["lifetime"] = 1_000_000.into();
    assert_eq!(Invite::parse(&event, 1_100).unwrap().expires, 121_100);
}

#[test]
fn polling_cannot_extend_the_lifetime_or_sticky_expiry() {
    let mut event = invite("$future", OTHER, 50_000_000);
    event["content"]["lifetime"] = 1_000_000.into();
    event["unsigned"] = json!({"sticky_duration_remaining_ms":300_000});
    let mut state = state();
    assert_eq!(start(&mut state, &event, 1_000)[0].expires, 121_000);
    for now in [10_000, 100_000, 120_000] {
        state.apply(&event, now, true);
        assert_eq!(state.active(now)[0].expires, 121_000);
    }
    assert_eq!(state.reconcile(ME, 121_000).1, ["$future"]);
    state.apply(&event, 122_000, true);
    assert!(state.active(122_000).is_empty());
    state.apply(&event, 301_001, true);
    assert!(state.active(301_001).is_empty());
}

#[test]
fn invalid_or_expired_sticky_envelopes_do_not_replace_a_live_invite() {
    let mut state = state();
    assert_eq!(
        start(&mut state, &invite("$live", OTHER, 1_000), 1_000).len(),
        1
    );
    for envelope in [
        json!({"duration_ms":0}),
        json!({"duration_ms":-1}),
        Value::Null,
    ] {
        let mut invalid = invite("$invalid", OTHER, 1_100);
        invalid["sticky"] = envelope;
        state.apply(&invalid, 1_100, true);
        assert_eq!(state.active(1_100)[0].id, "$live");
    }
    let mut expired = invite("$expired", OTHER, 1_100);
    expired["unsigned"] = json!({"sticky_duration_remaining_ms":0});
    state.apply(&expired, 1_100, true);
    assert_eq!(state.active(1_100)[0].id, "$live");
}

#[test]
fn duplicate_check_compares_recipient_sets_and_ignores_answered_invites() {
    let mut state = state();
    let mut event = invite("$invite", OTHER, 1_000);
    event["content"]["m.mentions"] = json!({"user_ids":[ME, "@third:example.org"]});
    state.apply(&event, 1_000, true);
    let users = vec![ME.to_owned(), "@third:example.org".to_owned()];
    let candidate =
        json!({"slot_id":SLOT, "m.mentions":{"user_ids":["@third:example.org", ME, ME]}});
    assert!(state.duplicate(&candidate, &users, 1_000));
    state.apply(&decline("$decline1", ME, "$invite", 1_100), 1_100, false);
    assert!(state.duplicate(&candidate, &users, 1_100));
    state.apply(
        &decline("$decline2", "@third:example.org", "$invite", 1_200),
        1_200,
        false,
    );
    assert!(!state.duplicate(&candidate, &users, 1_200));
}

#[test]
fn cache_limits_drop_new_keys_without_discarding_updates_to_existing_keys() {
    let mut state = state();
    for i in 0..MAX_ENTRIES {
        let mut event = invite(&format!("$invite{i}"), OTHER, 1_000);
        let slot = format!("m.call#{i}");
        event["content"]["slot_id"] = slot.clone().into();
        event["content"]["sticky_key"] = slot.into();
        state.apply(&event, 1_000, true);
    }
    assert_eq!(state.entries.len(), MAX_ENTRIES);
    state.apply(&invite("$overflow", OTHER, 1_100), 1_100, true);
    assert_eq!(state.entries.len(), MAX_ENTRIES);
    let mut replacement = invite("$replace", OTHER, 1_200);
    replacement["content"]["slot_id"] = "m.call#0".into();
    replacement["content"]["sticky_key"] = "m.call#0".into();
    state.apply(&replacement, 1_200, true);
    assert!(
        state
            .entries
            .values()
            .any(|entry| entry.order.1 == "$replace")
    );
    assert!(state.active(1_200 + 300_000 + MAX_STICKY_MS).is_empty());
    assert!(state.entries.is_empty());
}

#[test]
fn lagged_snapshot_reconciliation_prevents_old_values_from_returning() {
    let mut state = state();
    let event = invite("$invite", OTHER, 1_000);
    assert_eq!(start(&mut state, &event, 1_000).len(), 1);
    state.reconcile_snapshot(&std::collections::HashSet::new(), 1_100);
    assert_eq!(state.reconcile(ME, 1_100).1, ["$invite"]);
    state.apply(&event, 1_200, true);
    assert!(state.active(1_200).is_empty());
    let newer = invite("$newer", OTHER, 1_300);
    state.apply(&newer, 1_300, true);
    state.reconcile_snapshot(&["$newer".to_owned()].into(), 1_300);
    assert_eq!(state.reconcile(ME, 1_300).0.len(), 1);
}

#[test]
fn owned_invites_remain_available_for_withdrawal_when_the_slot_closes() {
    let mut state = state();
    let event = invite("$outgoing", ME, 1_000);
    state.apply(&event, 1_000, true);
    state.slots.insert(SLOT.to_owned(), false);
    assert_eq!(state.outgoing(ME, 1_100)[0].id, "$outgoing");
    assert!(state.outgoing(OTHER, 1_100).is_empty());
    state.remove("$outgoing", 1_200);
    assert!(state.outgoing(ME, 1_200).is_empty());
}

#[test]
fn leaving_a_room_cancels_shown_invites_and_discards_the_room_state() {
    let mut state = state();
    assert_eq!(
        start(&mut state, &invite("$invite", OTHER, 1_000), 1_000).len(),
        1
    );
    assert_eq!(state.clear(), ["$invite"]);
    assert!(state.entries.is_empty());
    assert!(state.slots.is_empty());
    assert!(state.reconcile(ME, 1_100).0.is_empty());
}

#[test]
fn checking_activeness_does_not_consume_an_invitation() {
    let mut state = state();
    state.apply(&invite("$invite", OTHER, 1_000), 1_000, true);
    assert!(state.is_active_for("$invite", ME, 1_000));
    assert!(state.is_active_for("$invite", ME, 1_000));
    assert!(!state.is_active_for("$invite", OTHER, 1_000));
    assert_eq!(state.reconcile(ME, 1_000).0.len(), 1);
}

#[test]
fn activeness_rejects_replaced_closed_expired_and_answered_invitations() {
    let original = invite("$invite", OTHER, 1_000);
    let mut replaced = state();
    replaced.apply(&original, 1_000, true);
    replaced.apply(&invite("$newer", OTHER, 1_100), 1_100, true);
    assert!(!replaced.is_active_for("$invite", ME, 1_100));
    assert!(replaced.is_active_for("$newer", ME, 1_100));
    let mut closed = state();
    closed.apply(&original, 1_000, true);
    closed.slots.insert(SLOT.to_owned(), false);
    assert!(!closed.is_active_for("$invite", ME, 1_000));
    let mut expired = state();
    expired.apply(&original, 1_000, true);
    assert!(!expired.is_active_for("$invite", ME, 91_000));
    for action in [
        member("$join", ME, "join", 1_100),
        decline("$decline", ME, "$invite", 1_100),
    ] {
        let mut answered = state();
        answered.apply(&original, 1_000, true);
        answered.apply(&action, 1_100, false);
        assert!(!answered.is_active_for("$invite", ME, 1_100));
    }
}

#[test]
fn a_deployed_invitation_can_be_accepted_by_a_legacy_device() {
    let mut state = state();
    state.slots.insert("m.call#ROOM".to_owned(), true);
    let mut deployed = invite("$deployed", OTHER, 1_000);
    deployed["type"] = super::NOTIFICATION_EVENT_TYPE.into();
    deployed["content"]["slot_id"] = "m.call#ROOM".into();
    deployed["content"]["msc4354_sticky_key"] = "m.call#ROOM".into();
    deployed["content"]
        .as_object_mut()
        .unwrap()
        .remove("sticky_key");
    assert_eq!(start(&mut state, &deployed, 1_000).len(), 1);
    let legacy_join = json!({
        "type":"org.matrix.msc3401.call.member", "event_id":"$join", "sender":ME,
        "state_key":"_@me:example.org_PHONE_m.call", "origin_server_ts":1100,
        "content":{"application":"m.call", "call_id":"", "scope":"m.room", "device_id":"PHONE"}
    });
    state.apply(&legacy_join, 1_100, false);
    assert_eq!(state.reconcile(ME, 1_100).1, ["$deployed"]);
    assert!(!state.is_active_for("$deployed", ME, 1_100));
    let stable = invite("$stable", OTHER, 1_200);
    assert_eq!(start(&mut state, &stable, 1_200).len(), 1);
}

#[test]
fn unrelated_expired_or_already_left_legacy_memberships_do_not_accept() {
    for content in [
        json!({"application":"m.call", "call_id":"different", "scope":"m.room"}),
        json!({"application":"m.call", "call_id":"", "scope":"m.room", "expires":0}),
        json!({"leave_reason":{"code":"leave"}}),
        json!({"memberships":[]}),
    ] {
        let mut state = state();
        let old = json!({
            "type":"org.matrix.msc3401.call.member", "event_id":"$old", "sender":ME,
            "state_key":"_@me:example.org_PHONE_m.call", "origin_server_ts":500,
            "content":content
        });
        state.apply(&old, 1_000, false);
        let mut event = invite("$invite", OTHER, 1_000);
        event["type"] = "m.rtc.notification".into();
        event["content"] = json!({"sender_ts":1000, "lifetime":90000, "notification_type":"ring", "m.mentions":{"room":true}});
        assert_eq!(start(&mut state, &event, 1_000).len(), 1);
    }
}

#[test]
fn replaying_a_legacy_announcement_cannot_restart_its_remaining_lifetime_cap() {
    let mut event = invite("$future", OTHER, 50_000_000);
    event["type"] = "m.rtc.notification".into();
    event["content"] = json!({"sender_ts":50_000_000, "lifetime":1_000_000, "notification_type":"ring", "m.mentions":{"room":true}});
    let mut state = state();
    assert_eq!(start(&mut state, &event, 1_000)[0].expires, 121_000);
    assert_eq!(state.reconcile(ME, 121_000).1, ["$future"]);
    state.apply(&event, 122_000, true);
    assert!(state.active(122_000).is_empty());
}

fn snapshot(event: &Value) -> Vec<Value> {
    vec![
        event.clone(),
        json!({"type":"m.rtc.slot", "state_key":SLOT, "content":{"status":"open", "application":{"type":"m.call"}}}),
        json!({"type":"m.room.power_levels", "state_key":"", "content":{"users":{OTHER:50}}}),
    ]
}

#[test]
fn snapshot_validation_uses_the_current_envelope_before_parsing() {
    let event = invite("$invite", OTHER, 1_000);
    let events = snapshot(&event);
    let mut decrypted = event;
    decrypted.as_object_mut().unwrap().remove("sticky");
    let validated = super::validate_snapshot(&decrypted, &events, ME, 1_000).unwrap();
    assert!(validated.modern);
    assert_eq!(validated.event["sticky"]["duration_ms"], 300_000);
    assert!(super::validate_snapshot(&decrypted, &events[1..], ME, 1_000).is_none());
}

#[test]
fn a_fetched_invite_cannot_override_a_snapshot_replacement_or_withdrawal() {
    let event = invite("$invite", OTHER, 1_000);
    let mut events = snapshot(&event);
    events[0] = invite("$newer", OTHER, 1_100);
    assert!(super::validate_snapshot(&event, &events, ME, 1_100).is_none());
    events.push(event.clone());
    assert!(super::validate_snapshot(&event, &events, ME, 1_100).is_none());
    events[0]["content"] = json!({"sticky_key":SLOT});
    assert!(super::validate_snapshot(&event, &events, ME, 1_100).is_none());
}

#[test]
fn snapshot_validation_checks_slots_and_actions_on_other_devices() {
    let event = invite("$invite", OTHER, 1_000);
    let mut events = snapshot(&event);
    events[1]["content"]["status"] = "closed".into();
    assert!(super::validate_snapshot(&event, &events, ME, 1_100).is_none());
    events[1]["content"]["status"] = "open".into();
    for action in [
        member("$join", ME, "join", 1_100),
        member("$leave", ME, "leave", 1_100),
        decline("$decline", ME, "$invite", 1_100),
    ] {
        let mut acted = events.clone();
        acted.push(action);
        assert!(super::validate_snapshot(&event, &acted, ME, 1_100).is_none());
    }
}

#[test]
fn snapshot_room_mentions_use_current_power_levels() {
    let event = invite("$invite", OTHER, 1_000);
    let mut events = snapshot(&event);
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_some());
    events[2]["content"]["users"][OTHER] = 49.into();
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_none());
    events[2]["content"]["notifications"]["room"] = 49.into();
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_some());
    events[2]["content"]["users"][OTHER] = 0.into();
    events[0]["content"]["m.mentions"] = json!({"user_ids":[ME]});
    assert!(super::validate_snapshot(&events[0], &events, ME, 1_000).is_some());
}

#[test]
fn room_version_twelve_creators_keep_infinite_power() {
    let event = invite("$invite", OTHER, 1_000);
    let mut events = snapshot(&event);
    events[2]["content"]["users"][OTHER] = 0.into();
    events[2]["content"]["notifications"]["room"] = 1_000.into();
    events.push(json!({
        "type":"m.room.create", "state_key":"", "sender":OTHER,
        "content":{"room_version":"12"}
    }));
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_some());
    events[3]["sender"] = "@creator:example.org".into();
    events[3]["content"]["additional_creators"] = json!([OTHER]);
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_some());
    events[3]["content"]["room_version"] = "11".into();
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_none());
}

#[test]
fn creators_default_to_one_hundred_when_power_levels_are_absent() {
    let event = invite("$invite", OTHER, 1_000);
    for (version, sender, creator) in [
        ("1", "@sender:example.org", OTHER),
        ("11", OTHER, "@ignored:example.org"),
    ] {
        let mut events = snapshot(&event);
        events.pop();
        events.push(json!({
            "type":"m.room.create", "state_key":"", "sender":sender,
            "content":{"room_version":version, "creator":creator}
        }));
        assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_some());
    }
}

#[test]
fn legacy_power_level_strings_only_apply_before_room_version_ten() {
    let event = invite("$invite", OTHER, 1_000);
    let mut events = snapshot(&event);
    events[2]["content"]["users"][OTHER] = "50".into();
    events.push(json!({"type":"m.room.create", "state_key":"", "sender":"@creator:example.org", "content":{"room_version":"9"}}));
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_some());
    events[3]["content"]["room_version"] = "10".into();
    assert!(super::validate_snapshot(&event, &events, ME, 1_000).is_none());
}

#[test]
fn presentation_metadata_comes_from_the_invite_and_its_slot_members() {
    let event = invite("$invite", OTHER, 1_000);
    let mut events = snapshot(&event);
    events.push(member("$other", OTHER, "join", 500));
    events[3]["content"]["application"]["intent"] = "m.video".into();
    let validated = super::validate_snapshot(&event, &events, ME, 1_000).unwrap();
    let presentation = super::InvitePresentation::from_invite(&validated, &events).unwrap();
    assert!(presentation.has_video);
    assert_eq!(presentation.expires_at_ms, 91_000);
    events[3]["content"]["slot_id"] = "another-slot".into();
    assert!(
        !super::InvitePresentation::from_invite(&validated, &events)
            .unwrap()
            .has_video
    );
}

#[test]
fn expired_candidates_do_not_trigger_slot_lookups() {
    let mut state = state();
    state.apply(&invite("$invite", OTHER, 1_000), 1_000, true);
    assert_eq!(state.slots_to_check(1_000).len(), 1);
    assert!(state.slots_to_check(91_000).is_empty());
}

#[test]
fn a_non_call_invitation_is_valid_but_does_not_present_as_a_phone_call() {
    let event = invite("$invite", OTHER, 1_000);
    let mut events = snapshot(&event);
    events[1]["content"]["application"]["type"] = "org.example.whiteboard".into();
    let validated = super::validate_snapshot(&event, &events, ME, 1_000).unwrap();
    assert!(super::InvitePresentation::from_invite(&validated, &events).is_none());
}
