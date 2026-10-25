use std::borrow::Cow;

use percent_encoding::percent_decode_str;
use serde::Serialize;

use crate::text::is_space;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MatrixLink {
    User { user_id: String },
    Room { room_id: String },
    Event { room_id: String, event_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct JoinAddress {
    pub address: String,
    pub via: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ViaSplit {
    pub href: String,
    pub via: Vec<String>,
}

/// `decodeURIComponent`: a broken escape or invalid UTF-8 refuses the segment.
fn decode_component(segment: &str) -> Option<String> {
    let broken = segment.split('%').skip(1).any(|rest| {
        !rest
            .get(..2)
            .is_some_and(|hex| hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
    });
    if broken {
        return None;
    }
    percent_decode_str(segment)
        .decode_utf8()
        .ok()
        .map(Cow::into_owned)
}

fn decoded_segment(segments: &[&str], index: usize) -> Option<String> {
    segments
        .get(index)
        .filter(|segment| !segment.is_empty())
        .and_then(|segment| decode_component(segment))
}

/// The path of a `matrix:` URI, without its query or fragment.
fn parse_path(path: &str) -> Option<MatrixLink> {
    // The authority is reserved, not a routing server. Empty authorities are valid too.
    let path = if let Some(rest) = path.strip_prefix("//") {
        rest.split_once('/')?.1
    } else {
        path
    };
    let segments: Vec<&str> = path.split('/').collect();
    let kind = *segments.first()?;
    let id = decoded_segment(&segments, 1)?;

    if (kind == "u" || kind == "user") && segments.len() == 2 {
        return Some(MatrixLink::User {
            user_id: format!("@{id}"),
        });
    }
    let sigil = match kind {
        "r" | "room" => '#',
        "roomid" => '!',
        _ => return None,
    };
    let room_id = format!("{sigil}{id}");
    if segments.len() == 2 {
        return Some(MatrixLink::Room { room_id });
    }
    let event_kind = *segments.get(2)?;
    let event_id = decoded_segment(&segments, 3)?;
    ((event_kind == "e" || event_kind == "event") && segments.len() == 4).then(|| {
        MatrixLink::Event {
            room_id,
            event_id: format!("${event_id}"),
        }
    })
}

fn strip_scheme<'a>(href: &'a str, scheme: &str) -> Option<&'a str> {
    let head = href.get(..scheme.len())?;
    head.eq_ignore_ascii_case(scheme)
        .then(|| href.get(scheme.len()..))
        .flatten()
}

/// `matrix.to` keeps `?via=` inside the fragment, so the first `?` there starts
/// the query; no Matrix id contains one.
fn parse_matrix_to(href: &str) -> Option<MatrixLink> {
    let rest = strip_scheme(href, "https://")?;
    let (authority, after) = rest.split_at(rest.find(['/', '?', '#']).unwrap_or(rest.len()));
    if !authority.eq_ignore_ascii_case("matrix.to") {
        return None;
    }
    let fragment = after.strip_prefix("/#/")?;
    let path = fragment.split('?').next()?;
    let segments: Vec<&str> = path.split('/').collect();
    let first = decoded_segment(&segments, 0)?;
    if first.starts_with('@') && segments.len() == 1 {
        return Some(MatrixLink::User { user_id: first });
    }
    if !first.starts_with('!') && !first.starts_with('#') {
        return None;
    }
    if segments.len() == 1 {
        return Some(MatrixLink::Room { room_id: first });
    }
    if segments.len() != 2 {
        return None;
    }
    let event_id = decoded_segment(&segments, 1)?;
    event_id.starts_with('$').then_some(MatrixLink::Event {
        room_id: first,
        event_id,
    })
}

#[must_use]
pub fn parse_matrix_link(href: &str) -> Option<MatrixLink> {
    strip_scheme(href, "matrix:").map_or_else(
        || parse_matrix_to(href),
        |rest| parse_path(rest.split(['?', '#']).next().unwrap_or(rest)),
    )
}

/// The servers a link names to route a room through, and the link without them.
#[must_use]
pub fn split_via(href: &str) -> ViaSplit {
    // In matrix: URIs the query precedes the fragment; matrix.to puts it inside.
    let native_uri = strip_scheme(href, "matrix:").is_some();
    let fragment_start = if native_uri { href.find('#') } else { None };
    let (resource, fragment) = href.split_at(fragment_start.unwrap_or(href.len()));
    let after_hash = if native_uri {
        0
    } else {
        resource.find('#').unwrap_or(0)
    };
    let Some(query) = resource
        .get(after_hash..)
        .and_then(|rest| rest.find('?'))
        .map(|offset| after_hash + offset)
    else {
        return ViaSplit {
            href: href.to_owned(),
            via: Vec::new(),
        };
    };
    let mut via: Vec<String> = Vec::new();
    let params = resource.get(query + 1..).unwrap_or_default();
    for (key, value) in form_urlencoded::parse(params.as_bytes()) {
        if key == "via" && !value.is_empty() && !via.iter().any(|seen| *seen == value) {
            via.push(value.into_owned());
        }
    }
    ViaSplit {
        href: format!("{}{fragment}", resource.get(..query).unwrap_or(resource)),
        via,
    }
}

fn is_address_part(part: &str) -> bool {
    !part.is_empty() && !part.chars().any(|c| is_space(c) || c == '?')
}

/// `#alias:server` or `!id`, optionally with a server, as typed.
fn is_room_address(input: &str) -> bool {
    if let Some(alias) = input.strip_prefix('#') {
        return alias
            .split_once(':')
            .is_some_and(|(local, server)| is_address_part(local) && is_address_part(server));
    }
    input
        .strip_prefix('!')
        .is_some_and(|id| match id.split_once(':') {
            Some((local, server)) => is_address_part(local) && is_address_part(server),
            None => is_address_part(id),
        })
}

/// A room address or a link naming a room, with the servers it routes through.
#[must_use]
pub fn parse_join_address(input: &str) -> Option<JoinAddress> {
    let trimmed = input.trim_matches(is_space);
    if trimmed.is_empty() {
        return None;
    }
    if is_room_address(trimmed) {
        return Some(JoinAddress {
            address: trimmed.to_owned(),
            via: Vec::new(),
        });
    }
    let split = split_via(trimmed);
    let address = match parse_matrix_link(&split.href)? {
        MatrixLink::User { .. } => return None,
        MatrixLink::Room { room_id } | MatrixLink::Event { room_id, .. } => room_id,
    };
    Some(JoinAddress {
        address,
        via: split.via,
    })
}

#[cfg(test)]
mod tests {
    use super::{MatrixLink, parse_join_address, parse_matrix_link, split_via};

    #[test]
    fn a_join_address_is_an_id_an_alias_or_a_link_to_a_room() {
        let address =
            |input: &str| parse_join_address(input).map(|found| (found.address, found.via));
        assert_eq!(
            address(" #lobby:example.org "),
            Some(("#lobby:example.org".to_owned(), Vec::new()))
        );
        assert_eq!(address("!abc"), Some(("!abc".to_owned(), Vec::new())));
        assert_eq!(
            address("https://matrix.to/#/!room:example.org?via=a.example"),
            Some(("!room:example.org".to_owned(), vec!["a.example".to_owned()]))
        );
        assert_eq!(address("https://matrix.to/#/@user:example.org"), None);
        assert_eq!(address("#no-server"), None);
        assert_eq!(address(""), None);
    }

    fn user(id: &str) -> MatrixLink {
        MatrixLink::User {
            user_id: id.to_owned(),
        }
    }

    fn room(id: &str) -> MatrixLink {
        MatrixLink::Room {
            room_id: id.to_owned(),
        }
    }

    fn event(room: &str, event: &str) -> MatrixLink {
        MatrixLink::Event {
            room_id: room.to_owned(),
            event_id: event.to_owned(),
        }
    }

    #[test]
    fn parses_both_link_forms() {
        for (href, expected) in [
            ("matrix:u/alice:example.org", user("@alice:example.org")),
            (
                "matrix:roomid/room:example.org/e/event",
                event("!room:example.org", "$event"),
            ),
            (
                "https://matrix.to/#/#lobby:example.org",
                room("#lobby:example.org"),
            ),
            (
                "https://matrix.to/#/!room:example.org/$event",
                event("!room:example.org", "$event"),
            ),
            (
                "https://matrix.to/#/%23lobby%3Aexample.org",
                room("#lobby:example.org"),
            ),
        ] {
            assert_eq!(parse_matrix_link(href), Some(expected), "{href}");
        }
    }

    #[test]
    fn keeps_via_out_of_the_ids() {
        for (href, expected) in [
            (
                "https://matrix.to/#/!somewhere:example.org?via=elsewhere.ca",
                room("!somewhere:example.org"),
            ),
            (
                "https://matrix.to/#/!somewhere:example.org/$event:example.org?via=elsewhere.ca",
                event("!somewhere:example.org", "$event:example.org"),
            ),
            (
                "matrix:roomid/somewhere:example.org/e/event?via=elsewhere.ca",
                event("!somewhere:example.org", "$event"),
            ),
        ] {
            assert_eq!(parse_matrix_link(href), Some(expected), "{href}");
        }
    }

    #[test]
    fn refuses_what_is_not_a_matrix_link() {
        for href in [
            "https://example.org/#/!room:example.org",
            "matrix:u/alice:example.org/e/event",
            "matrix:roomid/room:example.org/e/event/extra",
            "matrix:roomid/room:example.org/x/event",
            "matrix:person/alice:example.org",
            "https://matrix.to/#/",
            "https://matrix.to/#/alice:example.org",
            "https://matrix.to/#/%E0%A4%A",
        ] {
            assert_eq!(parse_matrix_link(href), None, "{href}");
        }
    }

    #[test]
    fn via_is_read_from_the_query_after_the_fragment() {
        let split = split_via(
            "https://matrix.to/#/!room:example.org?via=a.example&via=b.example&via=a.example&via=",
        );
        assert_eq!(split.href, "https://matrix.to/#/!room:example.org");
        assert_eq!(split.via, vec!["a.example", "b.example"]);

        let plain = split_via("#room:example.org");
        assert_eq!(plain.href, "#room:example.org");
        assert_eq!(plain.via, [] as [String; 0]);
    }

    #[test]
    fn matrix_uris_support_reserved_authorities_and_legacy_types() {
        for (href, expected) in [
            ("MATRIX:u/alice:example.org", user("@alice:example.org")),
            ("matrix:user/alice:example.org", user("@alice:example.org")),
            ("matrix:room/lobby:example.org", room("#lobby:example.org")),
            (
                "matrix://reserved.example/u/alice:example.org",
                user("@alice:example.org"),
            ),
            ("matrix:///r/lobby:example.org", room("#lobby:example.org")),
            ("matrix:roomid/opaque", room("!opaque")),
            (
                "matrix:roomid/a%2Fb:example.org/event/c%2Fd",
                event("!a/b:example.org", "$c/d"),
            ),
            (
                "matrix:u/alice:example.org?action=chat#reserved",
                user("@alice:example.org"),
            ),
        ] {
            assert_eq!(parse_matrix_link(href), Some(expected), "{href}");
        }
    }

    #[test]
    fn malformed_uri_paths_are_not_truncated_into_valid_links() {
        for href in [
            "matrix:/u/alice:example.org",
            "matrix:////u/alice:example.org",
            "matrix://reserved.example",
            "matrix:u/",
            "matrix:u/%FF",
            "matrix:u/%ZZ",
            "matrix:u/alice:example.org/",
            "https://matrix.to/#@alice:example.org",
            "https://matrix.to/#/@alice:example.org/extra",
            "https://matrix.to/#/!room:example.org/$event/extra",
            "https://matrix.to/other/#/!room:example.org",
            "https://user@matrix.to/#/!room:example.org",
            "https://matrix.to:8443/#/!room:example.org",
            "http://matrix.to/#/!room:example.org",
        ] {
            assert_eq!(parse_matrix_link(href), None, "{href}");
        }
    }

    #[test]
    fn native_uri_query_precedes_the_reserved_fragment() {
        let split = split_via(
            "MATRIX:roomid/opaque?via=a.example&via=b.example#reserved?via=wrong.example",
        );
        assert_eq!(
            split.href,
            "MATRIX:roomid/opaque#reserved?via=wrong.example"
        );
        assert_eq!(split.via, ["a.example", "b.example"]);
        assert_eq!(parse_matrix_link(&split.href), Some(room("!opaque")));
        assert_eq!(
            split_via("matrix:roomid/opaque#reserved?via=wrong.example").via,
            [] as [std::string::String; 0]
        );
    }
}
