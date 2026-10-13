use std::collections::{BTreeMap, BTreeSet};

use matrix_sdk::Room;
use matrix_sdk::ruma::events::room::message::RoomMessageEventContentWithoutRelation;
use matrix_sdk::ruma::events::{
    AnyMessageLikeEventContent, GlobalAccountDataEventType, MessageLikeEventContent,
};
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::{OwnedRoomId, TransactionId};
use matrix_sdk::send_queue::LocalEchoContent;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value, json};

use crate::Core;
use crate::ResultExt;
use crate::profiles::pronoun_sets;
use crate::protocol::{
    CommandErr, PerMessageProfileView, PersonaCatalogView, PersonaSelectionView,
    PersonaTriggerView, PersonaView, PluralkitImportView, PronounView,
};

const CATALOG_V3: &str = "fi.mau.msc4461.per_message_profiles.v3";
const CATALOG_V2: &str = "fi.mau.msc4461.per_message_profiles.v2";
const SELECTION_PREFIX: &str = "fyi.cisnt.permessageprofile";

pub(crate) const PER_MESSAGE_PROFILE: &str = "com.beeper.per_message_profile";

fn selection_event(scope: &str) -> GlobalAccountDataEventType {
    GlobalAccountDataEventType::from(format!("{SELECTION_PREFIX}.{scope}"))
}

fn trimmed(value: &Value) -> Option<String> {
    Some(value.as_str()?.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn lenient_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(trimmed(&Value::deserialize(deserializer)?))
}

fn lenient_list<'de, D, T>(deserializer: D) -> Result<Option<Vec<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(entries) => Some(
            entries
                .into_iter()
                .filter_map(|entry| serde_json::from_value(entry).ok())
                .collect(),
        ),
        _ => None,
    })
}

fn lenient_map<'de, D, T>(deserializer: D) -> Result<BTreeMap<String, T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(match Value::deserialize(deserializer)? {
        Value::Object(entries) => entries
            .into_iter()
            .filter_map(|(key, entry)| Some((key, serde_json::from_value(entry).ok()?)))
            .collect(),
        _ => BTreeMap::new(),
    })
}

#[derive(Deserialize)]
struct Text(#[serde(deserialize_with = "lenient_text")] Option<String>);

#[derive(Deserialize)]
struct TriggerIn {
    #[serde(default, deserialize_with = "lenient_text")]
    prefix: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    suffix: Option<String>,
    #[serde(default, deserialize_with = "sable_model::lenient::option")]
    keep_trigger: Option<bool>,
}

impl TriggerIn {
    fn into_view(self) -> Option<PersonaTriggerView> {
        if self.prefix.is_none() && self.suffix.is_none() {
            return None;
        }

        Some(PersonaTriggerView {
            prefix: self.prefix,
            suffix: self.suffix,
            keep_trigger: self.keep_trigger.unwrap_or(false),
        })
    }
}

#[derive(Deserialize)]
struct TriggerV2In {
    #[serde(default, deserialize_with = "lenient_list")]
    prefix: Option<Vec<Text>>,
    #[serde(
        default,
        rename = "net.f0rest.suffix",
        deserialize_with = "lenient_list"
    )]
    suffix: Option<Vec<Text>>,
    #[serde(
        default,
        rename = "net.f0rest.circumfix",
        deserialize_with = "lenient_list"
    )]
    circumfix: Option<Vec<TriggerIn>>,
}

impl TriggerV2In {
    fn into_views(self) -> Vec<PersonaTriggerView> {
        let circumfixes = self
            .circumfix
            .into_iter()
            .flatten()
            .filter(|trigger| trigger.prefix.is_some() && trigger.suffix.is_some())
            .map(|trigger| PersonaTriggerView {
                prefix: trigger.prefix,
                suffix: trigger.suffix,
                keep_trigger: false,
            });
        let prefixes = self
            .prefix
            .into_iter()
            .flatten()
            .filter_map(|prefix| prefix.0)
            .map(|prefix| PersonaTriggerView {
                prefix: Some(prefix),
                suffix: None,
                keep_trigger: false,
            });
        let suffixes = self
            .suffix
            .into_iter()
            .flatten()
            .filter_map(|suffix| suffix.0)
            .map(|suffix| PersonaTriggerView {
                prefix: None,
                suffix: Some(suffix),
                keep_trigger: false,
            });

        circumfixes.chain(prefixes).chain(suffixes).collect()
    }
}

#[derive(Default, Deserialize)]
struct ColorsIn {
    #[serde(default, deserialize_with = "lenient_text")]
    on_light: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    on_dark: Option<String>,
}

#[derive(Deserialize)]
struct PluralkitIn {
    #[serde(default, deserialize_with = "lenient_text")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    uuid: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    avatar_url: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    description: Option<String>,
}

impl PluralkitIn {
    fn into_view(self) -> Option<PluralkitImportView> {
        Some(PluralkitImportView {
            id: self.id?,
            uuid: self.uuid,
            avatar_url: self.avatar_url,
            description: self.description,
        })
    }
}

