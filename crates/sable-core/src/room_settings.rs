use matrix_sdk::ruma::OwnedRoomId;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::Core;
use crate::protocol::{AbbreviationView, CommandErr, HistoryVisibilityView};

const HISTORY_VISIBILITY_EVENT: &str = "m.room.history_visibility";
const ENCRYPTION_EVENT: &str = "m.room.encryption";
const MEGOLM: &str = "m.megolm.v1.aes-sha2";
const CANONICAL_ALIAS_EVENT: &str = "m.room.canonical_alias";
const TOMBSTONE_EVENT: &str = "m.room.tombstone";
const SERVER_ACL_EVENT: &str = "m.room.server_acl";
pub(crate) const BANNER_EVENT: &str = "page.codeberg.everypizza.room.banner";
pub(crate) const MEMBER_LIST_EVENT: &str = "moe.sable.room.member_list";
const ABBREVIATIONS_EVENT: &str = "moe.sable.room.abbreviations";

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// The spec's default when the event is missing or unreadable.
pub(crate) fn history_visibility(content: Option<&Value>) -> HistoryVisibilityView {
    match content
        .and_then(|content| content.get("history_visibility"))
        .and_then(Value::as_str)
    {
        Some("invited") => HistoryVisibilityView::Invited,
        Some("joined") => HistoryVisibilityView::Joined,
        Some("world_readable") => HistoryVisibilityView::WorldReadable,
        _ => HistoryVisibilityView::Shared,
    }
}

const fn history_visibility_name(visibility: HistoryVisibilityView) -> &'static str {
    match visibility {
        HistoryVisibilityView::Shared => "shared",
        HistoryVisibilityView::Invited => "invited",
        HistoryVisibilityView::Joined => "joined",
        HistoryVisibilityView::WorldReadable => "world_readable",
    }
}

pub(crate) fn canonical_alias(content: Option<&Value>) -> (Option<String>, Vec<String>) {
    let alias = content
        .and_then(|content| content.get("alias"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let mut alternatives: Vec<String> = Vec::new();
    for entry in content
        .and_then(|content| content.get("alt_aliases"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if !alternatives.iter().any(|known| known == entry) {
            alternatives.push(entry.to_owned());
        }
    }
    (alias, alternatives)
}

/// The `{}` that clears a state event or account-data document.
#[derive(Serialize)]
pub(crate) struct EmptyContent {}

#[derive(Serialize)]
struct HistoryVisibilityOut {
    history_visibility: &'static str,
}

#[derive(Serialize)]
struct EncryptionOut {
    algorithm: &'static str,
}

#[derive(Serialize)]
struct BannerOut<'a> {
    url: &'a str,
}

#[derive(Serialize)]
struct MemberListOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    always_listed_from: Option<i64>,
}

#[derive(Serialize)]
struct TombstoneOut<'a> {
    body: &'a str,
    replacement_room: &'a OwnedRoomId,
}

#[derive(Serialize)]
pub(crate) struct CanonicalAliasOut<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    alias: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    alt_aliases: Vec<&'a str>,
}

/// Each alternative appears once and never repeats the main address.
pub(crate) fn canonical_alias_content<'a>(
    alias: Option<&'a str>,
    alternatives: &'a [String],
) -> CanonicalAliasOut<'a> {
    let mut rest: Vec<&str> = Vec::new();
    for entry in alternatives {
        if Some(entry.as_str()) != alias && !rest.contains(&entry.as_str()) {
            rest.push(entry);
        }
    }
    CanonicalAliasOut {
        alias,
        alt_aliases: rest,
    }
}

/// Older writers nested the url under `content`.
pub(crate) fn banner_url(content: Option<&Value>) -> Option<String> {
    let content = content?;
    content
        .get("url")
        .or_else(|| content.get("content").and_then(|nested| nested.get("url")))
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("mxc://"))
        .map(ToOwned::to_owned)
}

