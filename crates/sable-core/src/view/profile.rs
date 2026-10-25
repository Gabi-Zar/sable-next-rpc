use sable_model::text::visible_name;

use serde::Deserialize as _;
use serde_with::{DefaultOnError, serde_as};

use crate::profiles::pronoun_sets;
use crate::protocol::PerMessageProfileView;

use super::raw::{ObjectOnly, present};

const PMP_KEYS: [&str; 2] = ["com.beeper.per_message_profile", "m.per_message_profile"];

pub(super) fn relay_profile(content: Option<&serde_json::Value>) -> Option<PerMessageProfileView> {
    let body = content?.get("body")?.as_str()?;
    let name = relay_author(body)?;

    Some(PerMessageProfileView {
        id: None,
        display_name: Some(name.to_owned()),
        avatar_url: None,
        pronouns: Vec::new(),
        color_on_light: None,
        color_on_dark: None,
        has_fallback: true,
    })
}

fn relay_author(body: &str) -> Option<&str> {
    const MAX_NAME: usize = 64;

    let line = body.lines().next()?;
    let name = if let Some(rest) = line.strip_prefix('<') {
        rest.split_once("> ")?.0
    } else {
        let name = line.split_once(": ")?.0;
        if name.contains(['<', '>']) {
            return None;
        }
        name
    };

    let trimmed = name.trim();
    visible_name(trimmed).filter(|name| name.len() <= MAX_NAME)
}

#[serde_as]
#[derive(Default, serde::Deserialize)]
#[serde(default)]
struct PerMessageProfileIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    id: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "displayname")]
    display_name: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    avatar_url: Option<String>,
    #[serde(deserialize_with = "present")]
    avatar_file: bool,
    #[serde(rename = "io.fsky.nyx.pronouns")]
    pronouns: Option<serde_json::Value>,
    #[serde_as(as = "ObjectOnly")]
    #[serde(rename = "eu.she-a.color")]
    color: Option<ProfileColorIn>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    has_fallback: Option<bool>,
}

#[serde_as]
#[derive(Default, serde::Deserialize)]
#[serde(default)]
struct ProfileColorIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    on_light: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    on_dark: Option<String>,
}

