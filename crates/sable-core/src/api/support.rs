use std::collections::{BTreeMap, HashMap};

use matrix_sdk::RoomMemberships;
use matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState;
use matrix_sdk::media::{MediaFormat, MediaRequestParameters};
use matrix_sdk::ruma::api::client::state::get_state_event_for_key;
use matrix_sdk::ruma::api::error::ErrorKind;
use matrix_sdk::ruma::events::InitialStateEvent;
use matrix_sdk::ruma::events::room::join_rules::RoomJoinRulesEventContent;
use matrix_sdk::ruma::events::room::{ImageInfo, MediaSource};
use matrix_sdk::ruma::room::{AllowRule, JoinRule, Restricted};
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::{OwnedEventId, OwnedMxcUri, OwnedRoomId, RoomId};

use crate::ResultExt;
use crate::probed_state::Probed;
use crate::protocol::{
    CoreEvent, CreateJoinRuleView, ImageSourcePackReferenceView, ImageSourcePackView,
    MembershipView, PackImageInfoView, RoomStateEventView, RpcError, UrlPreviewVideoView,
    UrlPreviewView,
};

use crate::Core;
use crate::view;
use serde_with::{DefaultOnError, serde_as};

pub(crate) const MAX_SEARCH_RESULTS: usize = 200;

