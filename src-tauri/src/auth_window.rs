use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::BrowserEngine;

fn matches_callback(candidate: &tauri::Url, expected: &tauri::Url) -> bool {
    candidate.scheme() == expected.scheme()
        && candidate.host_str() == expected.host_str()
        && candidate.port() == expected.port()
        && candidate.path() == expected.path()
        && expected
            .query_pairs()
            .all(|pair| candidate.query_pairs().any(|value| value == pair))
}

fn window_label(id: &str) -> Result<String, String> {
    if id.is_empty()
        || id.len() > 100
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("invalid authentication window id".into());
    }
    Ok(format!("auth-{id}"))
}

#[tauri::command]
pub async fn open_auth_window(
    window: WebviewWindow<BrowserEngine>,
    id: String,
    url: String,
    callback_uri: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("invalid authentication origin".into());
    }
    let url = tauri::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err("authentication requires an HTTP or HTTPS URL".into());
    }
    let callback = callback_uri
        .map(|value| tauri::Url::parse(&value))
        .transpose()
        .map_err(|error| error.to_string())?;
    let label = window_label(&id)?;
    let app = window.app_handle().clone();
    if let Some(previous) = app.get_webview_window(&label) {
        previous.destroy().map_err(|error| error.to_string())?;
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("Sable")
        .inner_size(520.0, 720.0)
        .parent(&window)
        .map_err(|error| error.to_string())?
        .on_navigation(move |target| {
            if callback
                .as_ref()
                .is_some_and(|expected| matches_callback(target, expected))
            {
                let _ = window.emit_to("main", "deep-link://new-url", vec![target.to_string()]);
                return false;
            }
            matches!(target.scheme(), "http" | "https")
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn close_auth_window(
    window: WebviewWindow<BrowserEngine>,
    id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("invalid authentication origin".into());
    }
    if let Some(popup) = window.app_handle().get_webview_window(&window_label(&id)?) {
        popup.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::matches_callback;

    #[test]
    fn callbacks_must_match_the_redirect_target_and_nonce() -> Result<(), Box<dyn std::error::Error>>
    {
        let expected = "moe.sable.next://login?sable_sso_state=nonce".parse()?;
        for (value, matches) in [
            (
                "moe.sable.next://login?sable_sso_state=nonce&loginToken=token",
                true,
            ),
            (
                "moe.sable.next://login?sable_sso_state=other&loginToken=token",
                false,
            ),
            ("moe.sable.next://room?sable_sso_state=nonce", false),
            ("https://login?sable_sso_state=nonce", false),
        ] {
            assert_eq!(matches_callback(&value.parse()?, &expected), matches);
        }
        Ok(())
    }
}
