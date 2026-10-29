use crate::Core;
use crate::protocol::{RpcError, UrlPreviewVideoView, UrlPreviewView};
use matrix_sdk::media::{MediaFormat, MediaRequestParameters};
use matrix_sdk::ruma::events::room::MediaSource;
use matrix_sdk::ruma::{OwnedMxcUri, OwnedRoomId};
use serde_with::{DefaultOnError, serde_as};
use std::collections::HashMap;

pub(crate) fn preview_refused(error: &matrix_sdk::HttpError) -> bool {
    error
        .as_client_api_error()
        .is_some_and(|api_error| matches!(api_error.status_code.as_u16(), 400 | 403))
}

pub(crate) async fn soliditas_preview(
    base: &str,
    target: &str,
) -> Result<Option<serde_json::Value>, RpcError> {
    let mut endpoint = url::Url::parse(&format!(
        "{}/_soliditas/preview_url",
        base.trim_end_matches('/')
    ))
    .map_err(|_| RpcError::Unavailable)?;
    endpoint.query_pairs_mut().append_pair("url", target);

    let builder = crate::tls::apply(matrix_sdk::reqwest::Client::builder());
    #[cfg(not(target_family = "wasm"))]
    let builder = builder.timeout(std::time::Duration::from_secs(10));
    let http = builder.build().map_err(|_| RpcError::Unavailable)?;
    let response = http.get(endpoint).send().await.map_err(|error| {
        tracing::warn!("soliditas preview failed: {}", error.without_url());
        RpcError::Unavailable
    })?;

    let status = response.status();
    if status.is_client_error() {
        return Ok(None);
    }
    if !status.is_success() {
        tracing::warn!("soliditas preview answered {status}");
        return Err(RpcError::Unavailable);
    }
    let body = response.bytes().await.map_err(|_| RpcError::Unavailable)?;
    Ok(serde_json::from_slice(&body).ok())
}

/// Every field reads as missing when absent or wrong-typed.
#[serde_as]
#[derive(Default, serde::Deserialize)]
#[serde(default)]
pub(crate) struct PreviewData {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "matrix:matched_url")]
    pub(crate) stable_matched_url: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "matched_url")]
    pub(crate) legacy_matched_url: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:url")]
    pub(crate) url: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:title")]
    pub(crate) title: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:description")]
    pub(crate) description: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:site_name")]
    pub(crate) site_name: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "matrix:image:encrypted")]
    pub(crate) encrypted_image: Option<matrix_sdk::ruma::events::room::EncryptedFile>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:image")]
    pub(crate) image: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:image:type")]
    pub(crate) image_type: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:image:width")]
    pub(crate) image_width: Option<u64>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:image:height")]
    pub(crate) image_height: Option<u64>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:video")]
    video: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:video:type")]
    video_type: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:video:width")]
    video_width: Option<u64>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "og:video:height")]
    video_height: Option<u64>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "com.sable.theme_color")]
    theme_color: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "com.sable.card")]
    card: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(rename = "com.sable.author_name")]
    pub(crate) author_name: Option<String>,
}

impl PreviewData {
    pub(crate) fn read(data: &serde_json::Value) -> Option<Self> {
        serde::Deserialize::deserialize(data).ok()
    }

    pub(crate) fn video(&self) -> Option<UrlPreviewVideoView> {
        let source = self
            .video
            .as_deref()
            .filter(|source| source.starts_with("mxc://"))?
            .to_owned();
        Some(UrlPreviewVideoView {
            source,
            mime: self.video_type.clone(),
            width: self.video_width,
            height: self.video_height,
        })
    }

