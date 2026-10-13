//! `deserialize_with` helpers for foreign JSON where a wrong-typed field
//! should read as missing instead of failing the whole value.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// A field that is wrong-typed reads as missing.
///
/// # Errors
///
/// Only when the input cannot be read at all.
pub fn option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(serde_json::from_value(Value::deserialize(deserializer)?).ok())
}

/// A list that skips the entries that are not `T`; anything but a list is empty.
///
/// # Errors
///
/// Only when the input cannot be read at all.
pub fn list<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(entries) => entries
            .into_iter()
            .filter_map(|entry| serde_json::from_value(entry).ok())
            .collect(),
        _ => Vec::new(),
    })
}