#[derive(Deserialize)]
struct PersonaIn {
    #[serde(default, deserialize_with = "lenient_text")]
    id: Option<String>,
    #[serde(default, deserialize_with = "sable_model::lenient::option")]
    displayname: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    avatar_url: Option<String>,
    #[serde(default, rename = "io.fsky.nyx.pronouns")]
    pronouns: Option<Value>,
    #[serde(
        default,
        rename = "eu.she-a.color",
        deserialize_with = "sable_model::lenient::option"
    )]
    colors: Option<ColorsIn>,
    #[serde(default, deserialize_with = "lenient_list")]
    triggers: Option<Vec<TriggerIn>>,
    #[serde(default, deserialize_with = "sable_model::lenient::option")]
    trigger: Option<TriggerV2In>,
    #[serde(
        default,
        rename = "net.f0rest.pkimport",
        deserialize_with = "sable_model::lenient::option"
    )]
    pluralkit: Option<PluralkitIn>,
    #[serde(
        default,
        rename = "net.f0rest.last_used",
        deserialize_with = "sable_model::lenient::option"
    )]
    last_used: Option<u64>,
}

impl PersonaIn {
    fn into_view(self) -> Option<PersonaView> {
        let colors = self.colors.unwrap_or_default();
        let triggers = match self.triggers {
            Some(entries) => entries
                .into_iter()
                .filter_map(TriggerIn::into_view)
                .collect(),
            None => self.trigger.map_or_else(Vec::new, TriggerV2In::into_views),
        };

        Some(PersonaView {
            id: self.id?,
            display_name: self.displayname?,
            avatar_url: self.avatar_url,
            pronouns: pronoun_sets(self.pronouns.as_ref()),
            color_on_light: colors.on_light,
            color_on_dark: colors.on_dark,
            triggers,
            pluralkit: self.pluralkit.and_then(PluralkitIn::into_view),
            last_used: self.last_used,
        })
    }
}

#[derive(Deserialize)]
struct ProfilesIn {
    #[serde(default, deserialize_with = "lenient_list")]
    profiles: Option<Vec<PersonaIn>>,
}

fn personas_from_catalog(content: &Value) -> Vec<PersonaView> {
    #[derive(Deserialize)]
    struct Wrapped {
        #[serde(default, deserialize_with = "sable_model::lenient::option")]
        content: Option<ProfilesIn>,
    }

    let profiles = ProfilesIn::deserialize(content)
        .ok()
        .and_then(|catalog| catalog.profiles)
        .or_else(|| Wrapped::deserialize(content).ok()?.content?.profiles);

    let mut seen = BTreeSet::new();
    profiles
        .into_iter()
        .flatten()
        .filter_map(PersonaIn::into_view)
        .filter(|persona| seen.insert(persona.id.clone()))
        .collect()
}

#[derive(Serialize)]
struct PronounOut<'a> {
    summary: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<&'a str>,
}

impl<'a> From<&'a PronounView> for PronounOut<'a> {
    fn from(pronoun: &'a PronounView) -> Self {
        Self {
            summary: &pronoun.summary,
            language: pronoun.language.as_deref(),
        }
    }
}

#[derive(Serialize)]
struct ColorsOut<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    on_light: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    on_dark: Option<&'a str>,
}

impl<'a> ColorsOut<'a> {
    fn new(on_light: Option<&'a str>, on_dark: Option<&'a str>) -> Option<Self> {
        (on_light.is_some() || on_dark.is_some()).then_some(Self { on_light, on_dark })
    }
}

#[derive(Serialize)]
struct PluralkitOut<'a> {
    id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    uuid: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
}

impl<'a> From<&'a PluralkitImportView> for PluralkitOut<'a> {
    fn from(pluralkit: &'a PluralkitImportView) -> Self {
        Self {
            id: &pluralkit.id,
            uuid: pluralkit.uuid.as_deref(),
            avatar_url: pluralkit.avatar_url.as_deref(),
            description: pluralkit.description.as_deref(),
        }
    }
}

#[derive(Serialize)]
struct TriggerOut<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    prefix: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suffix: Option<&'a str>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    keep_trigger: bool,
}

impl<'a> From<&'a PersonaTriggerView> for TriggerOut<'a> {
    fn from(trigger: &'a PersonaTriggerView) -> Self {
        Self {
            prefix: trigger.prefix.as_deref(),
            suffix: trigger.suffix.as_deref(),
            keep_trigger: trigger.keep_trigger,
        }
    }
}

#[derive(Serialize)]
struct PersonaOut<'a> {
    id: &'a str,
    displayname: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<&'a str>,
    #[serde(rename = "io.fsky.nyx.pronouns", skip_serializing_if = "Vec::is_empty")]
    pronouns: Vec<PronounOut<'a>>,
    #[serde(rename = "eu.she-a.color", skip_serializing_if = "Option::is_none")]
    colors: Option<ColorsOut<'a>>,
    #[serde(
        rename = "net.f0rest.pkimport",
        skip_serializing_if = "Option::is_none"
    )]
    pluralkit: Option<PluralkitOut<'a>>,
    triggers: Vec<TriggerOut<'a>>,
    #[serde(
        rename = "net.f0rest.last_used",
        skip_serializing_if = "Option::is_none"
    )]
    last_used: Option<u64>,
}

