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
    name.as_ref()
        .chars()
        .any(|c| {
            !is_space(c)
                && !matches!(
                    c,
                    '\u{0300}'..='\u{036f}'
                        | '\u{061c}'
                        | '\u{2000}'..='\u{200f}'
                        | '\u{202a}'..='\u{202f}'
                        | '\u{2062}'..='\u{2063}'
                        | '\u{2800}'
                )
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
        ] {
            assert_eq!(visible_name(name), None, "{name:?}");
        }
        for c in '\u{2000}'..='\u{200f}' {
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
            "\u{200b}Alice\u{2800}",
            "@alice:example.org",
        ] {
            assert_eq!(visible_name(name), Some(name));
            assert_eq!(visible_name(name.to_owned()).as_deref(), Some(name));
        }
    }
}
