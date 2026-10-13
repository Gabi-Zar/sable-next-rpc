//! What to quote for an event read from its source, when there is no rendered
//! timeline item for it: its body, or what it was instead.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// What a quoted event was, when it has no body to show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReplyFallbackView {
    Redacted,
    Reaction { key: String },
    Redaction,
    Event { event_type: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct EventPreview {
    pub sender: Option<String>,
    pub body: Option<String>,
    pub fallback: Option<ReplyFallbackView>,
}

/// A non-empty string, or nothing for a missing, empty or wrong-typed field.
fn text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::String(text) if !text.is_empty() => Some(text),
        _ => None,
    })
}

#[derive(Default, Deserialize)]
struct Relation {
    #[serde(default, deserialize_with = "text")]
    key: Option<String>,
}

#[derive(Default, Deserialize)]
struct Content {
    #[serde(default, deserialize_with = "text")]
    body: Option<String>,
    #[serde(default, deserialize_with = "text")]
    shortcode: Option<String>,
    #[serde(
        default,
        rename = "com.beeper.reaction.shortcode",
        deserialize_with = "text"
    )]
    beeper_shortcode: Option<String>,
    #[serde(
        default,
        rename = "m.relates_to",
        deserialize_with = "crate::lenient::option"
    )]
    relates_to: Option<Relation>,
}

#[derive(Default, Deserialize)]
struct Unsigned {
    #[serde(default, deserialize_with = "crate::lenient::option")]
    redacted_because: Option<Map<String, Value>>,
}

#[derive(Deserialize)]
struct Source {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default, deserialize_with = "crate::lenient::option")]
    sender: Option<String>,
    #[serde(default, deserialize_with = "crate::lenient::option")]
    content: Option<Content>,
    #[serde(default, deserialize_with = "crate::lenient::option")]
    unsigned: Option<Unsigned>,
}

fn reaction_name(content: &Content) -> Option<String> {
    let shortcode = content
        .shortcode
        .as_ref()
        .or(content.beeper_shortcode.as_ref());
    let name = shortcode.map(|shortcode| shortcode.trim().trim_matches(':').trim().to_owned());
    name.filter(|name| !name.is_empty())
        .map(|name| format!(":{name}:"))
        .or_else(|| content.relates_to.as_ref()?.key.clone())
}

/// A custom reaction's `:shortcode:`, else its key.
#[must_use]
pub fn reaction_key(content: &Value) -> Option<String> {
    reaction_name(&Content::deserialize(content).unwrap_or_default())
}

#[must_use]
pub fn event_preview(source: &Value) -> Option<EventPreview> {
    let Source {
        kind: event_type,
        sender,
        content,
        unsigned,
    } = Source::deserialize(source).ok()?;
    let content = content.unwrap_or_default();
    let stand_in = |fallback| {
        Some(EventPreview {
            sender: sender.clone(),
            body: None,
            fallback: Some(fallback),
        })
    };
    if unsigned.is_some_and(|unsigned| unsigned.redacted_because.is_some()) {
        return stand_in(ReplyFallbackView::Redacted);
    }
    if event_type == "m.reaction"
        && let Some(key) = reaction_name(&content)
    {
        return stand_in(ReplyFallbackView::Reaction { key });
    }
    if event_type == "m.room.redaction" {
        return stand_in(ReplyFallbackView::Redaction);
    }
    if let Some(body) = content.body {
        return Some(EventPreview {
            sender,
            body: Some(body),
            fallback: None,
        });
    }
    stand_in(ReplyFallbackView::Event { event_type })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn read(source: &Value) -> EventPreview {
        event_preview(source).expect("a preview")
    }

    #[test]
    fn a_source_reads_as_its_body_or_what_it_was() {
        assert_eq!(
            read(&json!({"type": "org.example.note", "sender": "@b:x", "content": {"body": "hi"}})),
            EventPreview {
                sender: Some("@b:x".to_owned()),
                body: Some("hi".to_owned()),
                fallback: None
            }
        );
        assert_eq!(
            read(&json!({"type": "m.room.topic", "content": {}})).fallback,
            Some(ReplyFallbackView::Event {
                event_type: "m.room.topic".to_owned()
            })
        );
        assert_eq!(
            read(&json!({
                "type": "m.room.message",
                "content": {"body": "Old body"},
                "unsigned": {"redacted_because": {"type": "m.room.redaction", "content": {}}}
            }))
            .fallback,
            Some(ReplyFallbackView::Redacted)
        );
        assert_eq!(
            read(&json!({"type": "m.room.redaction", "content": {}})).fallback,
            Some(ReplyFallbackView::Redaction)
        );
        assert_eq!(
            read(&json!({
                "type": "m.reaction",
                "content": {"shortcode": "::blob::", "m.relates_to": {"key": "mxc://x/y"}}
            }))
            .fallback,
            Some(ReplyFallbackView::Reaction {
                key: ":blob:".to_owned()
            })
        );
        assert!(event_preview(&json!([])).is_none());
    }

    #[test]
    fn wrong_typed_fields_read_as_missing() {
        let preview = event_preview(&json!({
            "type": "m.room.message", "sender": 5, "content": {"body": 7},
            "unsigned": {"redacted_because": "no"}
        }))
        .unwrap();
        assert_eq!(
            preview,
            EventPreview {
                sender: None,
                body: None,
                fallback: Some(ReplyFallbackView::Event {
                    event_type: "m.room.message".to_owned()
                }),
            }
        );
        assert!(event_preview(&json!({"type": 3})).is_none());
        assert_eq!(reaction_key(&json!("nope")), None);
    }
}
