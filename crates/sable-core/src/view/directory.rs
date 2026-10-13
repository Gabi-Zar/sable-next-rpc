use std::collections::HashMap;

use matrix_sdk::RoomState;
use matrix_sdk::room_preview::RoomPreview;
use matrix_sdk::ruma::directory::PublicRoomsChunk;
use matrix_sdk::ruma::room::{JoinRuleKind, JoinRuleSummary};

use crate::api::rooms::RoomKind;
use crate::protocol::{PublicRoomView, RoomJoinRuleView, RoomPreviewView, RoomStateView};

#[must_use]
pub fn public_room(chunk: &PublicRoomsChunk) -> PublicRoomView {
    PublicRoomView {
        room_id: chunk.room_id.clone(),
        canonical_alias: chunk.canonical_alias.as_ref().map(ToString::to_string),
        name: chunk.name.clone(),
        topic: chunk.topic.clone(),
        avatar_url: chunk.avatar_url.as_ref().map(ToString::to_string),
        room_kind: RoomKind::from_room_type(chunk.room_type.as_ref()),
        num_joined_members: u32::try_from(chunk.num_joined_members).unwrap_or(u32::MAX),
        join_rule: join_rule_kind_view(&chunk.join_rule),
        guest_can_join: chunk.guest_can_join,
        world_readable: chunk.world_readable,
    }
}

const fn join_rule_kind_view(kind: &JoinRuleKind) -> RoomJoinRuleView {
    match kind {
        JoinRuleKind::Public => RoomJoinRuleView::Public,
        JoinRuleKind::Invite => RoomJoinRuleView::Invite,
        JoinRuleKind::Knock => RoomJoinRuleView::Knock,
        JoinRuleKind::Restricted => RoomJoinRuleView::Restricted,
        JoinRuleKind::KnockRestricted => RoomJoinRuleView::KnockRestricted,
        JoinRuleKind::Private => RoomJoinRuleView::Private,
        _ => RoomJoinRuleView::Unknown,
    }
}

/// Spec routing rules: the highest-power user's server (PL 50 or more), then the most populous, up to three.
#[must_use]
pub fn via_servers(members: &[(String, i64)]) -> Vec<String> {
    const MODERATOR: i64 = 50;
    const WANTED: usize = 3;

    let server_of = |user_id: &str| {
        user_id
            .split_once(':')
            .map(|(_, server)| server.to_owned())
            .filter(|server| !server.is_empty())
    };

    let mut chosen: Vec<String> = Vec::with_capacity(WANTED);

    // Ties on power level go to the lower user id, so the same room yields the
    // same link from every client.
    if let Some((user_id, _)) = members
        .iter()
        .filter(|(_, power)| *power >= MODERATOR)
        .max_by(|(left_id, left), (right_id, right)| {
            left.cmp(right).then_with(|| right_id.cmp(left_id))
        })
        && let Some(server) = server_of(user_id)
    {
        chosen.push(server);
    }

    let mut population: HashMap<String, usize> = HashMap::new();
    for (user_id, _) in members {
        if let Some(server) = server_of(user_id) {
            *population.entry(server).or_default() += 1;
        }
    }

    let mut by_population: Vec<(String, usize)> = population.into_iter().collect();
    by_population.sort_by(|(left_server, left), (right_server, right)| {
        right.cmp(left).then_with(|| left_server.cmp(right_server))
    });

    for (server, _) in by_population {
        if chosen.len() == WANTED {
            break;
        }
        if !chosen.contains(&server) {
            chosen.push(server);
        }
    }

    chosen
}