    pub(crate) fn valid_theme_color(&self) -> Option<String> {
        let color = self.theme_color.as_deref()?;
        let digits = color.strip_prefix('#')?;
        (matches!(digits.len(), 3 | 4 | 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| color.to_owned())
    }

    pub(crate) fn valid_card(&self) -> Option<String> {
        let card = self.card.as_deref()?;
        matches!(card, "summary" | "summary_large_image").then(|| card.to_owned())
    }
}

pub(crate) fn url_preview(url: String, data: &serde_json::Value) -> Option<UrlPreviewView> {
    let data = PreviewData::read(data)?;
    let text = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };

    let preview = UrlPreviewView {
        url,
        title: text(&data.title),
        description: text(&data.description),
        site_name: text(&data.site_name),
        image: text(&data.image).filter(|image| image.starts_with("mxc://")),
        image_mime: text(&data.image_type),
        image_width: data.image_width,
        image_height: data.image_height,
        video: data.video(),
        theme_color: data.valid_theme_color(),
        card: data.valid_card(),
        author_name: text(&data.author_name),
    };

    if preview.title.is_none()
        && preview.description.is_none()
        && preview.image.is_none()
        && preview.video.is_none()
    {
        return None;
    }
    Some(preview)
}

const MAX_PREVIEW_IMAGE_BYTES: usize = 8 * 1024 * 1024;

pub(crate) struct EncryptedPreviewImage {
    file: serde_json::Value,
    size: u64,
}

pub(crate) const BUNDLED_LINK_PREVIEWS: &str = "m.url_previews";

pub(crate) const LEGACY_BUNDLED_LINK_PREVIEWS: &str = "com.beeper.linkpreviews";

#[derive(serde::Serialize)]
struct LinkPreviewBundleOut {
    #[serde(rename = "matrix:matched_url", skip_serializing_if = "Option::is_none")]
    stable_matched_url: Option<String>,
    #[serde(rename = "matched_url", skip_serializing_if = "Option::is_none")]
    legacy_matched_url: Option<String>,
    #[serde(rename = "og:url")]
    url: String,
    #[serde(rename = "og:title", skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(rename = "og:description", skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(rename = "og:site_name", skip_serializing_if = "Option::is_none")]
    site_name: Option<String>,
    #[serde(
        rename = "matrix:image:encrypted",
        skip_serializing_if = "Option::is_none"
    )]
    encrypted_image: Option<serde_json::Value>,
    #[serde(rename = "matrix:image:size", skip_serializing_if = "Option::is_none")]
    encrypted_image_size: Option<u64>,
    #[serde(rename = "og:image", skip_serializing_if = "Option::is_none")]
    image: Option<String>,
    #[serde(rename = "og:image:width", skip_serializing_if = "Option::is_none")]
    image_width: Option<u64>,
    #[serde(rename = "og:image:height", skip_serializing_if = "Option::is_none")]
    image_height: Option<u64>,
    #[serde(rename = "og:video", skip_serializing_if = "Option::is_none")]
    video: Option<String>,
    #[serde(rename = "og:video:type", skip_serializing_if = "Option::is_none")]
    video_type: Option<String>,
    #[serde(rename = "og:video:width", skip_serializing_if = "Option::is_none")]
    video_width: Option<u64>,
    #[serde(rename = "og:video:height", skip_serializing_if = "Option::is_none")]
    video_height: Option<u64>,
    #[serde(
        rename = "com.sable.theme_color",
        skip_serializing_if = "Option::is_none"
    )]
    theme_color: Option<String>,
    #[serde(rename = "com.sable.card", skip_serializing_if = "Option::is_none")]
    card: Option<String>,
    #[serde(
        rename = "com.sable.author_name",
        skip_serializing_if = "Option::is_none"
    )]
    author_name: Option<String>,
}