pub(crate) fn preview_refused(error: &matrix_sdk::HttpError) -> bool {
    error
        .as_client_api_error()
        .is_some_and(|api_error| api_error.status_code.as_u16() == 403)
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

#[derive(serde::Serialize)]
pub(crate) struct StateEventOut<C> {
    #[serde(rename = "type")]
    pub(crate) kind: &'static str,
    pub(crate) state_key: &'static str,
    pub(crate) content: C,
}

pub(crate) fn join_rule_content(
    rule: Option<CreateJoinRuleView>,
    parent_space: Option<&RoomId>,
) -> Option<InitialStateEvent<RoomJoinRulesEventContent>> {
    let restricted = || {
        parent_space
            .map(|space| Restricted::new(vec![AllowRule::room_membership(space.to_owned())]))
    };
    let join_rule = match rule? {
        CreateJoinRuleView::Public => JoinRule::Public,
        CreateJoinRuleView::Invite => JoinRule::Invite,
        CreateJoinRuleView::Knock => JoinRule::Knock,
        CreateJoinRuleView::Restricted => {
            restricted().map_or(JoinRule::Invite, JoinRule::Restricted)
        }
        CreateJoinRuleView::KnockRestricted => {
            restricted().map_or(JoinRule::Invite, JoinRule::KnockRestricted)
        }
    };
    Some(InitialStateEvent::with_empty_state_key(
        RoomJoinRulesEventContent::new(join_rule),
    ))
}

pub(crate) fn state_event_content(raw: &str) -> Option<serde_json::Value> {
    let value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    let is_event = value
        .as_object()
        .is_some_and(|object| object.contains_key("type") || object.contains_key("event_id"));

    if is_event {
        value.get("content").cloned()
    } else {
        Some(value)
    }
}

#[derive(serde::Serialize)]
pub(crate) struct PowerLevelsOverrideOut {
    events: BTreeMap<&'static str, i64>,
}

pub(crate) fn voice_power_level_override() -> PowerLevelsOverrideOut {
    PowerLevelsOverrideOut {
        events: BTreeMap::from([
            ("m.room.avatar", 50),
            ("m.room.canonical_alias", 50),
            ("m.room.encryption", 100),
            ("m.room.history_visibility", 100),
            ("m.room.name", 50),
            ("m.room.power_levels", 100),
            ("m.room.server_acl", 100),
            ("m.room.tombstone", 100),
            (view::CALL_MEMBER_TYPE, 0),
        ]),
    }
}

const MAX_PREVIEW_IMAGE_BYTES: usize = 8 * 1024 * 1024;

pub(crate) struct EncryptedPreviewImage {
    file: serde_json::Value,
    size: u64,
}

pub(crate) const BUNDLED_LINK_PREVIEWS: &str = "m.url_previews";
pub(crate) const LEGACY_BUNDLED_LINK_PREVIEWS: &str = "com.beeper.linkpreviews";
pub(crate) const IMAGE_SOURCE_PACKS: &str = "com.beeper.msc4459.image_source_packs";

pub(crate) fn extra_content<const N: usize>(
    base: Option<serde_json::Map<String, serde_json::Value>>,
    fields: [(&str, Option<serde_json::Value>); N],
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let mut extra = base;
    for (key, value) in fields {
        if let Some(value) = value {
            extra.get_or_insert_default().insert(key.to_owned(), value);
        }
    }
    extra
}

pub(crate) fn forum_title_value(title: Option<String>) -> Option<serde_json::Value> {
    title
        .map(|title| title.trim().to_owned())
        .filter(|title| !title.is_empty())
        .map(serde_json::Value::String)
}

pub(crate) fn empty_mentions_extra() -> Option<serde_json::Map<String, serde_json::Value>> {
    extra_content(None, [("m.mentions", Some(empty_mentions()))])
}

pub(crate) fn empty_mentions() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

pub(crate) fn ensure_empty_mentions(content: &mut serde_json::Value) {
    if let Some(object) = content.as_object_mut() {
        object.entry("m.mentions").or_insert_with(empty_mentions);
    }
}

pub(crate) const REACTION_SHORTCODE: &str = "shortcode";
const MAX_REACTION_SHORTCODE_BYTES: usize = 100;

pub(crate) fn reaction_shortcode(key: &str, shortcode: Option<&str>) -> Option<serde_json::Value> {
    if !key.starts_with("mxc://") {
        return None;
    }
    let name = shortcode?.trim().trim_matches(':');
    if name.is_empty() {
        return None;
    }
    let budget = MAX_REACTION_SHORTCODE_BYTES - 2;
    let end = name
        .char_indices()
        .map(|(start, character)| start + character.len_utf8())
        .take_while(|end| *end <= budget)
        .last()?;
    name.get(..end)
        .map(|name| serde_json::Value::from(format!(":{name}:")))
}

pub(crate) fn image_source_pack_extra(
    url: &str,
    source: Option<ImageSourcePackView>,
) -> Option<serde_json::Value> {
    source.map(|source| serde_json::json!({ url: source }))
}

pub(crate) fn image_source_pack_references(
    references: &[ImageSourcePackReferenceView],
) -> Option<serde_json::Value> {
    (!references.is_empty()).then(|| {
        serde_json::Value::Object(
            references
                .iter()
                .map(|reference| (reference.url.clone(), serde_json::json!(reference.source)))
                .collect(),
        )
    })
}

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

pub(crate) fn sticker_info(declared: Option<PackImageInfoView>) -> ImageInfo {
    let mut info = ImageInfo::new();
    let Some(declared) = declared else {
        return info;
    };

    info.width = declared.width.map(Into::into);
    info.height = declared.height.map(Into::into);
    info.mimetype = declared.mimetype;
    info.size = declared.size.map(Into::into);
    info
}

pub(crate) fn membership_filter(memberships: &[MembershipView]) -> RoomMemberships {
    if memberships.is_empty() {
        return RoomMemberships::JOIN;
    }

    memberships
        .iter()
        .fold(RoomMemberships::empty(), |filter, membership| {
            filter
                | match membership {
                    MembershipView::Join => RoomMemberships::JOIN,
                    MembershipView::Invite => RoomMemberships::INVITE,
                    MembershipView::Knock => RoomMemberships::KNOCK,
                    MembershipView::Leave => RoomMemberships::LEAVE,
                    MembershipView::Ban => RoomMemberships::BAN,
                }
        })
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

    /// Every global account data write goes through here so the pack cache
    /// never serves what we just replaced.
    pub(crate) async fn set_account_data(
        &self,
        event_type: &str,
        content: &impl serde::Serialize,
    ) -> Result<(), RpcError> {
        self.remember_account_data_type(event_type).await;
        self.put_global_account_data(event_type.into(), content, "set_account_data")
            .await?;
        self.pack_cache.lock().await.forget_account_data(event_type);
        Ok(())
    }

    /// Every state write goes through here so the caches that read state back
    /// are invalidated and the cosmetic and profile listeners hear about it.
    pub(crate) async fn send_state(
        &self,
        room_id: OwnedRoomId,
        event_type: &str,
        state_key: &str,
        content: &impl serde::Serialize,
    ) -> Result<OwnedEventId, RpcError> {
        let content = &serde_json::to_value(content).or_failed(self, "send_state")?;
        let response = self
            .room(&room_id)
            .await?
            .send_state_event_raw(event_type, state_key, content)
            .await
            .map_err(|error| self.room_error("send_state_event", error))?;
        self.pack_cache
            .lock()
            .await
            .forget_room(&room_id, event_type);
        self.forget_room_state(&room_id, event_type);
        self.probed_state().remember_written(
            &room_id,
            event_type,
            state_key,
            content.clone(),
            crate::probed_state::now_ms(),
        );
        if self.note_cosmetic_state(&room_id, event_type, state_key, content) {
            self.emit(CoreEvent::RoomCosmeticsChanged {
                room_id: room_id.clone(),
            });
        }
        if event_type == "m.room.member"
            && content.get("membership").and_then(|value| value.as_str()) == Some("join")
            && let Ok(user_id) = matrix_sdk::ruma::OwnedUserId::try_from(state_key)
        {
            let text = |key| {
                content
                    .get(key)
                    .and_then(|value| value.as_str())
                    .map(ToOwned::to_owned)
            };
            let (display_name, avatar_url) = (text("displayname"), text("avatar_url"));
            self.overlay_profile(&room_id, &user_id, display_name.clone(), avatar_url.clone())
                .await;
            self.emit(CoreEvent::ProfileChanged {
                room_id,
                user_id,
                display_name,
                avatar_url,
            });
        }

        Ok(response.event_id)
    }

    pub(crate) async fn room_permissions(
        &self,
        room_id: &OwnedRoomId,
    ) -> Result<crate::protocol::RoomPermissionsView, RpcError> {
        let room = self.room(room_id).await?;
        let user_id = room
            .client()
            .user_id()
            .ok_or_else(|| self.failed("room_permissions", "no session"))?
            .to_owned();
        // An invited room carries only stripped state, so the levels are
        // often absent. Spec defaults beat failing the whole command.
        let power_levels = room.power_levels_or_default().await;

        Ok(view::room_permissions(&power_levels, &user_id))
    }

    pub(crate) async fn room_state_events(
        &self,
        room_id: &OwnedRoomId,
        event_type: &str,
    ) -> Result<Vec<RoomStateEventView>, RpcError> {
        let client = self.client().await?;
        let room = self.room(room_id).await?;
        let stored = room
            .get_state_events(event_type.into())
            .await
            .map_err(|error| self.room_error("room_state_events", error))?;

        let events: Vec<RoomStateEventView> = stored
            .iter()
            .filter_map(|raw| {
                let (state_key, content) = match raw {
                    RawAnySyncOrStrippedState::Sync(event) => (
                        event.get_field::<String>("state_key"),
                        event.get_field::<serde_json::Value>("content"),
                    ),
                    RawAnySyncOrStrippedState::Stripped(event) => (
                        event.get_field::<String>("state_key"),
                        event.get_field::<serde_json::Value>("content"),
                    ),
                };
                Some(RoomStateEventView {
                    state_key: state_key.ok().flatten()?,
                    content: content.ok().flatten()?,
                })
            })
            .collect();

        if !events.is_empty() {
            return Ok(events);
        }
        let probed = self.probed_state().events(room_id, event_type);
        if let Some(events) = probed {
            return Ok(events);
        }

        let snapshot = self
            .room_state_snapshot(&client, room.room_id())
            .await
            .map_err(|error| self.room_error("room_state_events", error))?;
        let state = room_state_by_type(&snapshot);
        let events = state.get(event_type).cloned().unwrap_or_default();
        self.probed_state().remember_full(room_id, state);

        Ok(events)
    }

    pub(crate) async fn room_state_event_content(
        &self,
        room_id: OwnedRoomId,
        event_type: String,
        state_key: String,
    ) -> Result<Option<serde_json::Value>, RpcError> {
        let written = self.probed_state().written(
            &room_id,
            &event_type,
            &state_key,
            crate::probed_state::now_ms(),
        );
        if written.is_some() {
            return Ok(written);
        }
        let client = self.client().await?;
        let room = self.room(&room_id).await?;
        let event = room
            .get_state_event(event_type.clone().into(), &state_key)
            .await
            .ok()
            .flatten();

        let content = event.and_then(|raw| {
            let field = match raw {
                RawAnySyncOrStrippedState::Sync(event) => event.get_field("content"),
                RawAnySyncOrStrippedState::Stripped(event) => event.get_field("content"),
            };
            field.ok().flatten()
        });

        if content.is_some() {
            return Ok(content);
        }
        let probed = self
            .probed_state()
            .content(&room_id, &event_type, &state_key);
        match probed {
            Probed::Present(content) => return Ok(Some(content)),
            Probed::Absent => return Ok(None),
            Probed::Unknown => {}
        }

        let content = match client
            .send(get_state_event_for_key::v3::Request::new(
                room_id.clone(),
                event_type.clone().into(),
                state_key.clone(),
            ))
            .await
        {
            Ok(response) => state_event_content(response.event_or_content.get()),
            Err(error) if error.client_api_error_kind() == Some(&ErrorKind::NotFound) => None,
            Err(error) => {
                return Err(self.room_error("room_state_event", error.into()));
            }
        };
        self.probed_state()
            .remember_content(&room_id, &event_type, &state_key, content.clone());

        Ok(content)
    }
}

fn room_state_by_type(
    events: &[Raw<matrix_sdk::ruma::events::AnyStateEvent>],
) -> HashMap<String, Vec<RoomStateEventView>> {
    let mut state: HashMap<String, Vec<RoomStateEventView>> = HashMap::new();
    for raw in events {
        let Some(event_type) = raw.get_field::<String>("type").ok().flatten() else {
            continue;
        };
        if event_type == "m.room.member" {
            continue;
        }
        let (Some(state_key), Some(content)) = (
            raw.get_field::<String>("state_key").ok().flatten(),
            raw.get_field::<serde_json::Value>("content").ok().flatten(),
        ) else {
            continue;
        };
        state
            .entry(event_type)
            .or_default()
            .push(RoomStateEventView { state_key, content });
    }
    state
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_a_custom_reaction_carries_its_shortcode_wrapped_in_colons() {
        assert_eq!(
            super::reaction_shortcode("mxc://example.org/parrot", Some("partyparrot")),
            Some(serde_json::json!(":partyparrot:"))
        );
        assert_eq!(
            super::reaction_shortcode("mxc://example.org/parrot", Some(":partyparrot:")),
            Some(serde_json::json!(":partyparrot:"))
        );
    }

    #[test]
    fn test_an_emoji_reaction_or_a_blank_name_carries_no_shortcode() {
        assert_eq!(super::reaction_shortcode("👍", Some("thumbsup")), None);
        assert_eq!(
            super::reaction_shortcode("mxc://example.org/a", Some("  ")),
            None
        );
        assert_eq!(super::reaction_shortcode("mxc://example.org/a", None), None);
    }

    #[test]
    fn test_a_long_shortcode_is_cut_to_100_bytes_on_a_character_boundary() {
        let long = "é".repeat(80);
        let Some(serde_json::Value::String(shortcode)) =
            super::reaction_shortcode("mxc://example.org/a", Some(&long))
        else {
            panic!("a shortcode was expected");
        };

        assert!(shortcode.len() <= 100);
        assert!(shortcode.starts_with(':') && shortcode.ends_with(':'));
        assert_eq!(shortcode.len(), 2 + 49 * 2);
    }

    use super::{empty_mentions_extra, ensure_empty_mentions, state_event_content};
    use matrix_sdk::room::edit::EditedContent;
    use matrix_sdk::ruma::RoomId;
    use matrix_sdk::ruma::events::relation::Reply;
    use matrix_sdk::ruma::events::room::message::{AddMentions, Relation};

    use crate::messages::edit_content;
    use crate::outgoing::{
        gif_content, location_content, message_content, reply_relation_fallback, thread_reply,
    };
    use crate::protocol::{CreateJoinRuleView, MessageKind};

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
    fn the_voice_power_level_override_restates_the_default_events() {
        let value = serde_json::to_value(super::voice_power_level_override()).unwrap();
        assert_eq!(value["events"]["m.room.name"], 50);
        assert_eq!(value["events"]["m.room.encryption"], 100);
        assert_eq!(value["events"][crate::view::CALL_MEMBER_TYPE], 0);
        assert_eq!(value.as_object().unwrap().len(), 1);
    }

    #[test]
    fn a_silent_reply_carries_no_mention() {
        let event_id = <&matrix_sdk::ruma::EventId>::try_from("$one:example.org")
            .expect("an event id")
            .to_owned();

        let loud = thread_reply(Some(event_id.clone()), None, false).expect("a reply");
        assert_eq!(loud.add_mentions, AddMentions::Yes);

        let silent = thread_reply(Some(event_id), None, true).expect("a reply");
        assert_eq!(silent.add_mentions, AddMentions::No);
    }

    #[test]
    fn a_state_event_reply_keeps_the_relation_without_a_fallback() {
        let event_id = <&matrix_sdk::ruma::EventId>::try_from("$state:example.org")
            .expect("an event id")
            .to_owned();
        let content = message_content(
            "reply".to_owned(),
            None,
            MessageKind::Text,
            Vec::new(),
            false,
        );

        let content = reply_relation_fallback(content, event_id.clone(), None);
        assert!(matches!(
            content.relates_to,
            Some(Relation::Reply(Reply { in_reply_to, .. }))
                if in_reply_to.event_id == event_id
        ));
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
    fn a_restricted_room_without_a_space_falls_back_to_invite() {
        let rule = |kind, space: Option<&str>| {
            super::join_rule_content(
                Some(kind),
                space.map(|id| <&RoomId>::try_from(id).expect("a room id")),
            )
            .map(|rule| serde_json::to_value(rule).expect("serializes"))
            .expect("a rule")["content"]["join_rule"]
                .as_str()
                .expect("a string")
                .to_owned()
        };

        assert_eq!(rule(CreateJoinRuleView::Restricted, None), "invite");
        assert_eq!(rule(CreateJoinRuleView::KnockRestricted, None), "invite");
        assert_eq!(
            rule(CreateJoinRuleView::Restricted, Some("!s:example.org")),
            "restricted"
        );
        assert_eq!(rule(CreateJoinRuleView::Knock, None), "knock");
        assert_eq!(rule(CreateJoinRuleView::Public, None), "public");
    }

    #[test]
    fn a_restricted_room_allows_the_parent_space() {
        let content = super::join_rule_content(
            Some(CreateJoinRuleView::Restricted),
            Some(<&RoomId>::try_from("!space:example.org").expect("a room id")),
        )
        .map(|rule| serde_json::to_value(rule).expect("serializes"))
        .expect("a rule");

        assert_eq!(
            content["content"]["allow"][0]["room_id"],
            "!space:example.org"
        );
        assert_eq!(content["content"]["allow"][0]["type"], "m.room_membership");
    }

    #[test]
    fn no_join_rule_leaves_the_preset_alone() {
        assert!(super::join_rule_content(None, None).is_none());
    }

    use crate::view;
    use matrix_sdk::ruma::owned_user_id;

    #[test]
    fn a_message_without_pills_sends_an_empty_m_mentions() {
        let content = message_content(
            "hello".to_owned(),
            None,
            MessageKind::Text,
            Vec::new(),
            false,
        );

        assert_eq!(
            serde_json::to_value(&content).unwrap()["m.mentions"],
            serde_json::json!({})
        );
    }

    #[test]
    fn gifs_and_locations_without_mentions_send_an_empty_m_mentions() {
        let gif = gif_content(
            "dancing".to_owned(),
            matrix_sdk::ruma::OwnedMxcUri::from("mxc://example.org/gif"),
            super::ImageInfo::new(),
        );
        let location = location_content("here".to_owned(), "geo:48.8584,2.2945".to_owned());

        for content in [gif, location] {
            assert_eq!(
                serde_json::to_value(content).unwrap()["m.mentions"],
                serde_json::json!({})
            );
        }
    }

    #[test]
    fn polls_receive_an_empty_m_mentions_extra_field() {
        assert_eq!(
            empty_mentions_extra().unwrap()["m.mentions"],
            serde_json::json!({})
        );
    }

    #[test]
    fn raw_events_without_mentions_receive_an_empty_m_mentions() {
        let mut content = serde_json::json!({"body": "hello"});
        ensure_empty_mentions(&mut content);

        assert_eq!(content["m.mentions"], serde_json::json!({}));
    }

    #[test]
    fn pills_become_m_mentions() {
        let content = message_content(
            "hi One".to_owned(),
            None,
            MessageKind::Text,
            vec![owned_user_id!("@one:example.org")],
            false,
        );

        let mentions = content.mentions.expect("mentions");
        assert!(
            mentions
                .user_ids
                .contains(&owned_user_id!("@one:example.org"))
        );
        assert!(!mentions.room);
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

    #[test]
    fn a_geo_uri_is_checked_before_it_is_sent() {
        assert!(view::geo_coordinates("geo:48.8584,2.2945").is_some());
        assert!(view::geo_coordinates("48.8584,2.2945").is_none());
        assert!(view::geo_coordinates("geo:91,0").is_none());
    }

    #[test]
    fn each_kind_picks_its_msgtype() {
        let kinds = [
            (MessageKind::Text, "m.text"),
            (MessageKind::Emote, "m.emote"),
            (MessageKind::Notice, "m.notice"),
        ];

        for (kind, msgtype) in kinds {
            let plain = message_content("waves".to_owned(), None, kind, Vec::new(), false);
            let formatted = message_content(
                "waves".to_owned(),
                Some("<em>waves</em>".to_owned()),
                kind,
                Vec::new(),
                false,
            );

            assert_eq!(plain.msgtype(), msgtype, "{kind:?} plain");
            assert_eq!(formatted.msgtype(), msgtype, "{kind:?} formatted");
        }
    }

    #[test]
    fn editing_an_image_caption_uses_sdk_media_edit_with_formatting_and_mentions() {
        let content = edit_content(
            "updated caption".to_owned(),
            Some("<b>updated caption</b>".to_owned()),
            MessageKind::Text,
            true,
            vec![matrix_sdk::ruma::user_id!("@alice:example.org").to_owned()],
            true,
        );
        let EditedContent::MediaCaption {
            caption,
            formatted_caption,
            mentions,
        } = content
        else {
            panic!("expected SDK caption edit");
        };
        assert_eq!(caption.as_deref(), Some("updated caption"));
        assert_eq!(formatted_caption.unwrap().body, "<b>updated caption</b>");
        let mentions = mentions.unwrap();
        assert!(mentions.room);
        assert!(
            mentions
                .user_ids
                .contains(matrix_sdk::ruma::user_id!("@alice:example.org"))
        );
    }

    #[tokio::test]
    async fn caption_edit_retains_original_media_metadata() {
        use matrix_sdk::{
            ruma::{event_id, room_id, user_id},
            test_utils::mocks::MatrixMockServer,
        };
        use serde_json::json;
        use wiremock::{
            Mock, ResponseTemplate,
            matchers::{method, path},
        };
        let server = MatrixMockServer::new().await;
        let client = server.client_builder().build().await;
        let room_id = room_id!("!caption:example.org");
        let room = server.sync_joined_room(&client, room_id).await;
        let info = json!({"mimetype": "image/png", "w": 800, "h": 600, "size": 12345,
            "thumbnail_url": "mxc://example.org/thumbnail",
            "thumbnail_info": {"mimetype": "image/png", "w": 80, "h": 60, "size": 123},
            "xyz.amorgan.blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj"});
        Mock::given(method("GET"))
            .and(path(format!(
                "/_matrix/client/v3/rooms/{room_id}/event/$image"
            )))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "type": "m.room.message", "event_id": "$image", "room_id": room_id,
                "sender": client.user_id().unwrap(), "origin_server_ts": 1,
                "content": {"msgtype": "m.image", "body": "old caption", "filename": "photo.png",
                    "url": "mxc://example.org/photo", "info": info}
            })))
            .mount(server.server())
            .await;
        let edit = edit_content(
            "new caption".to_owned(),
            Some("<b>new caption</b>".to_owned()),
            MessageKind::Text,
            true,
            vec![user_id!("@bob:example.org").to_owned()],
            false,
        );
        let content = room
            .make_edit_event(event_id!("$image"), edit)
            .await
            .unwrap();
        let content = serde_json::to_value(content).unwrap();
        let updated = &content["m.new_content"];
        assert_eq!(updated["info"], info);
        assert_eq!(updated["url"], "mxc://example.org/photo");
        assert_eq!(updated["filename"], "photo.png");
        assert_eq!(updated["formatted_body"], "<b>new caption</b>");
        assert_eq!(
            updated["m.mentions"]["user_ids"],
            json!(["@bob:example.org"])
        );
    }

    #[test]
    fn a_room_mention_needs_no_user_ids() {
        let content = message_content(
            "@room heads up".to_owned(),
            None,
            MessageKind::Text,
            Vec::new(),
            true,
        );

        let mentions = content.mentions.expect("mentions");
        assert!(mentions.user_ids.is_empty());
        assert!(mentions.room);
    }

    #[test]
    fn state_event_content_accepts_content_and_full_event_responses() {
        assert_eq!(
            state_event_content(r#"{"url":"mxc://example.org/banner"}"#),
            Some(serde_json::json!({"url": "mxc://example.org/banner"}))
        );
        assert_eq!(
            state_event_content(
                r#"{"type":"page.codeberg.everypizza.room.banner","content":{"url":"mxc://example.org/banner"}}"#
            ),
            Some(serde_json::json!({"url": "mxc://example.org/banner"}))
        );
    }

    #[tokio::test]
    async fn soliditas_preview_asks_the_worker_with_the_url() {
        use wiremock::{
            Mock, MockServer, ResponseTemplate,
            matchers::{method, path, query_param},
        };
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_soliditas/preview_url"))
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