pub(crate) fn per_message_profile(
    content: Option<&serde_json::Value>,
) -> Option<PerMessageProfileView> {
    let content = content?;
    let profile = PMP_KEYS.iter().find_map(|key| content.get(*key))?;
    let profile = if profile.is_object() {
        PerMessageProfileIn::deserialize(profile).unwrap_or_default()
    } else {
        PerMessageProfileIn::default()
    };
    let color = profile.color.unwrap_or_default();
    let non_blank = |value: Option<String>| value.filter(|value| !value.trim().is_empty());

    let avatar_url = profile
        .avatar_url
        .as_deref()
        .map(str::trim)
        .filter(|url| url.is_empty() || url.starts_with("mxc://"))
        .map(ToOwned::to_owned)
        .or_else(|| profile.avatar_file.then(String::new));

    Some(PerMessageProfileView {
        id: non_blank(profile.id),
        display_name: profile.display_name.and_then(visible_name),
        avatar_url,
        pronouns: pronoun_sets(profile.pronouns.as_ref()),
        color_on_light: color.on_light,
        color_on_dark: color.on_dark,
        has_fallback: profile.has_fallback.unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;

    #[test]
    fn reads_the_author_a_relay_bot_writes_into_the_body() {
        assert_eq!(relay_author("<Marie> salut"), Some("Marie"));
        assert_eq!(relay_author("Marie: salut"), Some("Marie"));
        assert_eq!(relay_author("<Marie Dupont> salut"), Some("Marie Dupont"));
        assert_eq!(
            relay_author("<Marie> salut\nsur deux lignes"),
            Some("Marie")
        );
        assert_eq!(relay_author("Marie: a: b"), Some("Marie"));
        assert_eq!(
            relay_author("we shipped it: finally"),
            Some("we shipped it")
        );
    }

    #[test]
    fn leaves_a_body_that_names_no_author() {
        assert_eq!(relay_author("salut"), None);
        assert_eq!(relay_author("<Marie>salut"), None);
        assert_eq!(relay_author(": salut"), None);
        assert_eq!(relay_author(&format!("{}: hi", "n".repeat(65))), None);
        assert_eq!(relay_author("\nMarie: salut"), None);
    }

    #[test]
    fn synthesises_a_profile_only_from_a_body_that_names_an_author() {
        let named = relay_profile(Some(&json!({ "body": "<Marie> salut" }))).expect("profile");
        assert_eq!(named.display_name.as_deref(), Some("Marie"));
        assert!(named.has_fallback);
        assert!(relay_profile(Some(&json!({ "body": "salut" }))).is_none());
        assert!(relay_profile(Some(&json!({ "msgtype": "m.text" }))).is_none());
    }

    #[test]
    fn reads_a_per_message_profile_under_either_key() {
        let beeper = json!({ "com.beeper.per_message_profile": { "displayname": "Kris" } });
        let stable = json!({ "m.per_message_profile": { "displayname": "Kris" } });

        for content in [&beeper, &stable] {
            let profile = per_message_profile(Some(content)).expect("a profile under either key");
            assert_eq!(profile.display_name.as_deref(), Some("Kris"));
            assert!(!profile.has_fallback);
        }

        assert!(per_message_profile(Some(&json!({}))).is_none());
        assert!(per_message_profile(None).is_none());
    }

    #[test]
    fn an_empty_or_unreadable_avatar_clears_it_instead_of_falling_back() {
        let cleared = json!({ "m.per_message_profile": { "avatar_url": "" } });
        let encrypted =
            json!({ "m.per_message_profile": { "avatar_file": { "url": "mxc://e/1" } } });
        let foreign =
            json!({ "m.per_message_profile": { "avatar_url": "https://example.org/a.png" } });
        let mxc = json!({ "m.per_message_profile": { "avatar_url": "mxc://example.org/a" } });

        for content in [&cleared, &encrypted] {
            let profile = per_message_profile(Some(content)).expect("a profile");
            assert_eq!(profile.avatar_url.as_deref(), Some(""));
        }
        assert_eq!(
            per_message_profile(Some(&foreign))
                .expect("a profile")
                .avatar_url,
            None
        );
        assert_eq!(
            per_message_profile(Some(&mxc))
                .expect("a profile")
                .avatar_url
                .as_deref(),
            Some("mxc://example.org/a")
        );
    }

    #[test]
    fn a_blank_profile_name_reads_as_no_name_rather_than_an_empty_one() {
        for name in ["   ", "\u{200b}\u{2800}\u{feff}"] {
            let content = json!({ "m.per_message_profile": { "displayname": name } });
            let profile = per_message_profile(Some(&content)).expect("a profile");
            assert_eq!(profile.display_name, None);
            assert_eq!(relay_author(&format!("<{name}> hello")), None);
        }
    }

    #[test]
    fn a_wrong_typed_profile_field_reads_as_missing() {
        let profile = per_message_profile(Some(&json!({ "m.per_message_profile": {
            "id": 5,
            "displayname": ["Kris"],
            "avatar_url": 3,
            "avatar_file": null,
            "has_fallback": "yes",
            "eu.she-a.color": { "on_light": "#111111", "on_dark": 7 },
            "io.fsky.nyx.pronouns": [{ "summary": "she" }, 4],
        } })))
        .expect("a profile");

        assert_eq!(profile.id, None);
        assert_eq!(profile.display_name, None);
        assert_eq!(profile.avatar_url.as_deref(), Some(""));
        assert!(!profile.has_fallback);
        assert_eq!(profile.color_on_light.as_deref(), Some("#111111"));
        assert_eq!(profile.color_on_dark, None);
        assert_eq!(profile.pronouns.len(), 1);

        let bare = per_message_profile(Some(&json!({ "m.per_message_profile": ["x"] })))
            .expect("a profile");
        assert_eq!(bare.display_name, None);
        let arrayed = per_message_profile(Some(&json!({
            "m.per_message_profile": { "eu.she-a.color": ["#111111"] },
        })))
        .expect("a profile");
        assert_eq!(arrayed.color_on_light, None);
    }
}
