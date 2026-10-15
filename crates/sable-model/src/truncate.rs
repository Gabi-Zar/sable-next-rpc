use unicode_segmentation::UnicodeSegmentation;

#[must_use]
pub fn truncate_graphemes(text: &str, max_bytes: usize) -> &str {
    let mut end = 0;
    for grapheme in text.graphemes(true) {
        if end + grapheme.len() > max_bytes {
            break;
        }
        end += grapheme.len();
    }
    text.get(..end).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::truncate_graphemes;

    #[test]
    fn a_short_text_is_kept_whole() {
        assert_eq!(truncate_graphemes("hello", 5), "hello");
    }

    #[test]
    fn a_cut_never_lands_inside_a_character() {
        assert_eq!(truncate_graphemes("aé", 2), "a");
    }

    #[test]
    fn a_cut_never_splits_a_grapheme_cluster() {
        let family = "👨‍👩‍👧";
        assert_eq!(truncate_graphemes(&format!("a{family}"), family.len()), "a");
        assert_eq!(truncate_graphemes(family, family.len()), family);
    }
}
