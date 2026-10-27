use icu_properties::{
    CodePointMapData, CodePointSetData,
    props::{DefaultIgnorableCodePoint, GeneralCategory},
};

/// JavaScript's `\s`, which is not quite Unicode `White_Space`: the inputs this
/// crate parses were typed into the web page and split there before.
pub(crate) const fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub(crate) fn has_space(text: &str) -> bool {
    text.chars().any(is_space)
}

#[must_use]
pub fn visible_name<T: AsRef<str>>(name: T) -> Option<T> {
    let ignorable = CodePointSetData::new::<DefaultIgnorableCodePoint>();
    let categories = CodePointMapData::<GeneralCategory>::new();
    name.as_ref()
        .chars()
        .any(|c| {
            !c.is_whitespace()
                && !matches!(
                    categories.get(c),
                    GeneralCategory::Control | GeneralCategory::Format
                )
                && !ignorable.contains(c)
                // Also ignore combining diacritics and blank braille.
                && !matches!(c, '\u{0300}'..='\u{036f}' | '\u{2800}')
        })
        .then_some(name)
}

/// `text.split(/\s+/)` after a trim, with nothing for an empty string.
pub(crate) fn words(text: &str) -> Vec<&str> {
    text.split(is_space)
        .filter(|word| !word.is_empty())
        .collect()
}

pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

pub(crate) fn trim_start(text: &str) -> &str {
    text.trim_start_matches(is_space)
}

/// `text[from..]`, or nothing when `from` is not a boundary in it.
pub(crate) fn tail(text: &str, from: usize) -> &str {
    text.get(from..).unwrap_or_default()
}

/// `text[..to]`, or nothing when `to` is not a boundary in it.
pub(crate) fn head(text: &str, to: usize) -> &str {
    text.get(..to).unwrap_or_default()
}

/// `text[from..to]`, or nothing when either is not a boundary in it.
pub(crate) fn span(text: &str, from: usize, to: usize) -> &str {
    text.get(from..to).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::visible_name;

    #[test]
    fn hidden_names_have_no_display_name() {
        for name in [
            "",
            " \t\r\n\u{00a0}\u{1680}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}",
            "\u{200b}\u{200c}\u{200d}\u{feff}",
            "\u{200e}\u{200f}\u{061c}\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}",
            "\u{0300}\u{034f}\u{036f}",
            "\u{2800}\u{2062}\u{2063}",
            " \u{200b}\u{2800}\u{034f}\u{feff} ",
            "\u{0085}",
            "\u{00ad}",
            "\u{115f}\u{1160}\u{3164}\u{ffa0}",
            "\u{17b4}\u{17b5}",
            "\u{180b}\u{180c}\u{180d}\u{180e}\u{180f}",
            "\u{2060}\u{2061}\u{2064}\u{2066}\u{2067}\u{2068}\u{2069}",
            "\u{fe00}\u{fe0e}\u{fe0f}\u{e0100}\u{e01ef}",
            "\u{1bca0}\u{1bca3}\u{1d173}\u{1d17a}",
            "\u{e0001}\u{e0020}\u{e0061}\u{e007f}",
            " \u{3164}\u{2060}\u{fe0f}\u{0085} ",
            " \u{0600}\u{fffa}\u{0085} ",
        ] {
            assert_eq!(visible_name(name), None, "{name:?}");
        }
        for c in '\u{2000}'..='\u{200f}' {
            assert_eq!(visible_name(c.to_string()), None, "{c:?}");
        }
        for c in ('\u{0000}'..='\u{001f}').chain('\u{007f}'..='\u{009f}') {
            assert_eq!(visible_name(c.to_string()), None, "{c:?}");
        }
    }

    #[test]
    fn format_only_names_have_no_display_name() {
        for c in concat!(
            "\u{0600}\u{0601}\u{0602}\u{0603}\u{0604}\u{0605}\u{06dd}\u{070f}",
            "\u{0890}\u{0891}\u{08e2}\u{fff9}\u{fffa}\u{fffb}\u{110bd}\u{110cd}",
        )
        .chars()
        .chain('\u{13430}'..='\u{1343f}')
        {
            assert_eq!(visible_name(c.to_string()), None, "{c:?}");
        }
    }

    #[test]
    fn visible_names_are_preserved() {
        for name in [
            "Alice",
            " Élodie ",
            "e\u{0301}",
            "علي",
            "小明",
            "👩\u{200d}💻",
            "❤️",
            "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}",
            "می\u{200c}نا",
            "한글",
            "\u{1161}",
            "\u{2067}علي\u{2069}",
            "\u{3164}Alice\u{fe0f}",
            "\u{200b}Alice\u{2800}",
            "\u{0600}Alice\u{fff9}",
            "\u{13430}علي\u{1343f}",
            "@alice:example.org",
        ] {
            assert_eq!(visible_name(name), Some(name));
            assert_eq!(visible_name(name.to_owned()).as_deref(), Some(name));
        }
    }
}
