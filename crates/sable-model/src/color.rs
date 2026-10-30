#[must_use]
pub fn is_hex_color(value: &str, lengths: &[usize]) -> bool {
    value.strip_prefix('#').is_some_and(|digits| {
        lengths.contains(&digits.len()) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

#[cfg(test)]
mod tests {
    use super::is_hex_color;

    #[test]
    fn protocols_keep_their_hash_and_alpha_rules() {
        assert!(is_hex_color("#ABC", &[3, 6]));
        assert!(is_hex_color("#aabbcc", &[6]));
        for value in ["abc", "##abc", "#abcd", "#aabbccdd", "#１２３", "#xyz"] {
            assert!(!is_hex_color(value, &[3, 6]), "{value}");
        }
        assert!(!is_hex_color("#abc", &[6]));
        assert!(is_hex_color("#abcd", &[3, 4, 6, 8]));
        assert!(is_hex_color("#aabbccdd", &[3, 4, 6, 8]));
    }
}