pub(crate) fn always_listed_from(content: Option<&Value>) -> Option<i64> {
    content?
        .get("always_listed_from")?
        .as_i64()
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

/// A list that is not an array reads as empty and non-string entries are dropped.
fn lenient_strings<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(entries) => entries
            .into_iter()
            .filter_map(|entry| match entry {
                Value::String(text) => Some(text),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    })
}

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct ServerAclContent {
    #[serde(default, deserialize_with = "lenient_strings")]
    allow: Vec<String>,
    #[serde(default, deserialize_with = "lenient_strings")]
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

pub(crate) fn abbreviations(content: Option<&Value>) -> Vec<AbbreviationView> {
    content
        .and_then(|content| content.get("entries"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let term = entry.get("term")?.as_str()?;
            let definition = entry.get("definition")?.as_str()?;
            (!term.trim().is_empty()).then(|| AbbreviationView {
                term: term.to_owned(),
                definition: definition.to_owned(),
                cased: entry.get("cased").and_then(Value::as_bool) == Some(true),
            })
        })
        .collect()
}

#[derive(Serialize)]
struct AbbreviationOut<'a> {
    term: &'a str,
    definition: &'a str,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    cased: bool,
}

#[derive(Serialize)]
pub(crate) struct AbbreviationsOut<'a> {
    entries: Vec<AbbreviationOut<'a>>,
}

/// `cased` is written only when set, as other writers of the event expect.
pub(crate) fn abbreviations_content(entries: &[AbbreviationView]) -> AbbreviationsOut<'_> {
    AbbreviationsOut {
        entries: entries
            .iter()
            .map(|entry| AbbreviationOut {
                term: &entry.term,
                definition: &entry.definition,
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
    ) -> Result<Option<Value>, CommandErr> {
        self.room_state_event_content(room_id.clone(), event_type.to_owned(), String::new())
            .await
    }

    async fn write_room_state(
        &self,
        room_id: OwnedRoomId,
        event_type: &str,
        content: &impl Serialize,
    ) -> Result<(), CommandErr> {
        self.send_state(room_id, event_type, "", content).await?;
        Ok(())
    }

    pub(crate) async fn history_visibility(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<HistoryVisibilityView, CommandErr> {
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
    ) -> Result<(), CommandErr> {
        self.write_room_state(
            room_id,
            HISTORY_VISIBILITY_EVENT,
            &HistoryVisibilityOut {
                history_visibility: history_visibility_name(visibility),
            },
        )
        .await
    }

    pub(crate) async fn enable_encryption(&self, room_id: OwnedRoomId) -> Result<(), CommandErr> {
        self.write_room_state(
            room_id,
            ENCRYPTION_EVENT,
            &EncryptionOut { algorithm: MEGOLM },
        )
        .await
    }

    pub(crate) async fn canonical_alias(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<(Option<String>, Vec<String>), CommandErr> {
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
    ) -> Result<(Option<String>, Vec<String>), CommandErr> {
        let content = canonical_alias_content(alias, alternatives);
        self.write_room_state(room_id, CANONICAL_ALIAS_EVENT, &content)
            .await?;
        Ok((
            content.alias.map(ToOwned::to_owned),
            content
                .alt_aliases
                .into_iter()
                .map(ToOwned::to_owned)
                .collect(),
        ))
    }

    pub(crate) async fn room_banner(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<Option<String>, CommandErr> {
        Ok(banner_url(
            self.room_state(room_id, BANNER_EVENT).await?.as_ref(),
        ))
    }

    pub(crate) async fn set_room_banner(
        &self,
        room_id: OwnedRoomId,
        url: Option<&str>,
    ) -> Result<(), CommandErr> {
        self.write_room_state(
            room_id,
            BANNER_EVENT,
            &BannerOut {
                url: url.unwrap_or_default(),
            },
        )
        .await
    }

    pub(crate) async fn member_list_threshold(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<Option<i64>, CommandErr> {
        Ok(always_listed_from(
            self.room_state(room_id, MEMBER_LIST_EVENT).await?.as_ref(),
        ))
    }

    pub(crate) async fn set_member_list_threshold(
        &self,
        room_id: OwnedRoomId,
        level: Option<i64>,
    ) -> Result<(), CommandErr> {
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
    ) -> Result<(), CommandErr> {
        let stored = self.room_state(&room_id, SERVER_ACL_EVENT).await?;
        self.write_room_state(room_id, SERVER_ACL_EVENT, &server_acl_content(stored, edit))
            .await
    }

    pub(crate) async fn room_abbreviations(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<Vec<AbbreviationView>, CommandErr> {
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
    ) -> Result<(), CommandErr> {
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
    ) -> Result<(), CommandErr> {
        self.write_room_state(
            room_id,
            TOMBSTONE_EVENT,
            &TombstoneOut {
                body,
                replacement_room,
            },
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
}
