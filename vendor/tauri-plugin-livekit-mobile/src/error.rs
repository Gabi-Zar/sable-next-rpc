use serde::{ser::SerializeStruct, ser::Serializer, Serialize};

use crate::models::{NativeCallError, NativeCallFailureCode};

pub type Result<T> = std::result::Result<T, Error>;

/// Command errors: the bounded failure vocabulary plus the bridge-level
/// `timeout` (a native invocation exceeded its time bound).
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the native call bridge did not respond in time")]
    Timeout,
    #[error("{0}")]
    Native(NativeCallError),
}

impl From<NativeCallError> for Error {
    fn from(error: NativeCallError) -> Self {
        Self::Native(error)
    }
}

impl Error {
    pub(crate) fn failure(code: NativeCallFailureCode) -> Self {
        Self::Native(NativeCallError::from_code(code))
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Timeout => "timeout",
            Self::Native(error) => error.code.code(),
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::Timeout => "the native call bridge did not respond in time",
            Self::Native(error) => error.code.message(),
        }
    }
}

#[cfg(mobile)]
impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(_: tauri::plugin::mobile::PluginInvokeError) -> Self {
        // Setup-time failure: the native bridge was never registered, so the
        // native call APIs are unavailable.
        Self::failure(NativeCallFailureCode::Unavailable)
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut error = serializer.serialize_struct("Error", 2)?;
        error.serialize_field("code", self.code())?;
        error.serialize_field("message", self.message())?;
        error.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_to_the_bounded_vocabulary_with_static_messages() {
        assert_eq!(
            serde_json::to_value(Error::Timeout).unwrap(),
            serde_json::json!({
                "code": "timeout",
                "message": "the native call bridge did not respond in time"
            })
        );

        for (code, wire) in [
            (NativeCallFailureCode::InvalidRequest, "invalid_request"),
            (NativeCallFailureCode::Busy, "busy"),
            (NativeCallFailureCode::PermissionDenied, "permission_denied"),
            (NativeCallFailureCode::ConnectFailed, "connect_failed"),
            (NativeCallFailureCode::MediaFailed, "media_failed"),
            (NativeCallFailureCode::Disconnected, "disconnected"),
            (NativeCallFailureCode::Cancelled, "cancelled"),
            (NativeCallFailureCode::Unavailable, "unavailable"),
            (NativeCallFailureCode::Unexpected, "unexpected"),
        ] {
            let error = serde_json::to_value(Error::failure(code)).unwrap();
            assert_eq!(error["code"], wire);
            assert_eq!(error["message"], code.message());
        }
    }
}
