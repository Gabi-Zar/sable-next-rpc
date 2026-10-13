use matrix_sdk::ruma::EventEncryptionAlgorithm;
use matrix_sdk::ruma::OwnedRoomId;
use matrix_sdk::ruma::events::room::encryption::RoomEncryptionEventContent;
use matrix_sdk::ruma::events::room::history_visibility::{
    HistoryVisibility, RoomHistoryVisibilityEventContent,
};
use matrix_sdk::ruma::events::room::tombstone::RoomTombstoneEventContent;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use serde_with::{DefaultOnError, VecSkipError, serde_as};

use crate::Core;
use crate::protocol::{AbbreviationView, HistoryVisibilityView, RpcError};

const HISTORY_VISIBILITY_EVENT: &str = "m.room.history_visibility";
const ENCRYPTION_EVENT: &str = "m.room.encryption";
const CANONICAL_ALIAS_EVENT: &str = "m.room.canonical_alias";
const TOMBSTONE_EVENT: &str = "m.room.tombstone";
const SERVER_ACL_EVENT: &str = "m.room.server_acl";
pub(crate) const BANNER_EVENT: &str = "page.codeberg.everypizza.room.banner";
pub(crate) const MEMBER_LIST_EVENT: &str = "moe.sable.room.member_list";
const ABBREVIATIONS_EVENT: &str = "moe.sable.room.abbreviations";

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

fn read<T: Default + serde::de::DeserializeOwned>(content: Option<&Value>) -> T {
    content
        .and_then(|content| T::deserialize(content).ok())
        .unwrap_or_default()
}

#[serde_as]
#[derive(Default, Deserialize)]
struct HistoryVisibilityIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    history_visibility: Option<String>,
}

/// The spec's default when the event is missing or unreadable.
pub(crate) fn history_visibility(content: Option<&Value>) -> HistoryVisibilityView {
    match read::<HistoryVisibilityIn>(content)
        .history_visibility
        .as_deref()
    {
        Some("invited") => HistoryVisibilityView::Invited,
        Some("joined") => HistoryVisibilityView::Joined,
        Some("world_readable") => HistoryVisibilityView::WorldReadable,
        _ => HistoryVisibilityView::Shared,
    }
}

#[serde_as]
#[derive(Default, Deserialize)]
struct CanonicalAliasIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    alias: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError<VecSkipError<_>>")]
    #[serde(default)]
    alt_aliases: Vec<String>,
}

pub(crate) fn canonical_alias(content: Option<&Value>) -> (Option<String>, Vec<String>) {
    let content = read::<CanonicalAliasIn>(content);
    let mut alternatives: Vec<String> = Vec::new();
    for entry in content.alt_aliases {
        if !alternatives.contains(&entry) {
            alternatives.push(entry);
        }
    }
    (content.alias, alternatives)
}

/// The `{}` that clears a state event or account-data document.
#[derive(Serialize)]
pub(crate) struct EmptyContent {}

#[derive(Serialize)]
struct BannerOut {
    url: String,
}

#[derive(Serialize)]
struct MemberListOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    always_listed_from: Option<i64>,
}

#[derive(Serialize)]
pub(crate) struct CanonicalAliasOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    alias: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    alt_aliases: Vec<String>,
}

/// Each alternative appears once and never repeats the main address.
pub(crate) fn canonical_alias_content(
    alias: Option<&str>,
    alternatives: &[String],
) -> CanonicalAliasOut {
    let mut rest: Vec<String> = Vec::new();
    for entry in alternatives {
        if Some(entry.as_str()) != alias && !rest.contains(entry) {
            rest.push(entry.clone());
        }
    }
    CanonicalAliasOut {
        alias: alias.map(ToOwned::to_owned),
        alt_aliases: rest,
    }
}

#[serde_as]
#[derive(Default, Deserialize)]
struct BannerIn {
    #[serde(default, deserialize_with = "sable_model::field::present")]
    url: Option<UrlField>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    content: Option<NestedBannerIn>,
}

#[serde_as]
#[derive(Deserialize)]
struct NestedBannerIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    url: Option<String>,
}

/// Present even when wrong-typed, so the nested url only applies to a missing one.
#[serde_as]
#[derive(Deserialize)]
struct UrlField(#[serde_as(deserialize_as = "DefaultOnError")] Option<String>);

/// Older writers nested the url under `content`.
pub(crate) fn banner_url(content: Option<&Value>) -> Option<String> {
    let banner = read::<BannerIn>(content);
    banner
        .url
        .map_or_else(|| banner.content.and_then(|nested| nested.url), |url| url.0)
        .filter(|url| url.starts_with("mxc://"))
}

#[serde_as]
#[derive(Default, Deserialize)]
struct MemberListIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    always_listed_from: Option<i64>,
}

