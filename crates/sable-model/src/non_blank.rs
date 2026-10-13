use serde::{Deserialize, Deserializer};
use serde_json::Value;
use serde_with::DeserializeAs;

/// A string field read as its trimmed text, or `None` when it is missing,
/// blank or not a string.
pub struct NonBlank;

impl<'de> DeserializeAs<'de, Option<String>> for NonBlank {
    fn deserialize_as<D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
        Ok(Value::deserialize(deserializer)?
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned))
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_with::serde_as;

    use super::NonBlank;

    #[serde_as]
    #[derive(Deserialize)]
    struct Field {
        #[serde_as(as = "NonBlank")]
        #[serde(default)]
        text: Option<String>,
    }

    fn read(json: &str) -> Option<String> {
        serde_json::from_str::<Field>(json).unwrap().text
    }

    #[test]
    fn only_a_non_blank_string_reads() {
        assert_eq!(read(r#"{"text": "  hi "}"#).as_deref(), Some("hi"));
        assert_eq!(read(r#"{"text": "   "}"#), None);
        assert_eq!(read(r#"{"text": 5}"#), None);
        assert_eq!(read(r#"{"text": null}"#), None);
        assert_eq!(read("{}"), None);
    }
}
