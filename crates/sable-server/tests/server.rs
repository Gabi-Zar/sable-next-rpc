use std::{net::SocketAddr, time::Duration};

use axum_client_ip::ClientIpSource;
use futures_util::{SinkExt, StreamExt};
use sable_server::{Server, config::Config};
use serde_json::{Value, json};
use tempfile::tempdir;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

async fn start_server() -> (String, Server, tokio::task::JoinHandle<()>) {
    start_server_with_ip_source(ClientIpSource::ConnectInfo).await
}

async fn start_server_with_ip_source(
    client_ip_source: ClientIpSource,
) -> (String, Server, tokio::task::JoinHandle<()>) {
    let data_dir = tempdir().expect("temporary server directory");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("test listener address");
    let config = Config {
        listen_addr: "127.0.0.1:0".to_owned(),
        public_url: format!("http://{address}"),
        client_ip_source,
        data_dir: data_dir.keep(),
        username: "test".to_owned(),
        password_hash: "$argon2id$v=19$m=19456,t=2,p=1$P+eI2tfGQ1sd90QtbQ8wFA$Obgt2lytjJYQTynFGGi4Lu+2hlyyipgjDot5QXzqxjs".to_owned(),
        frontend_dir: "missing-frontend".into(),
    };
    let server = Server::new(config).expect("server");
    let app_server = server.clone();
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            app_server
                .app()
                .into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("test server");
    });
    (format!("http://{address}"), server, task)
}

async fn cookie(base: &str) -> String {
    let response = reqwest::Client::new()
        .post(format!("{base}/_sable/auth"))
        .basic_auth("test", Some("password"))
        .send()
        .await
        .expect("auth request");
    assert_eq!(response.status(), reqwest::StatusCode::NO_CONTENT);
    response
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .expect("auth cookie")
        .to_str()
        .expect("cookie header")
        .split(';')
        .next()
        .expect("cookie value")
        .to_owned()
}

async fn connect(
    base: &str,
    cookie: &str,
    query: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let url = format!("{base}/_sable/ws{query}").replace("http://", "ws://");
    let mut request = url.into_client_request().expect("websocket request");
    request
        .headers_mut()
        .insert("Cookie", cookie.parse().expect("cookie header"));
    request
        .headers_mut()
        .insert("Origin", base.parse().expect("origin header"));
    connect_async(request)
        .await
        .expect("authenticated websocket")
        .0
}

async fn receive_json(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .expect("websocket message timeout")
        .expect("websocket closed")
        .expect("websocket error");
    let Message::Text(text) = message else {
        panic!("expected a text websocket message")
    };
    serde_json::from_str(&text).expect("JSON websocket message")
}

async fn connect_compressed(base: &str, cookie: &str) -> yawc::TcpWebSocket {
    let url = format!("{base}/_sable/ws").replace("http://", "ws://");
    yawc::WebSocket::connect(url.parse().expect("websocket URL"))
        .with_request(
            yawc::HttpRequestBuilder::new()
                .header("Cookie", cookie)
                .header("Origin", base),
        )
        .with_options(yawc::Options::default().with_balanced_compression())
        .await
        .expect("compressed websocket")
}

async fn receive_yawc_json(socket: &mut yawc::TcpWebSocket) -> Value {
    let frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .expect("websocket message timeout")
        .expect("websocket closed");
    if frame.opcode() != yawc::OpCode::Text {
        panic!("expected a text websocket message")
    };
    serde_json::from_slice(frame.payload()).expect("JSON websocket message")
}

#[tokio::test]
async fn authenticates_with_basic_credentials_and_rejects_bad_credentials() {
    let (base, _server, task) = start_server().await;
    let client = reqwest::Client::new();
    let bad = client
        .post(format!("{base}/_sable/auth"))
        .basic_auth("test", Some("wrong"))
        .send()
        .await
        .expect("bad auth");
    assert_eq!(bad.status(), reqwest::StatusCode::UNAUTHORIZED);
    let good = client
        .post(format!("{base}/_sable/auth"))
        .basic_auth("test", Some("password"))
        .send()
        .await
        .expect("good auth");
    assert_eq!(good.status(), reqwest::StatusCode::NO_CONTENT);
    assert!(good.headers().contains_key(reqwest::header::SET_COOKIE));
    task.abort();
}