impl<'a> From<&'a PersonaView> for PersonaOut<'a> {
    fn from(persona: &'a PersonaView) -> Self {
        Self {
            id: &persona.id,
            displayname: &persona.display_name,
            avatar_url: persona.avatar_url.as_deref(),
            pronouns: persona.pronouns.iter().map(Into::into).collect(),
            colors: ColorsOut::new(
                persona.color_on_light.as_deref(),
                persona.color_on_dark.as_deref(),
            ),
            pluralkit: persona.pluralkit.as_ref().map(Into::into),
            triggers: persona.triggers.iter().map(Into::into).collect(),
            last_used: persona.last_used,
        }
    }
}

#[derive(Serialize)]
struct CatalogOut<'a> {
    profiles: Vec<PersonaOut<'a>>,
}

#[derive(Deserialize)]
struct SelectionIn {
    #[serde(default, rename = "profileId", deserialize_with = "lenient_text")]
    profile_id: Option<String>,
    #[serde(
        default,
        rename = "validUntil",
        deserialize_with = "sable_model::lenient::option"
    )]
    valid_until: Option<u64>,
}

impl SelectionIn {
    fn into_view(self) -> Option<PersonaSelectionView> {
        Some(PersonaSelectionView {
            persona_id: self.profile_id?,
            valid_until: self.valid_until,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionOut<'a> {
    profile_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    valid_until: Option<u64>,
}

impl<'a> From<&'a PersonaSelectionView> for SelectionOut<'a> {
    fn from(selection: &'a PersonaSelectionView) -> Self {
        Self {
            profile_id: &selection.persona_id,
            valid_until: selection.valid_until,
        }
    }
}

#[derive(Deserialize)]
struct AccountSelectionIn {
    #[serde(default, deserialize_with = "sable_model::lenient::option")]
    association: Option<SelectionIn>,
}

#[derive(Serialize)]
struct AccountSelectionOut<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    association: Option<SelectionOut<'a>>,
}

#[derive(Debug, Clone)]
enum RoomAssociation {
    Persona(PersonaSelectionView),
    Disabled,
}

impl Serialize for RoomAssociation {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Persona(selection) => SelectionOut::from(selection).serialize(serializer),
            Self::Disabled => serializer.serialize_bool(false),
        }
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum AssociationIn {
    Off(bool),
    Persona(SelectionIn),
}

impl AssociationIn {
    fn into_association(self) -> Option<RoomAssociation> {
        match self {
            Self::Off(false) => Some(RoomAssociation::Disabled),
            Self::Off(true) => None,
            Self::Persona(selection) => selection.into_view().map(RoomAssociation::Persona),
        }
    }
}

fn room_associations(content: &Value) -> BTreeMap<String, RoomAssociation> {
    #[derive(Deserialize)]
    struct RoomAssociationsIn {
        #[serde(default, deserialize_with = "lenient_map")]
        associations: BTreeMap<String, AssociationIn>,
    }

    RoomAssociationsIn::deserialize(content)
        .map(|content| content.associations)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(room_id, association)| Some((room_id, association.into_association()?)))
        .collect()
}

#[derive(Serialize)]
struct RoomAssociationsOut<'a> {
    associations: &'a BTreeMap<String, RoomAssociation>,
}

const MAX_FIELD_BYTES: usize = 255;

fn clamp_field(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character != '\0')
        .scan(0usize, |used, character| {
            let next = *used + character.len_utf8();
            if next > MAX_FIELD_BYTES {
                return None;
            }
            *used = next;
            Some(character)
        })
        .collect()
}

#[derive(Serialize)]
struct ProfileOut<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    displayname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<&'a str>,
    #[serde(rename = "io.fsky.nyx.pronouns", skip_serializing_if = "Vec::is_empty")]
    pronouns: Vec<PronounOut<'a>>,
    #[serde(rename = "eu.she-a.color", skip_serializing_if = "Option::is_none")]
    colors: Option<ColorsOut<'a>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    has_fallback: bool,
}

pub(crate) fn profile_value(profile: &PerMessageProfileView) -> Value {
    let out = ProfileOut {
        id: profile
            .id
            .as_deref()
            .map(clamp_field)
            .filter(|id| !id.is_empty()),
        displayname: profile
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(clamp_field),
        avatar_url: profile.avatar_url.as_deref(),
        pronouns: profile.pronouns.iter().map(Into::into).collect(),
        colors: ColorsOut::new(
            profile.color_on_light.as_deref(),
            profile.color_on_dark.as_deref(),
        ),
        has_fallback: profile.has_fallback,
    };
    // Strings, bools and lists of them always serialize.
    serde_json::to_value(out).unwrap_or_default()
}
pub(crate) fn profile_extra_content(profile: &PerMessageProfileView) -> Map<String, Value> {
    [(PER_MESSAGE_PROFILE.to_owned(), profile_value(profile))]
        .into_iter()
        .collect()
}

pub(crate) fn without_fallback(profile: &PerMessageProfileView) -> PerMessageProfileView {
    PerMessageProfileView {
        has_fallback: false,
        ..profile.clone()
    }
}