#[must_use]
pub fn room_preview_view(preview: &RoomPreview) -> RoomPreviewView {
    RoomPreviewView {
        room_id: preview.room_id.clone(),
        canonical_alias: preview.canonical_alias.as_ref().map(ToString::to_string),
        name: preview.name.clone(),
        topic: preview.topic.clone(),
        avatar_url: preview.avatar_url.as_ref().map(ToString::to_string),
        room_kind: RoomKind::from_room_type(preview.room_type.as_ref()),
        num_joined_members: u32::try_from(preview.num_joined_members).unwrap_or(u32::MAX),
        join_rule: preview
            .join_rule
            .as_ref()
            .map_or(RoomJoinRuleView::Unknown, join_rule_summary_view),
        state: preview.state.map(|state| match state {
            RoomState::Joined => RoomStateView::Joined,
            RoomState::Invited => RoomStateView::Invited,
            RoomState::Knocked => RoomStateView::Knocked,
            RoomState::Left => RoomStateView::Left,
            RoomState::Banned => RoomStateView::Banned,
        }),
    }
}

pub(super) const fn join_rule_summary_view(rule: &JoinRuleSummary) -> RoomJoinRuleView {
    match rule {
        JoinRuleSummary::Public => RoomJoinRuleView::Public,
        JoinRuleSummary::Invite => RoomJoinRuleView::Invite,
        JoinRuleSummary::Knock => RoomJoinRuleView::Knock,
        JoinRuleSummary::Restricted(_) => RoomJoinRuleView::Restricted,
        JoinRuleSummary::KnockRestricted(_) => RoomJoinRuleView::KnockRestricted,
        JoinRuleSummary::Private => RoomJoinRuleView::Private,
        _ => RoomJoinRuleView::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn members(entries: &[(&str, i64)]) -> Vec<(String, i64)> {
        entries
            .iter()
            .map(|(user_id, power)| ((*user_id).to_owned(), *power))
            .collect()
    }

    #[test]
    fn leads_with_the_server_of_the_highest_moderator() {
        let servers = via_servers(&members(&[
            ("@a:crowded.example", 0),
            ("@b:crowded.example", 0),
            ("@admin:quiet.example", 100),
        ]));

        assert_eq!(servers, ["quiet.example", "crowded.example"]);
    }

    #[test]
    fn ignores_a_user_below_the_moderator_threshold() {
        let servers = via_servers(&members(&[
            ("@a:crowded.example", 0),
            ("@b:crowded.example", 0),
            ("@almost:quiet.example", 49),
        ]));

        assert_eq!(servers, ["crowded.example", "quiet.example"]);
    }

    #[test]
    fn fills_the_remaining_slots_by_population() {
        let servers = via_servers(&members(&[
            ("@admin:first.example", 100),
            ("@a:second.example", 0),
            ("@b:second.example", 0),
            ("@c:second.example", 0),
            ("@d:third.example", 0),
            ("@e:third.example", 0),
            ("@f:fourth.example", 0),
        ]));

        assert_eq!(
            servers,
            ["first.example", "second.example", "third.example"]
        );
    }

    #[test]
    fn never_advertises_the_same_server_twice() {
        let servers = via_servers(&members(&[
            ("@admin:one.example", 100),
            ("@a:one.example", 0),
            ("@b:one.example", 0),
            ("@c:two.example", 0),
        ]));

        assert_eq!(servers, ["one.example", "two.example"]);
    }

    #[test]
    fn supplies_only_what_the_room_has() {
        assert_eq!(
            via_servers(&members(&[("@a:one.example", 0)])),
            ["one.example"]
        );
        assert!(via_servers(&[]).is_empty());
    }

    #[test]
    fn breaks_ties_deterministically() {
        let tied_power = members(&[("@b:beta.example", 100), ("@a:alpha.example", 100)]);
        let reversed = members(&[("@a:alpha.example", 100), ("@b:beta.example", 100)]);
        assert_eq!(via_servers(&tied_power), via_servers(&reversed));
        assert_eq!(via_servers(&tied_power)[0], "alpha.example");

        let tied_population = members(&[("@a:alpha.example", 0), ("@b:beta.example", 0)]);
        assert_eq!(
            via_servers(&tied_population),
            ["alpha.example", "beta.example"]
        );
    }

    #[test]
    fn skips_a_user_id_with_no_server() {
        assert!(via_servers(&members(&[("malformed", 100)])).is_empty());
    }
}