#[tokio::test]
async fn rate_limits_repeated_bad_credentials() {
    let (base, _server, task) =
        start_server_with_ip_source(ClientIpSource::RightmostXForwardedFor).await;
    let client = reqwest::Client::new();
    for _ in 0..5 {
        let response = client
            .post(format!("{base}/_sable/auth"))
            .header("X-Forwarded-For", "192.0.2.10")
            .basic_auth("test", Some("wrong"))
            .send()
            .await
            .expect("bad auth");
        assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    }
    let response = client
        .post(format!("{base}/_sable/auth"))
        .header("X-Forwarded-For", "192.0.2.10")
        .basic_auth("test", Some("password"))
        .send()
        .await
        .expect("limited auth");
    assert_eq!(response.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
    let response = client
        .post(format!("{base}/_sable/auth"))
        .header("X-Forwarded-For", "192.0.2.11")
        .basic_auth("test", Some("password"))
        .send()
        .await
        .expect("different client auth");
    assert_eq!(response.status(), reqwest::StatusCode::NO_CONTENT);
    task.abort();
}

#[tokio::test]
async fn login_sets_a_secure_cookie_and_logout_destroys_the_session() {
    let (base, _server, task) = start_server().await;
    let client = reqwest::Client::new();
    let login = client
        .post(format!("{base}/_sable/auth"))
        .basic_auth("test", Some("password"))
        .send()
        .await
        .expect("auth");
    assert_eq!(login.status(), reqwest::StatusCode::NO_CONTENT);
    let cookie_header = login
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .expect("auth cookie")
        .to_str()
        .expect("cookie header")
        .to_owned();
    assert!(login.bytes().await.expect("response body").is_empty());
    assert!(cookie_header.starts_with("__Host-sable_auth="));
    assert!(cookie_header.contains("HttpOnly"));
    assert!(cookie_header.contains("Secure"));
    assert!(cookie_header.contains("SameSite=Strict"));
    assert!(cookie_header.contains("Path=/"));
    let cookie = cookie(&base).await;
    let status = client
        .get(format!("{base}/_sable/auth"))
        .header(reqwest::header::COOKIE, &cookie)
        .send()
        .await
        .expect("auth status");
    assert_eq!(status.status(), reqwest::StatusCode::NO_CONTENT);
    let relogin = client
        .post(format!("{base}/_sable/auth"))
        .header(reqwest::header::COOKIE, &cookie)
        .header(reqwest::header::ORIGIN, &base)
        .basic_auth("test", Some("password"))
        .send()
        .await
        .expect("relogin");
    assert_eq!(relogin.status(), reqwest::StatusCode::NO_CONTENT);
    let rotated_cookie = relogin
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .expect("rotated auth cookie")
        .to_str()
        .expect("rotated cookie header")
        .split(';')
        .next()
        .expect("rotated cookie value")
        .to_owned();
    assert_ne!(cookie, rotated_cookie);
    let old_status = client
        .get(format!("{base}/_sable/auth"))
        .header(reqwest::header::COOKIE, &cookie)
        .send()
        .await
        .expect("old auth status");
    assert_eq!(old_status.status(), reqwest::StatusCode::UNAUTHORIZED);
    let status = client
        .get(format!("{base}/_sable/auth"))
        .header(reqwest::header::COOKIE, &rotated_cookie)
        .send()
        .await
        .expect("rotated auth status");
    assert_eq!(status.status(), reqwest::StatusCode::NO_CONTENT);
    let logout = client
        .post(format!("{base}/_sable/logout"))
        .header(reqwest::header::COOKIE, &rotated_cookie)
        .header(reqwest::header::ORIGIN, &base)
        .send()
        .await
        .expect("logout");
    assert_eq!(logout.status(), reqwest::StatusCode::NO_CONTENT);
    let status = client
        .get(format!("{base}/_sable/auth"))
        .header(reqwest::header::COOKIE, &rotated_cookie)
        .send()
        .await
        .expect("revoked auth status");
    assert_eq!(status.status(), reqwest::StatusCode::UNAUTHORIZED);
    task.abort();
}

#[tokio::test]
async fn every_response_has_security_headers_and_missing_index_is_not_not_modified() {
    let (base, _server, task) = start_server().await;
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{base}/healthz"))
        .send()
        .await
        .expect("health");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(response.headers()["x-frame-options"], "DENY");
    assert_eq!(
        response.headers()["referrer-policy"],
        "strict-origin-when-cross-origin"
    );
    let missing = client
        .get(format!("{base}/missing.js"))
        .header(reqwest::header::IF_NONE_MATCH, "\"stale\"")
        .send()
        .await
        .expect("missing asset");
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
    task.abort();
}

#[tokio::test]
async fn rejects_unauthenticated_and_cross_origin_websockets() {
    let (base, _server, task) = start_server().await;
    assert!(
        connect_async(format!("{base}/_sable/ws").replace("http://", "ws://"))
            .await
            .is_err()
    );
    let cookie = cookie(&base).await;
    let url = format!("{base}/_sable/ws").replace("http://", "ws://");
    let mut request = url.into_client_request().expect("request");
    request
        .headers_mut()
        .insert("Cookie", cookie.parse().expect("cookie"));
    request
        .headers_mut()
        .insert("Origin", "https://evil.example".parse().expect("origin"));
    assert!(connect_async(request).await.is_err());
    task.abort();
}

#[tokio::test]
async fn calls_core_and_broadcasts_sequence_numbered_events() {
    let (base, server, task) = start_server().await;
    let cookie = cookie(&base).await;
    let mut first = connect(&base, &cookie, "").await;
    let mut second = connect(&base, &cookie, "").await;
    let hello = receive_json(&mut first).await;
    assert_eq!(hello["server"]["version"], "0.1.0");
    assert!(hello["server"]["run_id"].is_string());
    assert!(receive_json(&mut second).await["server"].is_object());
    first
        .send(Message::Text(
            json!({"id": 7, "method": "session.list_accounts", "params": {}})
                .to_string()
                .into(),
        ))
        .await
        .expect("RPC");
    let reply = receive_json(&mut first).await;
    assert_eq!(reply["id"], 7);
    assert_eq!(reply["ok"], json!([]));
    server
        .core()
        .emit(sable_core::protocol::CoreEvent::SessionEnded {
            reason: "test".to_owned(),
        });
    let event = receive_json(&mut first).await;
    assert_eq!(event["seq"], 1);
    assert_eq!(
        event["event"],
        json!({"type": "session_ended", "reason": "test"})
    );
    assert_eq!(receive_json(&mut second).await["seq"], 1);
    task.abort();
}

#[tokio::test]
async fn negotiates_permessage_deflate_and_decodes_text_messages() {
    let (base, _server, task) = start_server().await;
    let cookie = cookie(&base).await;
    let mut socket = connect_compressed(&base, &cookie).await;
    assert!(receive_yawc_json(&mut socket).await["server"].is_object());
    socket
        .send(yawc::Frame::text(
            json!({"id": 9, "method": "session.list_accounts", "params": {}}).to_string(),
        ))
        .await
        .expect("RPC");
    let reply = receive_yawc_json(&mut socket).await;
    assert_eq!(reply["id"], 9);
    assert_eq!(reply["ok"], json!([]));
    task.abort();
}

#[tokio::test]
async fn replays_events_and_resets_when_the_run_or_buffer_is_not_available() {
    let (base, server, task) = start_server().await;
    let cookie = cookie(&base).await;
    let mut socket = connect(&base, &cookie, "").await;
    let run_id = receive_json(&mut socket).await["server"]["run_id"]
        .as_str()
        .expect("run id")
        .to_owned();
    server
        .core()
        .emit(sable_core::protocol::CoreEvent::SessionEnded {
            reason: "replay".to_owned(),
        });
    assert_eq!(receive_json(&mut socket).await["seq"], 1);
    drop(socket);
    server
        .core()
        .emit(sable_core::protocol::CoreEvent::SessionEnded {
            reason: "missed".to_owned(),
        });
    let query = format!("?run_id={run_id}&last_received_event=1");
    let mut resumed = connect(&base, &cookie, &query).await;
    assert_eq!(receive_json(&mut resumed).await["server"]["run_id"], run_id);
    assert_eq!(
        receive_json(&mut resumed).await["event"]["reason"],
        "missed"
    );
    let mut reset = connect(&base, &cookie, "?run_id=old&last_received_event=1").await;
    assert!(receive_json(&mut reset).await["server"].is_object());
    assert_eq!(receive_json(&mut reset).await["reset"], true);
    task.abort();
}

#[tokio::test]
async fn protected_media_and_upload_routes_require_the_cookie() {
    let (base, _server, task) = start_server().await;
    let client = reqwest::Client::new();
    let unknown = client
        .get(format!("{base}/_sable/not-a-route"))
        .send()
        .await
        .expect("unknown protected route");
    assert_eq!(unknown.status(), reqwest::StatusCode::UNAUTHORIZED);
    let media = client
        .get(format!("{base}/_sable/media/example.org/id"))
        .send()
        .await
        .expect("media request");
    assert_eq!(media.status(), reqwest::StatusCode::UNAUTHORIZED);
    let upload = client
        .post(format!("{base}/_sable/upload"))
        .body("data")
        .send()
        .await
        .expect("upload request");
    assert_eq!(upload.status(), reqwest::StatusCode::UNAUTHORIZED);
    task.abort();
}
