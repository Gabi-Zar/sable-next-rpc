use serde::{Deserialize, Deserializer};

/// Reads a field that is present, `null` included, so only a missing field stays `None`.
///
/// # Errors
///
/// When the field's value does not deserialize as `T`.
pub fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