impl LinkPreviewBundleOut {
    fn new(
        preview: &UrlPreviewView,
        encrypted: Option<&EncryptedPreviewImage>,
        stable: bool,
    ) -> Self {
        let video = preview.video.as_ref();
        let encrypted_stable = encrypted.filter(|_| stable);
        Self {
            stable_matched_url: stable.then(|| preview.url.clone()),
            legacy_matched_url: (!stable).then(|| preview.url.clone()),
            url: preview.url.clone(),
            title: preview.title.clone(),
            description: preview.description.clone(),
            site_name: preview.site_name.clone(),
            encrypted_image: encrypted_stable.map(|image| image.file.clone()),
            encrypted_image_size: encrypted_stable.map(|image| image.size),
            image: if encrypted.is_some() {
                None
            } else {
                preview.image.clone()
            },
            image_width: preview.image_width,
            image_height: preview.image_height,
            video: video.map(|video| video.source.clone()),
            video_type: video.and_then(|video| video.mime.clone()),
            video_width: video.and_then(|video| video.width),
            video_height: video.and_then(|video| video.height),
            theme_color: preview.theme_color.clone(),
            card: preview.card.clone(),
            author_name: preview.author_name.clone(),
        }
    }
}

pub(crate) fn bundled_link_previews(
    previews: &[UrlPreviewView],
    encrypted_images: &HashMap<String, EncryptedPreviewImage>,
    stable: bool,
) -> Option<serde_json::Value> {
    if previews.is_empty() {
        return None;
    }
    let bundles: Vec<_> = previews
        .iter()
        .map(|preview| {
            LinkPreviewBundleOut::new(preview, encrypted_images.get(&preview.url), stable)
        })
        .collect();
    serde_json::to_value(bundles).ok()
}