pub(crate) fn fallback_body(
    body: &str,
    formatted: Option<&str>,
    profile: &PerMessageProfileView,
    edit: bool,
) -> Option<(String, String)> {
    if !profile.has_fallback {
        return None;
    }
    let name = profile
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(clamp_field)
        .filter(|name| !name.is_empty())?;

    let plain_prefix = format!("{name}: ");
    let html_prefix = format!(
        "<strong data-mx-profile-fallback>{}: </strong>",
        html_escape::encode_text(&name)
    );

    let (marker, body) = split_edit_marker(body, edit);
    let formatted = formatted.map(|html| split_edit_marker(html, edit).1.to_owned());
    let stripped = body.strip_prefix(&plain_prefix).unwrap_or(body);

    let formatted = match formatted {
        Some(html) if html.starts_with(&html_prefix) => html,
        Some(html) => format!("{html_prefix}{html}"),
        None => format!(
            "{html_prefix}{}",
            html_escape::encode_text(stripped).replace('\n', "<br/>")
        ),
    };

    Some((
        format!("{marker}{plain_prefix}{stripped}"),
        format!("{marker}{formatted}"),
    ))
}

pub(crate) fn outgoing_with_fallback(
    body: String,
    formatted: Option<String>,
    profile: &PerMessageProfileView,
) -> (String, Option<String>, PerMessageProfileView) {
    match fallback_body(&body, formatted.as_deref(), profile, false) {
        Some((body, formatted)) => (body, Some(formatted), profile.clone()),
        None => (body, formatted, without_fallback(profile)),
    }
}

pub(crate) fn stamp_profile(content: &mut Value, profile: &PerMessageProfileView) {
    let Some(object) = content.as_object_mut() else {
        return;
    };

    let raw_body = object
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let raw_formatted = object
        .get("formatted_body")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    let edit = object.contains_key("m.new_content");
    let Some((body, formatted)) = fallback_body(&raw_body, raw_formatted.as_deref(), profile, edit)
    else {
        object.insert(
            PER_MESSAGE_PROFILE.to_owned(),
            profile_value(&without_fallback(profile)),
        );
        return;
    };

    object.insert(PER_MESSAGE_PROFILE.to_owned(), profile_value(profile));
    object.insert("format".to_owned(), "org.matrix.custom.html".into());
    object.insert("formatted_body".to_owned(), formatted.into());
    object.insert("body".to_owned(), body.into());
}

const EDIT_MARKER: &str = "* ";

fn split_edit_marker(value: &str, edit: bool) -> (&str, &str) {
    value
        .strip_prefix(EDIT_MARKER)
        .filter(|_| edit)
        .map_or(("", value), |rest| (EDIT_MARKER, rest))
}

fn catalog_from_backup(backup: &str) -> Option<Value> {
    let parsed: Value = serde_json::from_str(backup).ok()?;
    let catalog = parsed.get(CATALOG_V3)?;
    catalog
        .get("profiles")
        .is_some_and(Value::is_array)
        .then(|| catalog.clone())
}

impl Core {
    pub(crate) async fn edit_local_with_persona(
        &self,
        room: &Room,
        transaction_id: &TransactionId,
        message: RoomMessageEventContentWithoutRelation,
        profile: &PerMessageProfileView,
    ) -> Result<bool, CommandErr> {
        let (echoes, _updates) = room
            .send_queue()
            .subscribe()
            .await
            .or_failed(self, "edit_local_with_persona")?;

        let Some((serialized, handle)) = echoes.into_iter().find_map(|echo| {
            if echo.transaction_id != *transaction_id {
                return None;
            }
            match echo.content {
                LocalEchoContent::Event {
                    serialized_event,
                    send_handle,
                    ..
                } => Some((serialized_event, send_handle)),
                _ => None,
            }
        }) else {
            return Ok(false);
        };

        let previous = serialized
            .raw()
            .0
            .deserialize_as_unchecked::<Value>()
            .or_failed(self, "edit_local_with_persona")?;
        let mut value =
            serde_json::to_value(&message).or_failed(self, "edit_local_with_persona")?;
        if let Some(object) = value.as_object_mut()
            && let Some(relation) = previous.get("m.relates_to")
        {
            object.insert("m.relates_to".to_owned(), relation.clone());
        }
        stamp_profile(&mut value, profile);
        ensure_empty_mentions(&mut value);

        let raw = Raw::<AnyMessageLikeEventContent>::from_json_string(value.to_string())
            .or_failed(self, "edit_local_with_persona")?;

        handle
            .edit_raw(raw, "m.room.message".to_owned())
            .await
            .or_failed(self, "edit_local_with_persona")
    }

    pub(crate) async fn edit_with_persona(
        &self,
        room: &Room,
        content: &AnyMessageLikeEventContent,
        profile: Option<&PerMessageProfileView>,
        forum_title: Option<String>,
    ) -> Result<(), CommandErr> {
        let event_type = content.event_type().to_string();
        let title = crate::dispatch::forum_title_value(forum_title);
        let mut value = serde_json::to_value(content).or_failed(self, "edit_with_persona")?;

        let update = |content: &mut Value| {
            if let Some(profile) = profile {
                stamp_profile(content, profile);
            } else if let Some(object) = content.as_object_mut() {
                object.remove(PER_MESSAGE_PROFILE);
                object.remove("m.per_message_profile");
            }
            ensure_empty_mentions(content);
            if let (Some(title), Some(object)) = (&title, content.as_object_mut()) {
                object.insert(crate::view::FORUM_TITLE.to_owned(), title.clone());
            }
        };
        update(&mut value);
        if let Some(content) = value.get_mut("m.new_content") {
            update(content);
        }

        let raw = Raw::<AnyMessageLikeEventContent>::from_json_string(value.to_string())
            .or_failed(self, "edit_with_persona")?;

        room.send_queue()
            .send_raw(raw, event_type)
            .await
            .or_failed(self, "edit_with_persona")?;

        Ok(())
    }

