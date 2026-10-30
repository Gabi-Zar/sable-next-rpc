use std::collections::HashSet;

use icu_properties::{
    CodePointSetData,
    props::{Emoji, EmojiComponent},
};
use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

const QUICK_REACTIONS: [&str; 6] = ["🎉", "👀", "✅", "🙏", "🔥", "💜"];
const RECENT_IMAGES: usize = 16;
const FREQUENT_REACTIONS: usize = 24;

#[derive(Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(untagged)]
pub enum EmoteCell {
    Emoji { emoji: String },
    Image { image: Box<PackImageView> },
}

#[derive(Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct EmoteRecentsInput {
    pub recent: Vec<String>,
    pub frequent: Vec<String>,
    pub images: Vec<PackImageView>,
    pub unicode: bool,
    pub reactions: bool,
}

#[derive(Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct EmoteRecents {
    pub images: Vec<PackImageView>,
    pub cells: Vec<EmoteCell>,
}

#[must_use]
pub fn reaction_identity(key: &str) -> String {
    key.chars()
        .filter(|ch| !matches!(ch, '\u{fe0e}' | '\u{fe0f}'))
        .collect()
}

#[must_use]
pub fn quick_reactions(frequent: &[String], limit: usize) -> Vec<String> {
    let keys: Vec<&str> = if frequent.is_empty() {
        QUICK_REACTIONS.to_vec()
    } else {
        frequent.iter().map(String::as_str).collect()
    };
    let mut seen = HashSet::new();
    keys.into_iter()
        .filter(|key| seen.insert(reaction_identity(key)))
        .take(limit)
        .map(str::to_owned)
        .collect()
}

fn unicode_emoji(key: &str) -> bool {
    let emoji = CodePointSetData::new::<Emoji>();
    let component = CodePointSetData::new::<EmojiComponent>();
    !key.is_ascii()
        && key.graphemes(true).count() == 1
        && key
            .chars()
            .all(|ch| emoji.contains(ch) || component.contains(ch))
}