impl Core {
    pub(crate) async fn encrypted_preview_images(
        &self,
        room_id: &OwnedRoomId,
        previews: &[UrlPreviewView],
    ) -> HashMap<String, EncryptedPreviewImage> {
        let mut images = HashMap::new();
        let Ok(room) = self.room(room_id).await else {
            return images;
        };
        if !room.encryption_state().is_encrypted() {
            return images;
        }
        let client = room.client();
        for preview in previews {
            let Some(image) = preview
                .image
                .as_deref()
                .filter(|image| image.starts_with("mxc://"))
            else {
                continue;
            };
            let request = MediaRequestParameters {
                source: MediaSource::Plain(OwnedMxcUri::from(image)),
                format: MediaFormat::File,
            };
            let Ok(data) = client.media().get_media_content(&request, false).await else {
                continue;
            };
            if data.len() > MAX_PREVIEW_IMAGE_BYTES {
                continue;
            }
            let size = data.len() as u64;
            let mut reader = std::io::Cursor::new(data);
            let Ok(file) = client.upload_encrypted_file(&mut reader).await else {
                continue;
            };
            if let Ok(file) = serde_json::to_value(&file) {
                images.insert(preview.url.clone(), EncryptedPreviewImage { file, size });
            }
        }
        images
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn link_preview_bundles_omit_absent_fields_and_key_the_url_by_format() {
        let previews = [preview("https://example.org/")];
        assert_eq!(
            super::bundled_link_previews(&previews, &std::collections::HashMap::new(), true),
            Some(serde_json::json!([{
                "matrix:matched_url": "https://example.org/",
                "og:url": "https://example.org/",
                "og:title": "Title",
                "og:image": "mxc://example.org/image",
                "og:image:width": 640,
                "og:video": "https://example.org/v.mp4",
                "og:video:type": "video/mp4",
                "og:video:height": 360,
                "com.sable.theme_color": "#fff",
            }]))
        );
        assert_eq!(
            super::bundled_link_previews(&previews, &std::collections::HashMap::new(), false)
                .expect("a bundle")[0]["matched_url"],
            "https://example.org/"
        );
        assert!(
            super::bundled_link_previews(&[], &std::collections::HashMap::new(), true).is_none()
        );
    }

    #[test]
    fn encrypted_preview_images_replace_the_plain_one_only_in_the_stable_bundle() {
        let previews = [preview("https://example.org/")];
        let encrypted = std::collections::HashMap::from([(
            "https://example.org/".to_owned(),
            super::EncryptedPreviewImage {
                file: serde_json::json!({ "url": "mxc://example.org/enc" }),
                size: 12,
            },
        )]);
        let stable = super::bundled_link_previews(&previews, &encrypted, true).expect("a bundle");
        assert_eq!(
            stable[0]["matrix:image:encrypted"],
            serde_json::json!({ "url": "mxc://example.org/enc" })
        );
        assert_eq!(stable[0]["matrix:image:size"], 12);
        assert!(stable[0].get("og:image").is_none());

        let legacy = super::bundled_link_previews(&previews, &encrypted, false).expect("a bundle");
        assert!(legacy[0].get("matrix:image:encrypted").is_none());
        assert!(legacy[0].get("og:image").is_none());
    }

    #[test]
    fn a_preview_with_nothing_to_show_is_no_preview() {
        let empty = serde_json::json!({ "og:title": "   ", "og:image": "https://cdn/x.png" });
        assert!(super::url_preview("https://e".to_owned(), &empty).is_none());
        assert!(super::url_preview("https://e".to_owned(), &serde_json::json!({})).is_none());
    }

    #[test]
    fn a_video_alone_is_a_preview() {
        let data = serde_json::json!({
            "og:video": "mxc://s/clip",
            "og:video:type": "video/mp4",
            "og:video:width": 1280,
            "og:video:height": 720,
        });
        let preview = super::url_preview("https://e".to_owned(), &data).expect("a preview");
        let video = preview.video.expect("a video");
        assert_eq!(video.source, "mxc://s/clip");
        assert_eq!(video.mime.as_deref(), Some("video/mp4"));
        assert_eq!((video.width, video.height), (Some(1280), Some(720)));

        let remote = serde_json::json!({ "og:video": "https://cdn.example/clip.mp4" });
        assert!(super::url_preview("https://e".to_owned(), &remote).is_none());
    }

    #[test]
    fn presentation_hints_are_validated() {
        let data = serde_json::json!({
            "og:title": "Title",
            "com.sable.theme_color": "#ff4500",
            "com.sable.card": "summary_large_image",
            "com.sable.author_name": "someone",
        });
        let preview = super::url_preview("https://e".to_owned(), &data).expect("a preview");
        assert_eq!(preview.theme_color.as_deref(), Some("#ff4500"));
        assert_eq!(preview.card.as_deref(), Some("summary_large_image"));
        assert_eq!(preview.author_name.as_deref(), Some("someone"));

        let data = serde_json::json!({
            "og:title": "Title",
            "com.sable.theme_color": "red; background:url(x)",
            "com.sable.card": "player",
        });
        let preview = super::url_preview("https://e".to_owned(), &data).expect("a preview");
        assert_eq!(preview.theme_color, None);
        assert_eq!(preview.card, None);
    }

    #[test]
    fn a_preview_keeps_only_an_mxc_image() {
        let data = serde_json::json!({
            "og:title": "Title",
            "og:image": "https://cdn.example/x.png",
        });
        let preview = super::url_preview("https://e".to_owned(), &data).expect("a preview");
        assert_eq!(preview.image, None);

        let data = serde_json::json!({
            "og:title": "Title",
            "og:image": "mxc://example.org/1",
            "og:image:width": 640,
        });
        let preview = super::url_preview("https://e".to_owned(), &data).expect("a preview");
        assert_eq!(preview.image.as_deref(), Some("mxc://example.org/1"));
        assert_eq!(preview.image_width, Some(640));
    }

    #[test]
    fn an_encrypted_preview_image_replaces_og_image_in_the_stable_field_only() {
        let preview = crate::protocol::UrlPreviewView {
            url: "https://example.org".to_owned(),
            title: Some("Example".to_owned()),
            description: None,
            site_name: None,
            image: Some("mxc://example.org/plain".to_owned()),
            image_mime: None,
            image_width: None,
            image_height: None,
            video: None,
            theme_color: None,
            card: None,
            author_name: None,
        };
        let images = std::collections::HashMap::from([(
            preview.url.clone(),
            super::EncryptedPreviewImage {
                file: serde_json::json!({ "url": "mxc://example.org/enc" }),
                size: 42,
            },
        )]);

        let previews = [preview];
        let stable = super::bundled_link_previews(&previews, &images, true).unwrap();
        assert_eq!(stable[0]["matrix:image:size"], 42);
        assert_eq!(
            stable[0]["matrix:image:encrypted"]["url"],
            "mxc://example.org/enc"
        );
        assert!(stable[0].get("og:image").is_none());

        let legacy = super::bundled_link_previews(&previews, &images, false).unwrap();
        assert!(legacy[0].get("og:image").is_none());
        assert!(legacy[0].get("matrix:image:encrypted").is_none());
    }

    #[tokio::test]
    async fn soliditas_preview_asks_the_worker_with_the_url() {
        use wiremock::{
            Mock, MockServer, ResponseTemplate,
            matchers::{header, method, path, query_param},
        };
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_soliditas/preview_url"))
            .and(header("user-agent", crate::USER_AGENT))
            .and(query_param("url", "https://example.org/a?b=1&c=2"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"og:title": "Hi"})),
            )
            .expect(1)
            .mount(&server)
            .await;