pub(crate) fn always_listed_from(content: Option<&Value>) -> Option<i64> {
    read::<MemberListIn>(content)
        .always_listed_from
        .filter(|level| (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(level))
}

pub(crate) struct AclEdit {
    pub(crate) allow: Vec<String>,
    pub(crate) deny: Vec<String>,
    pub(crate) remove_allow: Vec<String>,
    pub(crate) remove_deny: Vec<String>,
}

fn edited_list(current: &[String], added: &[String], removed: &[String]) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    for entry in current.iter().chain(added) {
        if !removed.contains(entry) && !list.contains(entry) {
            list.push(entry.clone());
        }
    }
    list
}

#[serde_as]
#[derive(Default, Deserialize, Serialize)]
pub(crate) struct ServerAclContent {
    #[serde_as(deserialize_as = "DefaultOnError<VecSkipError<_>>")]
    #[serde(default)]
    allow: Vec<String>,
    #[serde_as(deserialize_as = "DefaultOnError<VecSkipError<_>>")]
    #[serde(default)]
    deny: Vec<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

/// Adds and removes server globs, keeping every other field of the event.
pub(crate) fn server_acl_content(stored: Option<Value>, edit: &AclEdit) -> ServerAclContent {
    let mut content: ServerAclContent = stored
        .and_then(|stored| serde_json::from_value(stored).ok())
        .unwrap_or_default();
    content.allow = edited_list(&content.allow, &edit.allow, &edit.remove_allow);
    content.deny = edited_list(&content.deny, &edit.deny, &edit.remove_deny);
    content
}

#[serde_as]
#[derive(Default, Deserialize)]
struct AbbreviationsIn {
    #[serde_as(deserialize_as = "DefaultOnError<VecSkipError<_>>")]
    #[serde(default)]
    entries: Vec<AbbreviationIn>,
}

#[serde_as]
#[derive(Deserialize)]
struct AbbreviationIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    term: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    definition: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    cased: Option<bool>,
}

pub(crate) fn abbreviations(content: Option<&Value>) -> Vec<AbbreviationView> {
    read::<AbbreviationsIn>(content)
        .entries
        .into_iter()
        .filter_map(|entry| {
            let (term, definition) = (entry.term?, entry.definition?);
            (!term.trim().is_empty()).then(|| AbbreviationView {
                term,
                definition,
                cased: entry.cased == Some(true),
            })
        })
        .collect()
}

#[derive(Serialize)]
struct AbbreviationOut {
    term: String,
    definition: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    cased: bool,
}

#[derive(Serialize)]
pub(crate) struct AbbreviationsOut {
    entries: Vec<AbbreviationOut>,
}

/// `cased` is written only when set, as other writers of the event expect.
pub(crate) fn abbreviations_content(entries: &[AbbreviationView]) -> AbbreviationsOut {
    AbbreviationsOut {
        entries: entries
            .iter()
            .map(|entry| AbbreviationOut {
                term: entry.term.clone(),
                definition: entry.definition.clone(),
                cased: entry.cased,
            })
            .collect(),
    }
}

impl Core {
    async fn room_state(
        &self,
        room_id: &OwnedRoomId,
        event_type: &str,
    ) -> Result<Option<Value>, RpcError> {
        self.room_state_event_content(room_id.clone(), event_type.to_owned(), String::new())
            .await
    }

    async fn write_room_state(
        &self,
        room_id: OwnedRoomId,
        event_type: &str,
        content: &impl Serialize,
    ) -> Result<(), RpcError> {
        self.send_state(room_id, event_type, "", content).await?;
        Ok(())
    }