#[must_use]
pub fn emote_recents(input: &EmoteRecentsInput) -> EmoteRecents {
    let mut seen_images = HashSet::new();
    let images: Vec<_> = input
        .recent
        .iter()
        .filter_map(|key| {
            input
                .images
                .iter()
                .find(|image| image.url == *key)
                .or_else(|| input.images.iter().find(|image| image.shortcode == *key))
        })
        .filter(|image| seen_images.insert(&image.url))
        .take(RECENT_IMAGES)
        .cloned()
        .collect();
    if !input.unicode {
        return EmoteRecents {
            cells: images
                .iter()
                .cloned()
                .map(|image| EmoteCell::Image {
                    image: Box::new(image),
                })
                .collect(),
            images,
        };
    }
    let keys = input
        .recent
        .iter()
        .filter(|key| !input.reactions && unicode_emoji(key))
        .chain(input.frequent.iter().take(FREQUENT_REACTIONS));
    let mut seen = HashSet::new();
    let mut cells: Vec<_> = keys
        .filter(|key| seen.insert(reaction_identity(key)))
        .filter_map(|key| {
            input
                .images
                .iter()
                .find(|image| image.url == *key)
                .map_or_else(
                    || {
                        (input.reactions || !key.starts_with("mxc://"))
                            .then(|| EmoteCell::Emoji { emoji: key.clone() })
                    },
                    |image| {
                        Some(EmoteCell::Image {
                            image: Box::new(image.clone()),
                        })
                    },
                )
        })
        .collect();
    if !input.reactions {
        cells.extend(
            images
                .iter()
                .filter(|image| seen.insert(reaction_identity(&image.url)))
                .cloned()
                .map(|image| EmoteCell::Image {
                    image: Box::new(image),
                }),
        );
    }
    EmoteRecents { images, cells }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct PackImageView {
    pub shortcode: String,
    pub url: String,
    pub body: Option<String>,
    pub usage: Vec<ImageUsageView>,
    pub info: Option<PackImageInfoView>,
    pub source_pack: Option<ImageSourcePackView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ImageSourcePackView {
    pub room_id: String,
    pub state_key: String,
    pub shortcode: String,
    pub via: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(default)]
pub struct PackImageInfoView {
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub width: Option<u32>,
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub height: Option<u32>,
    pub mimetype: Option<String>,
    #[cfg_attr(feature = "typegen", specta(type = Option<specta_typescript::Number>))]
    pub size: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ImageUsageView {
    Emoticon,
    Sticker,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(shortcode: &str, url: &str) -> PackImageView {
        PackImageView {
            shortcode: shortcode.to_owned(),
            url: url.to_owned(),
            body: None,
            usage: vec![ImageUsageView::Emoticon],
            info: None,
            source_pack: None,
        }
    }

    fn keys(cells: &[EmoteCell]) -> Vec<&str> {
        cells
            .iter()
            .map(|cell| match cell {
                EmoteCell::Emoji { emoji } => emoji.as_str(),
                EmoteCell::Image { image } => image.url.as_str(),
            })
            .collect()
    }

    #[test]
    fn quick_reactions_use_defaults_only_without_history() {
        assert_eq!(quick_reactions(&[], 2), ["🎉", "👀"]);
        assert_eq!(
            quick_reactions(&["❤".into(), "❤️".into(), "👍🏽".into(), "👍".into()], 3),
            ["❤", "👍🏽", "👍"]
        );
        assert_eq!(quick_reactions(&["🐈".into()], 4), ["🐈"]);
        assert_eq!(quick_reactions(&[], 0), Vec::<String>::new());
    }

    #[test]
    fn reaction_picker_keeps_history_order_and_excludes_composer_recents() {
        let result = emote_recents(&EmoteRecentsInput {
            recent: vec!["wave".into()],
            frequent: vec![
                "❤".into(),
                "❤️".into(),
                "mxc://example.org/missing".into(),
                "nice work".into(),
            ],
            images: vec![image("wave", "mxc://example.org/wave")],
            unicode: true,
            reactions: true,
        });
        assert_eq!(
            keys(&result.cells),
            ["❤", "mxc://example.org/missing", "nice work"]
        );
    }

    #[test]
    fn composer_resolves_aliases_and_keeps_unicode_without_duplicate_images() {
        let result = emote_recents(&EmoteRecentsInput {
            recent: [
                "wave",
                "mxc://example.org/wave",
                "❤️",
                "❤",
                "🇫🇷",
                "1️⃣",
                "猫",
                "missing",
            ]
            .map(str::to_owned)
            .to_vec(),
            frequent: ["❤︎", "mxc://example.org/wave", "mxc://example.org/missing"]
                .map(str::to_owned)
                .to_vec(),
            images: vec![image("wave", "mxc://example.org/wave")],
            unicode: true,
            reactions: false,
        });
        assert_eq!(result.images.len(), 1);
        assert_eq!(
            keys(&result.cells),
            ["❤️", "🇫🇷", "1️⃣", "mxc://example.org/wave"]
        );
    }

    #[test]
    fn picker_limits_reactions_and_recent_images_separately() {
        let images: Vec<_> = (0..40)
            .map(|index| {
                image(
                    &format!("emote{index}"),
                    &format!("mxc://example.org/{index}"),
                )
            })
            .collect();
        let mut input = EmoteRecentsInput {
            recent: images.iter().map(|image| image.url.clone()).collect(),
            frequent: images.iter().map(|image| image.url.clone()).collect(),
            images,
            unicode: true,
            reactions: true,
        };
        let result = emote_recents(&input);
        assert_eq!(result.images.len(), 16);
        assert_eq!(result.cells.len(), 24);
        input.unicode = false;
        let result = emote_recents(&input);
        assert_eq!(result.cells.len(), 16);
    }
}