    async fn persona_account_data(
        &self,
        event_type: GlobalAccountDataEventType,
    ) -> Result<Option<Value>, CommandErr> {
        let Some(raw) = self
            .global_account_data(event_type, "personas: fetch_account_data")
            .await?
        else {
            return Ok(None);
        };

        raw.deserialize_as::<Value>()
            .map(Some)
            .or_failed(self, "personas_deserialize")
    }

    async fn load_personas(&self) -> Result<Vec<PersonaView>, CommandErr> {
        if let Some(content) = self
            .persona_account_data(GlobalAccountDataEventType::from(CATALOG_V3))
            .await?
            && content.get("profiles").is_some()
        {
            return Ok(personas_from_catalog(&content));
        }

        let Some(content) = self
            .persona_account_data(GlobalAccountDataEventType::from(CATALOG_V2))
            .await?
        else {
            return Ok(Vec::new());
        };

        let personas = personas_from_catalog(&content);
        if personas.is_empty() {
            return Ok(personas);
        }

        self.save_personas(&personas).await?;
        Ok(personas)
    }

    /// A backup file is the v3 catalog event wrapped under its own type.
    pub(crate) async fn persona_backup(&self) -> Result<String, CommandErr> {
        let content = self
            .persona_account_data(GlobalAccountDataEventType::from(CATALOG_V3))
            .await?;
        serde_json::to_string_pretty(&json!({ CATALOG_V3: content }))
            .or_failed(self, "persona_backup")
    }

    pub(crate) fn check_persona_backup(backup: &str) -> Result<(), CommandErr> {
        catalog_from_backup(backup)
            .map(drop)
            .ok_or(CommandErr::InvalidBackup)
    }

    pub(crate) async fn restore_persona_backup(&self, backup: &str) -> Result<(), CommandErr> {
        let catalog = catalog_from_backup(backup).ok_or(CommandErr::InvalidBackup)?;
        self.put_global_account_data(
            GlobalAccountDataEventType::from(CATALOG_V3),
            &catalog,
            "restore_persona_backup",
        )
        .await
    }

    async fn save_personas(&self, personas: &[PersonaView]) -> Result<(), CommandErr> {
        self.put_global_account_data(
            GlobalAccountDataEventType::from(CATALOG_V3),
            &CatalogOut {
                profiles: personas.iter().map(Into::into).collect(),
            },
            "personas",
        )
        .await
    }

    async fn account_selection(&self) -> Result<Option<PersonaSelectionView>, CommandErr> {
        Ok(self
            .persona_account_data(selection_event("globalassociation"))
            .await?
            .as_ref()
            .and_then(|content| {
                AccountSelectionIn::deserialize(content)
                    .ok()?
                    .association?
                    .into_view()
            }))
    }

    async fn room_selections(&self) -> Result<BTreeMap<String, RoomAssociation>, CommandErr> {
        Ok(self
            .persona_account_data(selection_event("roomassociation"))
            .await?
            .as_ref()
            .map(room_associations)
            .unwrap_or_default())
    }

    pub(crate) async fn personas(&self) -> Result<PersonaCatalogView, CommandErr> {
        let mut rooms = BTreeMap::new();
        let mut disabled_rooms = Vec::new();
        for (room_id, association) in self.room_selections().await? {
            match association {
                RoomAssociation::Persona(selection) => {
                    rooms.insert(room_id, selection);
                }
                RoomAssociation::Disabled => disabled_rooms.push(room_id),
            }
        }

        Ok(PersonaCatalogView {
            personas: self.load_personas().await?,
            account: self.account_selection().await?,
            rooms,
            disabled_rooms,
        })
    }

    pub(crate) async fn save_persona(
        &self,
        persona: PersonaView,
        previous_id: Option<String>,
    ) -> Result<Vec<PersonaView>, CommandErr> {
        let _guard = self.account_data_lock.lock().await;
        let replaced = previous_id.unwrap_or_else(|| persona.id.clone());
        let mut personas = self.load_personas().await?;

        personas.retain(|existing| existing.id != persona.id || existing.id == replaced);
        match personas.iter_mut().find(|existing| existing.id == replaced) {
            Some(existing) => *existing = persona.clone(),
            None => personas.push(persona.clone()),
        }

        self.save_personas(&personas).await?;
        if replaced != persona.id {
            self.repoint_selections(&replaced, Some(&persona.id))
                .await?;
        }

        Ok(personas)
    }

    pub(crate) async fn remove_persona(&self, id: &str) -> Result<Vec<PersonaView>, CommandErr> {
        let _guard = self.account_data_lock.lock().await;
        let mut personas = self.load_personas().await?;
        personas.retain(|persona| persona.id != id);

        self.save_personas(&personas).await?;
        self.repoint_selections(id, None).await?;

        Ok(personas)
    }