    pub(crate) async fn history_visibility(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<HistoryVisibilityView, RpcError> {
        Ok(history_visibility(
            self.room_state(room_id, HISTORY_VISIBILITY_EVENT)
                .await?
                .as_ref(),
        ))
    }

    pub(crate) async fn set_history_visibility(
        &self,
        room_id: OwnedRoomId,
        visibility: HistoryVisibilityView,
    ) -> Result<(), RpcError> {
        self.write_room_state(
            room_id,
            HISTORY_VISIBILITY_EVENT,
            &RoomHistoryVisibilityEventContent::new(match visibility {
                HistoryVisibilityView::Shared => HistoryVisibility::Shared,
                HistoryVisibilityView::Invited => HistoryVisibility::Invited,
                HistoryVisibilityView::Joined => HistoryVisibility::Joined,
                HistoryVisibilityView::WorldReadable => HistoryVisibility::WorldReadable,
            }),
        )
        .await
    }

    pub(crate) async fn enable_encryption(&self, room_id: OwnedRoomId) -> Result<(), RpcError> {
        self.write_room_state(
            room_id,
            ENCRYPTION_EVENT,
            &RoomEncryptionEventContent::new(EventEncryptionAlgorithm::MegolmV1AesSha2),
        )
        .await
    }

    pub(crate) async fn canonical_alias(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<(Option<String>, Vec<String>), RpcError> {
        Ok(canonical_alias(
            self.room_state(room_id, CANONICAL_ALIAS_EVENT)
                .await?
                .as_ref(),
        ))
    }

    pub(crate) async fn set_canonical_alias(
        &self,
        room_id: OwnedRoomId,
        alias: Option<&str>,
        alternatives: &[String],
    ) -> Result<(Option<String>, Vec<String>), RpcError> {
        let content = canonical_alias_content(alias, alternatives);
        self.write_room_state(room_id, CANONICAL_ALIAS_EVENT, &content)
            .await?;
        Ok((content.alias, content.alt_aliases))
    }

    pub(crate) async fn room_banner(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<Option<String>, RpcError> {
        Ok(banner_url(
            self.room_state(room_id, BANNER_EVENT).await?.as_ref(),
        ))
    }

    pub(crate) async fn set_room_banner(
        &self,
        room_id: OwnedRoomId,
        url: Option<&str>,
    ) -> Result<(), RpcError> {
        self.write_room_state(
            room_id,
            BANNER_EVENT,
            &BannerOut {
                url: url.unwrap_or_default().to_owned(),
            },
        )
        .await
    }

    pub(crate) async fn member_list_threshold(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<Option<i64>, RpcError> {
        Ok(always_listed_from(
            self.room_state(room_id, MEMBER_LIST_EVENT).await?.as_ref(),
        ))
    }

    pub(crate) async fn set_member_list_threshold(
        &self,
        room_id: OwnedRoomId,
        level: Option<i64>,
    ) -> Result<(), RpcError> {
        self.write_room_state(
            room_id,
            MEMBER_LIST_EVENT,
            &MemberListOut {
                always_listed_from: level,
            },
        )
        .await
    }

    pub(crate) async fn update_server_acl(
        &self,
        room_id: OwnedRoomId,
        edit: &AclEdit,
    ) -> Result<(), RpcError> {
        let stored = self.room_state(&room_id, SERVER_ACL_EVENT).await?;
        self.write_room_state(room_id, SERVER_ACL_EVENT, &server_acl_content(stored, edit))
            .await
    }

    pub(crate) async fn room_abbreviations(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<Vec<AbbreviationView>, RpcError> {
        Ok(abbreviations(
            self.room_state(room_id, ABBREVIATIONS_EVENT)
                .await?
                .as_ref(),
        ))
    }

    pub(crate) async fn set_room_abbreviations(
        &self,
        room_id: OwnedRoomId,
        entries: &[AbbreviationView],
    ) -> Result<(), RpcError> {
        self.write_room_state(
            room_id,
            ABBREVIATIONS_EVENT,
            &abbreviations_content(entries),
        )
        .await
    }

    pub(crate) async fn set_tombstone(
        &self,
        room_id: OwnedRoomId,
        replacement_room: &OwnedRoomId,
        body: &str,
    ) -> Result<(), RpcError> {
        self.write_room_state(
            room_id,
            TOMBSTONE_EVENT,
            &RoomTombstoneEventContent::new(body.to_owned(), replacement_room.clone()),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        AclEdit, abbreviations, abbreviations_content, always_listed_from, banner_url,
        canonical_alias, canonical_alias_content, history_visibility, server_acl_content,
    };

    fn to_json(content: impl serde::Serialize) -> serde_json::Value {
        serde_json::to_value(content).unwrap()
    }

    fn owned(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|entry| (*entry).to_owned()).collect()
    }

    #[test]
    fn an_acl_edit_adds_once_removes_and_keeps_other_fields() {
        let stored =
            json!({ "allow": ["*"], "deny": ["bad.example", 3], "allow_ip_literals": false });
        let edit = AclEdit {
            allow: owned(&["*", "good.example"]),
            deny: owned(&["worse.example"]),
            remove_allow: Vec::new(),
            remove_deny: owned(&["bad.example"]),
        };

        assert_eq!(
            to_json(server_acl_content(Some(stored), &edit)),
            json!({
                "allow": ["*", "good.example"],
                "deny": ["worse.example"],
                "allow_ip_literals": false,
            })
        );
    }
    use crate::protocol::{AbbreviationView, HistoryVisibilityView};

    fn entry(term: &str, definition: &str, cased: bool) -> AbbreviationView {
        AbbreviationView {
            term: term.to_owned(),
            definition: definition.to_owned(),
            cased,
        }
    }

    #[test]
    fn abbreviations_drop_malformed_entries() {
        let content = json!({ "entries": [
            null,
            "MSC",
            { "term": "", "definition": "empty term" },
            { "term": "MSC" },
            { "term": "DO", "definition": "Ocean", "cased": "yes" },
            { "term": "PR", "definition": "Pull request", "cased": true },
        ]});

        assert_eq!(
            abbreviations(Some(&content)),
            vec![
                entry("DO", "Ocean", false),
                entry("PR", "Pull request", true)
            ]
        );
        assert!(abbreviations(Some(&json!({ "entries": "nope" }))).is_empty());
        assert!(abbreviations(None).is_empty());
    }

    #[test]
    fn abbreviations_write_cased_only_when_set() {
        assert_eq!(
            to_json(abbreviations_content(&[
                entry("MSC", "Spec change", false),
                entry("DO", "Ocean", true)
            ])),
            json!({ "entries": [
                { "term": "MSC", "definition": "Spec change" },
                { "term": "DO", "definition": "Ocean", "cased": true },
            ]})
        );
    }

    #[test]
    fn history_visibility_falls_back_to_shared() {
        assert_eq!(
            history_visibility(Some(&json!({ "history_visibility": "joined" }))),
            HistoryVisibilityView::Joined
        );
        assert_eq!(
            history_visibility(Some(&json!({ "history_visibility": "nonsense" }))),
            HistoryVisibilityView::Shared
        );
        assert_eq!(history_visibility(None), HistoryVisibilityView::Shared);
    }

    #[test]
    fn canonical_alias_reads_unique_string_alternatives() {
        let content = json!({
            "alias": "#main:example.org",
            "alt_aliases": ["#a:example.org", 3, "#a:example.org", "#b:example.org"],
        });

        assert_eq!(
            canonical_alias(Some(&content)),
            (
                Some("#main:example.org".to_owned()),
                vec!["#a:example.org".to_owned(), "#b:example.org".to_owned()]
            )
        );
        assert_eq!(canonical_alias(None), (None, Vec::new()));
    }

    #[test]
    fn canonical_alias_content_drops_repeats_and_empty_fields() {
        let alternatives = vec![
            "#main:example.org".to_owned(),
            "#a:example.org".to_owned(),
            "#a:example.org".to_owned(),
        ];

        assert_eq!(
            to_json(canonical_alias_content(
                Some("#main:example.org"),
                &alternatives
            )),
            json!({ "alias": "#main:example.org", "alt_aliases": ["#a:example.org"] })
        );
        assert_eq!(to_json(canonical_alias_content(None, &[])), json!({}));
    }

    #[test]
    fn a_banner_must_be_an_mxc_uri_at_either_depth() {
        assert_eq!(
            banner_url(Some(&json!({ "url": "mxc://a/b" }))),
            Some("mxc://a/b".to_owned())
        );
        assert_eq!(
            banner_url(Some(&json!({ "content": { "url": "mxc://a/c" } }))),
            Some("mxc://a/c".to_owned())
        );
        assert_eq!(banner_url(Some(&json!({ "url": "https://a/b" }))), None);
        assert_eq!(banner_url(Some(&json!({ "url": "" }))), None);
    }

    #[test]
    fn the_member_list_threshold_is_a_safe_integer() {
        assert_eq!(
            always_listed_from(Some(&json!({ "always_listed_from": 50 }))),
            Some(50)
        );
        assert_eq!(
            always_listed_from(Some(&json!({ "always_listed_from": 1.5 }))),
            None
        );
        assert_eq!(
            always_listed_from(Some(
                &json!({ "always_listed_from": 9_007_199_254_740_992_i64 })
            )),
            None
        );
        assert_eq!(always_listed_from(Some(&json!({}))), None);
    }

    #[test]
    fn a_present_wrong_typed_banner_url_blocks_the_nested_one() {
        assert_eq!(
            banner_url(Some(
                &json!({ "url": 3, "content": { "url": "mxc://a/b" } })
            )),
            None
        );
        assert_eq!(
            banner_url(Some(
                &json!({ "url": null, "content": { "url": "mxc://a/b" } })
            )),
            None
        );
        assert_eq!(
            banner_url(Some(&json!({ "content": "x", "url": "mxc://a/c" }))),
            Some("mxc://a/c".to_owned())
        );
    }

    #[test]
    fn wrong_typed_settings_read_as_defaults() {
        assert_eq!(
            history_visibility(Some(&json!({ "history_visibility": 3 }))),
            HistoryVisibilityView::Shared
        );
        assert_eq!(
            canonical_alias(Some(&json!({ "alias": 3, "alt_aliases": "x" }))),
            (None, Vec::new())
        );
        assert_eq!(always_listed_from(Some(&json!("x"))), None);
    }
}