        let data = super::soliditas_preview(
            &format!("{}/", server.uri()),
            "https://example.org/a?b=1&c=2",
        )
        .await
        .expect("answered");
        assert_eq!(
            data.as_ref().and_then(|d| d["og:title"].as_str()),
            Some("Hi")
        );
    }

    #[tokio::test]
    async fn soliditas_preview_treats_a_refused_url_as_no_preview() {
        use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let data = super::soliditas_preview(&server.uri(), "https://example.org/a")
            .await
            .expect("answered");
        assert!(data.is_none());
    }

    #[tokio::test]
    async fn soliditas_preview_reports_a_server_failure() {
        use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(502))
            .mount(&server)
            .await;

        let error = super::soliditas_preview(&server.uri(), "https://example.org/a")
            .await
            .unwrap_err();
        assert!(matches!(error, super::RpcError::Unavailable));
    }

    fn preview(url: &str) -> crate::protocol::UrlPreviewView {
        crate::protocol::UrlPreviewView {
            url: url.to_owned(),
            title: Some("Title".to_owned()),
            description: None,
            site_name: None,
            image: Some("mxc://example.org/image".to_owned()),
            image_mime: None,
            image_width: Some(640),
            image_height: None,
            video: Some(crate::protocol::UrlPreviewVideoView {
                source: "https://example.org/v.mp4".to_owned(),
                mime: Some("video/mp4".to_owned()),
                width: None,
                height: Some(360),
            }),
            theme_color: Some("#fff".to_owned()),
            card: None,
            author_name: None,
        }
    }
}

#[cfg(test)]
mod preview_data_tests {
    use super::url_preview;

    #[test]
    fn a_preview_skips_wrong_typed_fields_and_non_objects() {
        let data = serde_json::json!({
            "og:title": " Title ",
            "og:description": 5,
            "og:image": ["mxc://x/y"],
            "og:video": "mxc://x/v",
            "og:video:width": -1,
            "com.sable.card": "summary",
            "com.sable.theme_color": "#12",
        });
        let preview = url_preview("https://e".to_owned(), &data).expect("a preview");
        assert_eq!(preview.title.as_deref(), Some("Title"));
        assert_eq!(preview.description, None);
        assert_eq!(preview.image, None);
        assert_eq!(preview.video.as_ref().unwrap().width, None);
        assert_eq!(preview.card.as_deref(), Some("summary"));
        assert_eq!(preview.theme_color, None);
        assert!(url_preview("https://e".to_owned(), &serde_json::json!(["x"])).is_none());
    }
}