    pub(crate) async fn reorder_personas(
        &self,
        ids: Vec<String>,
    ) -> Result<Vec<PersonaView>, CommandErr> {
        let _guard = self.account_data_lock.lock().await;
        let personas = self.load_personas().await?;
        let mut reordered = Vec::with_capacity(personas.len());
        for id in ids {
            if let Some(persona) = personas.iter().find(|persona| persona.id == id)
                && !reordered
                    .iter()
                    .any(|existing: &PersonaView| existing.id == id)
            {
                reordered.push(persona.clone());
            }
        }
        let remaining = personas
            .into_iter()
            .filter(|persona| !reordered.iter().any(|existing| existing.id == persona.id))
            .collect::<Vec<_>>();
        reordered.extend(remaining);
        self.save_personas(&reordered).await?;
        Ok(reordered)
    }

    async fn repoint_selections(&self, from: &str, to: Option<&str>) -> Result<(), CommandErr> {
        if let Some(account) = self.account_selection().await?
            && account.persona_id == from
        {
            let selection = to.map(|id| PersonaSelectionView {
                persona_id: id.to_owned(),
                valid_until: account.valid_until,
            });
            self.put_global_account_data(
                selection_event("globalassociation"),
                &AccountSelectionOut {
                    association: selection.as_ref().map(Into::into),
                },
                "personas",
            )
            .await?;
        }

        let mut rooms = self.room_selections().await?;
        let affected: Vec<String> = rooms
            .iter()
            .filter(|(_, association)| {
                matches!(association, RoomAssociation::Persona(selection) if selection.persona_id == from)
            })
            .map(|(room_id, _)| room_id.clone())
            .collect();
        if affected.is_empty() {
            return Ok(());
        }

        for room_id in affected {
            match to {
                Some(id) => {
                    if let Some(RoomAssociation::Persona(selection)) = rooms.get_mut(&room_id) {
                        id.clone_into(&mut selection.persona_id);
                    }
                }
                None => {
                    rooms.remove(&room_id);
                }
            }
        }

        self.write_room_selections(&rooms).await
    }

    async fn write_room_selections(
        &self,
        rooms: &BTreeMap<String, RoomAssociation>,
    ) -> Result<(), CommandErr> {
        self.put_global_account_data(
            selection_event("roomassociation"),
            &RoomAssociationsOut {
                associations: rooms,
            },
            "personas",
        )
        .await
    }

    pub(crate) async fn set_persona_selection(
        &self,
        room_id: Option<OwnedRoomId>,
        persona_id: Option<String>,
        valid_until: Option<u64>,
    ) -> Result<(), CommandErr> {
        let _guard = self.account_data_lock.lock().await;
        let selection = persona_id.map(|persona_id| PersonaSelectionView {
            persona_id,
            valid_until,
        });

        let Some(room_id) = room_id else {
            return self
                .put_global_account_data(
                    selection_event("globalassociation"),
                    &AccountSelectionOut {
                        association: selection.as_ref().map(Into::into),
                    },
                    "personas",
                )
                .await;
        };

        let mut rooms = self.room_selections().await?;
        match selection {
            Some(selection) => {
                rooms.insert(room_id.to_string(), RoomAssociation::Persona(selection));
            }
            None => {
                rooms.remove(room_id.as_str());
            }
        }

        self.write_room_selections(&rooms).await
    }

    pub(crate) async fn disable_room_personas(
        &self,
        room_id: OwnedRoomId,
    ) -> Result<(), CommandErr> {
        let _guard = self.account_data_lock.lock().await;
        let mut rooms = self.room_selections().await?;
        rooms.insert(room_id.to_string(), RoomAssociation::Disabled);
        self.write_room_selections(&rooms).await
    }
}

fn ensure_empty_mentions(content: &mut Value) {
    if let Some(object) = content.as_object_mut() {
        object
            .entry("m.mentions")
            .or_insert_with(|| serde_json::json!({}));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_backup_must_carry_a_catalog_with_profiles() {
        let catalog = serde_json::json!({ "profiles": [{ "id": "alt" }] });
        let backup = serde_json::json!({ super::CATALOG_V3: catalog }).to_string();
        assert_eq!(super::catalog_from_backup(&backup), Some(catalog));

        for invalid in [
            "not json".to_owned(),
            serde_json::json!({ super::CATALOG_V3: {} }).to_string(),
            serde_json::json!({ super::CATALOG_V3: null }).to_string(),
            serde_json::json!({ super::CATALOG_V3: [] }).to_string(),
            serde_json::json!({ "other": { "profiles": [] } }).to_string(),
        ] {
            assert_eq!(super::catalog_from_backup(&invalid), None, "{invalid}");
        }
    }

    use super::{
        RoomAssociation, RoomAssociationsOut, ensure_empty_mentions, fallback_body,
        outgoing_with_fallback, personas_from_catalog, profile_value, room_associations,
        stamp_profile,
    };
    use crate::protocol::{PerMessageProfileView, PronounView};
    use serde_json::json;

    fn persona(value: &serde_json::Value) -> crate::protocol::PersonaView {
        personas_from_catalog(&json!({ "profiles": [value] }))
            .pop()
            .expect("a persona")
    }

    fn profile(display_name: &str, has_fallback: bool) -> PerMessageProfileView {
        PerMessageProfileView {
            id: Some("kris".to_owned()),
            display_name: Some(display_name.to_owned()),
            avatar_url: None,
            pronouns: Vec::new(),
            color_on_light: None,
            color_on_dark: None,
            has_fallback,
        }
    }

    #[test]
    fn persona_edits_add_an_empty_m_mentions_without_overwriting_mentions() {
        let mut without_mentions = json!({ "msgtype": "m.text", "body": "hello" });
        ensure_empty_mentions(&mut without_mentions);
        assert_eq!(without_mentions["m.mentions"], json!({}));

        let mut with_mentions = json!({ "m.mentions": { "room": true } });
        ensure_empty_mentions(&mut with_mentions);
        assert_eq!(with_mentions["m.mentions"], json!({ "room": true }));
    }

    #[test]
    fn a_room_with_personas_off_round_trips_as_false() {
        let content = json!({
            "associations": {
                "!off:example.org": false,
                "!kris:example.org": { "profileId": "kris", "validUntil": 20 },
            }
        });

        let rooms = room_associations(&content);

        assert!(matches!(
            rooms.get("!off:example.org"),
            Some(RoomAssociation::Disabled)
        ));
        assert!(matches!(
            rooms.get("!kris:example.org"),
            Some(RoomAssociation::Persona(selection))
                if selection.persona_id == "kris" && selection.valid_until == Some(20)
        ));
        assert_eq!(
            serde_json::to_value(RoomAssociationsOut {
                associations: &rooms
            })
            .expect("serializable"),
            json!({
                "associations": {
                    "!off:example.org": false,
                    "!kris:example.org": { "profileId": "kris", "validUntil": 20 },
                }
            })
        );
    }

    #[test]
    fn reads_a_v3_persona_with_its_triggers() {
        let persona = persona(&json!({
            "id": "kris",
            "displayname": "Kris",
            "avatar_url": "mxc://example.org/kris",
            "io.fsky.nyx.pronouns": [{ "summary": "they/them", "language": "EN" }],
            "eu.she-a.color": { "on_light": "#333", "on_dark": "#eee" },
            "triggers": [
                { "prefix": "k:" },
                { "suffix": "-k", "keep_trigger": true },
                { "prefix": "", "suffix": "" }
            ],
        }));

        assert_eq!(persona.display_name, "Kris");
        assert_eq!(
            persona.pronouns,
            vec![PronounView {
                summary: "they/them".to_owned(),
                language: Some("en".to_owned()),
            }]
        );
        assert_eq!(persona.color_on_dark.as_deref(), Some("#eee"));
        assert_eq!(persona.triggers.len(), 2);
        assert!(persona.triggers[1].keep_trigger);
    }

    #[test]
    fn a_persona_writes_only_what_it_has_and_reads_back_unchanged() {
        let written = json!({
            "id": "kris",
            "displayname": "Kris",
            "io.fsky.nyx.pronouns": [{ "summary": "they/them", "language": "en" }],
            "eu.she-a.color": { "on_dark": "#eee" },
            "net.f0rest.pkimport": { "id": "abcde" },
            "triggers": [{ "prefix": "k:" }, { "suffix": "-k", "keep_trigger": true }],
            "net.f0rest.last_used": 7,
        });
        let persona = persona(&written);

        let out = serde_json::to_value(super::PersonaOut::from(&persona)).expect("serializable");

        assert_eq!(out, written);
    }

    #[test]
    fn converts_a_v2_trigger_object_circumfixes_first() {
        let persona = persona(&json!({
            "id": "kris",
            "displayname": "Kris",
            "trigger": {
                "prefix": ["k:"],
                "net.f0rest.suffix": ["-k"],
                "net.f0rest.circumfix": [{ "prefix": "[", "suffix": "]" }],
            },
        }));

        let shapes: Vec<_> = persona
            .triggers
            .iter()
            .map(|trigger| (trigger.prefix.as_deref(), trigger.suffix.as_deref()))
            .collect();
        assert_eq!(
            shapes,
            vec![
                (Some("["), Some("]")),
                (Some("k:"), None),
                (None, Some("-k")),
            ]
        );
    }

    #[test]
    fn reads_the_catalog_through_v1s_nested_wrapper() {
        let nested = json!({
            "type": "m.per_message_profiles",
            "content": { "profiles": [{ "id": "kris", "displayname": "Kris" }] },
        });
        assert_eq!(personas_from_catalog(&nested).len(), 1);
    }

    #[test]
    fn a_repeated_id_keeps_its_first_entry() {
        let catalog = json!({
            "profiles": [
                { "id": "kris", "displayname": "Kris" },
                { "id": "sam", "displayname": "Sam" },
                { "id": "kris", "displayname": "Other Kris" },
            ],
        });
        let names: Vec<_> = personas_from_catalog(&catalog)
            .into_iter()
            .map(|persona| persona.display_name)
            .collect();
        assert_eq!(names, vec!["Kris", "Sam"]);
    }

    #[test]
    fn a_message_opening_with_a_bullet_is_not_an_edit() {
        let (body, formatted, _) = outgoing_with_fallback(
            "* one\n* two".to_owned(),
            Some("<ul><li>one</li><li>two</li></ul>".to_owned()),
            &profile("Kris", true),
        );

        assert_eq!(body, "Kris: * one\n* two");
        assert_eq!(
            formatted.as_deref(),
            Some(
                "<strong data-mx-profile-fallback>Kris: </strong><ul><li>one</li><li>two</li></ul>"
            )
        );
    }

    #[test]
    fn an_edit_keeps_its_marker_ahead_of_the_prefix() {
        let mut content = json!({
            "msgtype": "m.text",
            "body": "* * one",
            "format": "org.matrix.custom.html",
            "formatted_body": "* <ul><li>one</li></ul>",
            "m.new_content": {
                "msgtype": "m.text",
                "body": "* one",
                "format": "org.matrix.custom.html",
                "formatted_body": "<ul><li>one</li></ul>",
            },
        });
        let persona = profile("Kris", true);
        stamp_profile(&mut content, &persona);
        stamp_profile(&mut content["m.new_content"], &persona);

        assert_eq!(content["body"], "* Kris: * one");
        assert_eq!(
            content["formatted_body"],
            "* <strong data-mx-profile-fallback>Kris: </strong><ul><li>one</li></ul>"
        );
        assert_eq!(content["m.new_content"]["body"], "Kris: * one");
        assert_eq!(
            content["m.new_content"]["formatted_body"],
            "<strong data-mx-profile-fallback>Kris: </strong><ul><li>one</li></ul>"
        );
    }

    #[test]
    fn the_fallback_prefixes_both_bodies_once() {
        let mut content = json!({ "msgtype": "m.text", "body": "hello" });
        stamp_profile(&mut content, &profile("Kris", true));

        assert_eq!(content["body"], "Kris: hello");
        assert_eq!(content["format"], "org.matrix.custom.html");
        assert_eq!(
            content["formatted_body"],
            "<strong data-mx-profile-fallback>Kris: </strong>hello"
        );

        stamp_profile(&mut content, &profile("Kris", true));
        assert_eq!(content["body"], "Kris: hello");
        assert_eq!(
            content["formatted_body"],
            "<strong data-mx-profile-fallback>Kris: </strong>hello"
        );
    }

    #[test]
    fn a_name_with_markup_is_escaped_in_the_fallback() {
        let mut content = json!({ "msgtype": "m.text", "body": "hi" });
        stamp_profile(&mut content, &profile("<b>Kris</b>", true));

        assert_eq!(
            content["formatted_body"],
            "<strong data-mx-profile-fallback>&lt;b&gt;Kris&lt;/b&gt;: </strong>hi"
        );
    }

    #[test]
    fn without_a_fallback_only_the_profile_is_attached() {
        let mut content = json!({ "msgtype": "m.text", "body": "hello" });
        stamp_profile(&mut content, &profile("Kris", false));

        assert_eq!(content["body"], "hello");
        assert!(content.get("formatted_body").is_none());
        assert_eq!(
            content["com.beeper.per_message_profile"]["displayname"],
            "Kris"
        );
        assert!(
            content["com.beeper.per_message_profile"]
                .get("has_fallback")
                .is_none()
        );
    }

    #[test]
    fn a_nameless_profile_does_not_claim_a_fallback_it_cannot_write() {
        let mut nameless = profile("Kris", true);
        nameless.display_name = None;

        let mut content = json!({ "msgtype": "m.text", "body": "hello" });
        stamp_profile(&mut content, &nameless);

        assert_eq!(content["body"], "hello");
        assert!(
            content["com.beeper.per_message_profile"]
                .get("has_fallback")
                .is_none()
        );
        assert!(fallback_body("hello", None, &nameless, false).is_none());
    }

    #[test]
    fn an_outgoing_message_carries_the_fallback_it_advertises() {
        let (body, formatted, profile) =
            outgoing_with_fallback("hello".to_owned(), None, &profile("Kris", true));

        assert_eq!(body, "Kris: hello");
        assert_eq!(
            formatted.as_deref(),
            Some("<strong data-mx-profile-fallback>Kris: </strong>hello")
        );
        assert!(profile.has_fallback);

        let (body, formatted, profile) =
            outgoing_with_fallback("hello".to_owned(), None, &profile_without_name());
        assert_eq!(body, "hello");
        assert!(formatted.is_none());
        assert!(!profile.has_fallback);
    }

    #[test]
    fn oversized_fields_are_clamped_on_a_char_boundary() {
        let mut long = profile(&"é".repeat(200), true);
        long.id = Some("k".repeat(300));

        let stamped = profile_value(&long);
        let name = stamped["displayname"].as_str().expect("a display name");

        assert!(name.len() <= 255);
        assert_eq!(name.chars().count(), 127);
        assert_eq!(stamped["id"].as_str().expect("an id").len(), 255);
    }

    #[test]
    fn a_null_byte_never_reaches_the_wire() {
        let profile = profile("Kr\0is", true);
        let stamped = profile_value(&profile);

        assert_eq!(stamped["displayname"], "Kris");
    }

    fn profile_without_name() -> PerMessageProfileView {
        PerMessageProfileView {
            display_name: None,
            ..profile("Kris", true)
        }
    }
}
