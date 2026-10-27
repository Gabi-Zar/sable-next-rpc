#![recursion_limit = "256"]
#![expect(clippy::missing_errors_doc, reason = "errors are the returned types")]

mod auth;
pub mod config;

use std::{
    collections::VecDeque,
    io::{IsTerminal, Read},
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    Router,
    body::{Body, Bytes},
    extract::{FromRequestParts, Path as AxumPath, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use axum_client_ip::{ClientIp, ClientIpSource};
use axum_extra::{
    TypedHeader,
    headers::authorization::{Authorization, Basic},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use clap::{Parser, Subcommand};
use futures_util::{SinkExt, StreamExt};
use sable_core::{Core, protocol::RpcError, store::ExclusiveFileSessionStore};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, value::RawValue};
use tokio::sync::{Mutex, Semaphore, broadcast, mpsc};
use tower::limit::ConcurrencyLimitLayer;
use tower_governor::{
    GovernorError, GovernorLayer, governor::GovernorConfigBuilder, key_extractor::KeyExtractor,
};
use tower_http::{
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    set_header::response::SetResponseHeaderLayer,
};
use tower_sessions::{Expiry, MemoryStore, Session, SessionManagerLayer, cookie::SameSite};

use crate::{
    auth::{Auth, logout as destroy_session},
    config::Config,
};

const EVENT_BUFFER: usize = 256;
const OUTGOING_BUFFER: usize = 128;
const PING_INTERVAL: Duration = Duration::from_secs(20);
const PING_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_UPLOAD_SIZE: usize = 100 * 1024 * 1024;
const MAX_WEBSOCKET_MESSAGE_SIZE: usize = 1024 * 1024;
const MAX_CONNECTIONS: usize = 256;
const MAX_RPC_TASKS: usize = 128;

#[derive(Clone)]
pub struct Server {
    core: Arc<Core>,
    auth: Arc<Auth>,
    events: broadcast::Sender<Arc<EventRecord>>,
    buffer: Arc<Mutex<EventBuffer>>,
    run_id: Arc<str>,
    version: Arc<str>,
    frontend: Arc<Frontend>,
    public_url: Arc<str>,
    client_ip_source: ClientIpSource,
    sessions: MemoryStore,
    connections: Arc<Semaphore>,
    rpc_tasks: Arc<Semaphore>,
}

#[derive(Serialize)]
struct EventEnvelope<'a> {
    seq: u64,
    run_id: &'a str,
    event: &'a sable_core::protocol::CoreEvent,
}

struct EventRecord {
    sequence: u64,
    message: Arc<str>,
}

struct EventBuffer {
    next_sequence: u64,
    records: VecDeque<Arc<EventRecord>>,
}

struct Frontend {
    directory: PathBuf,
}

impl Server {
    pub fn new(config: Config) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let data_dir = config.data_dir.clone();
        std::fs::create_dir_all(&data_dir)?;
        let (core, mut core_events) = Core::new(
            data_dir.to_string_lossy().into_owned(),
            Box::new(ExclusiveFileSessionStore::new(data_dir)),
        );
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        let server = Self {
            core,
            auth: Arc::new(Auth::new(
                Arc::<str>::from(config.username),
                Arc::<str>::from(config.password_hash),
            )?),
            events,
            buffer: Arc::new(Mutex::new(EventBuffer {
                next_sequence: 1,
                records: VecDeque::with_capacity(EVENT_BUFFER),
            })),
            run_id: Arc::from(uuid::Uuid::new_v4().to_string()),
            version: Arc::from(env!("CARGO_PKG_VERSION")),
            frontend: Arc::new(Frontend::load(config.frontend_dir)),
            public_url: Arc::from(config.public_url),
            client_ip_source: config.client_ip_source,
            sessions: MemoryStore::default(),
            connections: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
            rpc_tasks: Arc::new(Semaphore::new(MAX_RPC_TASKS)),
        };
        let publisher = server.clone();
        tokio::spawn(async move {
            while let Some(event) = core_events.recv().await {
                publisher.publish_event(event).await;
            }
        });
        Ok(server)
    }

    pub fn app(&self) -> Router {
        let mut rate_limit = GovernorConfigBuilder::default();
        rate_limit
            .per_second(1)
            .burst_size(5)
            .methods(vec![Method::POST]);
        let rate_limit = rate_limit
            .key_extractor(ClientIpKeyExtractor)
            .finish()
            .unwrap_or_else(|| unreachable!("rate limit constants are non-zero"));
        let uploads = Router::new()
            .route("/_sable/upload", post(upload))
            .route("/_sable/send-attachment", post(send_attachment))
            .route("/_sable/send-gallery", post(send_gallery))
            .layer(ConcurrencyLimitLayer::new(4));
        let protected = Router::new()
            .route("/_sable/ws", get(websocket))
            .route("/_sable/logout", post(logout))
            .route("/_sable/media/{server}/{media_id}", get(media))
            .route("/_sable/media/forget", post(forget_media))
            .merge(uploads);
        let static_files = ServeDir::new(self.frontend.directory.clone())
            .precompressed_gzip()
            .precompressed_br()
            .precompressed_deflate()
            .precompressed_zstd()
            .fallback(ServeFile::new(self.frontend.directory.join("index.html")));
        Router::new()
            .route("/healthz", get(health))
            .route(
                "/_sable/auth",
                get(auth_status)
                    .post(authenticate)
                    .layer(GovernorLayer::new(rate_limit))
                    .layer(middleware::from_fn(extract_client_ip)),
            )
            .merge(protected)
            .fallback_service(static_files)
            .layer(RequestBodyLimitLayer::new(MAX_UPLOAD_SIZE))
            .layer(axum::extract::DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
            .layer(SetResponseHeaderLayer::overriding(
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            ))
            .layer(SetResponseHeaderLayer::overriding(
                header::X_FRAME_OPTIONS,
                HeaderValue::from_static("DENY"),
            ))
            .layer(SetResponseHeaderLayer::overriding(
                header::REFERRER_POLICY,
                HeaderValue::from_static("strict-origin-when-cross-origin"),
            ))
            .layer(middleware::from_fn_with_state(
                self.clone(),
                auth_middleware,
            ))
            .layer(
                SessionManagerLayer::new(self.sessions.clone())
                    .with_name("__Host-sable_auth")
                    .with_http_only(true)
                    .with_secure(true)
                    .with_same_site(SameSite::Strict)
                    .with_path("/")
                    .with_expiry(Expiry::OnInactivity(time::Duration::minutes(30)))
                    .with_always_save(true),
            )
            .layer(self.client_ip_source.clone().into_extension())
            .with_state(self.clone())
    }

    #[must_use]
    pub const fn core(&self) -> &Arc<Core> {
        &self.core
    }

    async fn publish_event(&self, event: sable_core::protocol::CoreEvent) {
        let mut buffer = self.buffer.lock().await;
        let sequence = buffer.next_sequence;
        let Ok(message) = serde_json::to_string(&EventEnvelope {
            seq: sequence,
            run_id: &self.run_id,
            event: &event,
        }) else {
            tracing::warn!("dropping an unserializable core event");
            return;
        };
        buffer.next_sequence = sequence.saturating_add(1);
        let record = Arc::new(EventRecord {
            sequence,
            message: Arc::from(message),
        });
        if buffer.records.len() == EVENT_BUFFER {
            buffer.records.pop_front();
        }
        buffer.records.push_back(record.clone());
        let _ = self.events.send(record);
    }

    async fn resume_and_subscribe(
        &self,
        run_id: Option<&str>,
        last: Option<u64>,
    ) -> (
        broadcast::Receiver<Arc<EventRecord>>,
        Vec<Arc<EventRecord>>,
        bool,
    ) {
        let buffer = self.buffer.lock().await;
        let receiver = self.events.subscribe();
        let Some(last) = last else {
            return (receiver, Vec::new(), false);
        };
        if run_id != Some(&self.run_id) {
            return (receiver, Vec::new(), true);
        }
        let Some(first) = buffer.records.front().map(|event| event.sequence) else {
            return (receiver, Vec::new(), false);
        };
        if last.saturating_add(1) < first {
            return (receiver, Vec::new(), true);
        }
        (
            receiver,
            buffer
                .records
                .iter()
                .filter(|event| event.sequence > last)
                .cloned()
                .collect(),
            false,
        )
    }
}

impl Frontend {
    const fn load(directory: PathBuf) -> Self {
        Self { directory }
    }
}

#[derive(Deserialize)]
struct Request {
    #[serde(default)]
    id: Value,
    method: Option<String>,
    #[serde(default = "empty_params")]
    params: Value,
}

fn empty_params() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Serialize)]
#[serde(untagged)]
enum Reply {
    Ok { id: Value, ok: Box<RawValue> },
    Error { id: Value, error: RpcError },
}

#[derive(Serialize)]
struct ServerMessage<'a> {
    server: ServerInfo<'a>,
}

#[derive(Serialize)]
struct ServerInfo<'a> {
    version: &'a str,
    run_id: &'a str,
}

#[derive(Deserialize)]
struct ResumeQuery {
    run_id: Option<String>,
    last_received_event: Option<u64>,
}

#[derive(Deserialize)]
struct MediaQuery {
    width: Option<u32>,
    height: Option<u32>,
    background: Option<bool>,
    source: Option<String>,
    inline: Option<bool>,
}

async fn health() -> &'static str {
    "ok"
}

async fn auth_status(State(server): State<Server>, session: Session) -> Response {
    if server.auth.authenticate(&session).await {
        StatusCode::NO_CONTENT.into_response()
    } else {
        unauthorized().into_response()
    }
}

async fn authenticate(
    State(server): State<Server>,
    session: Session,
    credentials: Option<TypedHeader<Authorization<Basic>>>,
) -> Response {
    if !server
        .auth
        .check_basic(credentials.as_ref().map(|TypedHeader(value)| value))
        .await
    {
        let mut response = StatusCode::UNAUTHORIZED.into_response();
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Basic realm=\"Sable\", charset=\"UTF-8\""),
        );
        return response;
    }
    if server.auth.login(&session).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn logout(session: Session) -> Response {
    if destroy_session(&session).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn auth_middleware(
    State(server): State<Server>,
    request: axum::http::Request<Body>,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if !path.starts_with("/_sable/") && path != "/_sable" {
        return next.run(request).await;
    }
    let authenticated = if let Some(session) = request.extensions().get::<Session>().cloned() {
        server.auth.authenticate(&session).await
    } else {
        false
    };
    if path == "/_sable/auth" {
        if request.method() != Method::GET
            && request.method() != Method::HEAD
            && request.headers().contains_key(header::COOKIE)
            && !same_origin(request.headers(), &server.public_url)
        {
            return StatusCode::FORBIDDEN.into_response();
        }
        return next.run(request).await;
    }
    if !authenticated {
        return unauthorized().into_response();
    }
    let state_change = request.method() != Method::GET && request.method() != Method::HEAD;
    let websocket = path == "/_sable/ws";
    if (state_change || websocket) && !same_origin(request.headers(), &server.public_url) {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}

fn same_origin(headers: &HeaderMap, public_url: &str) -> bool {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|origin| origin == public_url)
}

#[derive(Clone, Copy)]
struct ClientIpKeyExtractor;

impl KeyExtractor for ClientIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, request: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        request
            .extensions()
            .get::<ClientIp>()
            .map(|ClientIp(ip)| *ip)
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

fn unauthorized() -> Response {
    StatusCode::UNAUTHORIZED.into_response()
}

async fn extract_client_ip(request: axum::http::Request<Body>, next: Next) -> Response {
    let (mut parts, body) = request.into_parts();
    let Ok(client_ip) = ClientIp::from_request_parts(&mut parts, &()).await else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    parts.extensions.insert(client_ip);
    next.run(axum::http::Request::from_parts(parts, body)).await
}

async fn websocket(
    State(server): State<Server>,
    Query(query): Query<ResumeQuery>,
    upgrade: yawc::IncomingUpgrade,
) -> Response {
    let Some(connection) = server.connections.clone().try_acquire_owned().ok() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let options = yawc::Options::default()
        .with_balanced_compression()
        .with_limits(MAX_WEBSOCKET_MESSAGE_SIZE, MAX_WEBSOCKET_MESSAGE_SIZE)
        .with_utf8();
    let Ok((response, upgrade)) = upgrade.upgrade(options) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    tokio::spawn(async move {
        if let Ok(socket) = upgrade.await {
            handle_socket(socket, server, query, connection).await;
        }
    });
    response.into_response()
}

async fn handle_socket(
    socket: yawc::HttpWebSocket,
    server: Server,
    query: ResumeQuery,
    _connection: tokio::sync::OwnedSemaphorePermit,
) {
    let (sink, mut stream) = socket.split();
    let (outgoing, messages) = mpsc::channel(OUTGOING_BUFFER);
    let writer = tokio::spawn(write_socket(sink, messages));
    let Some(mut receiver) = greet(&server, &query, &outgoing).await else {
        return;
    };
    let mut ping = tokio::time::interval(PING_INTERVAL);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ping.tick().await;
    let mut last_received = Instant::now();
    loop {
        tokio::select! {
            message = stream.next() => {
                let Some(message) = message else { break };
                match message.opcode() {
                    yawc::OpCode::Text => {
                        last_received = Instant::now();
                        let Ok(text) = std::str::from_utf8(message.payload()) else {
                            break;
                        };
                        let Ok(request) = serde_json::from_str::<Request>(text) else {
                            let reply = Reply::Error {
                                id: Value::Null,
                                error: RpcError::Failed {
                                    log_id: "invalid websocket request".to_owned(),
                                },
                            };
                            if !send_reply(&outgoing, reply).await {
                                break;
                            }
                            continue;
                        };
                        spawn_rpc(&server, request, &outgoing);
                    }
                    yawc::OpCode::Ping | yawc::OpCode::Pong => last_received = Instant::now(),
                    yawc::OpCode::Close => break,
                    yawc::OpCode::Binary | yawc::OpCode::Continuation => {}
                }
            }
            event = receiver.recv() => {
                match event {
                    Ok(event) => {
                        if !send_text(&outgoing, &event.message).await {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        send_text(&outgoing, r#"{"reset":true}"#).await;
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = ping.tick() => {
                if last_received.elapsed() > PING_TIMEOUT
                    || outgoing
                        .send(yawc::Frame::ping(Bytes::new()))
                        .await
                        .is_err()
                {
                    break;
                }
            }
        }
    }
    drop(outgoing);
    let _ = writer.await;
}

fn spawn_rpc(server: &Server, request: Request, outgoing: &mpsc::Sender<yawc::Frame>) {
    let Some(permit) = server.rpc_tasks.clone().try_acquire_owned().ok() else {
        let reply = Reply::Error {
            id: request.id,
            error: RpcError::RateLimited {
                retry_after_ms: Some(100),
            },
        };
        if let Ok(message) = serde_json::to_string(&reply) {
            let _ = outgoing.try_send(yawc::Frame::text(message));
        }
        return;
    };
    let core = server.core.clone();
    let outgoing = outgoing.clone();
    tokio::spawn(async move {
        let _permit = permit;
        let reply = if let Some(method) = request.method {
            let Ok(params) = serde_json::to_string(&request.params) else {
                send_reply(
                    &outgoing,
                    Reply::Error {
                        id: request.id,
                        error: RpcError::Failed {
                            log_id: "invalid websocket parameters".to_owned(),
                        },
                    },
                )
                .await;
                return;
            };
            match core.call(&method, &params).await {
                Ok(ok) => Reply::Ok { id: request.id, ok },
                Err(error) => Reply::Error {
                    id: request.id,
                    error,
                },
            }
        } else {
            Reply::Error {
                id: request.id,
                error: RpcError::Unsupported,
            }
        };
        send_reply(&outgoing, reply).await;
    });
}

async fn write_socket(
    mut sink: futures_util::stream::SplitSink<yawc::HttpWebSocket, yawc::Frame>,
    mut messages: mpsc::Receiver<yawc::Frame>,
) {
    while let Some(message) = messages.recv().await {
        if sink.send(message).await.is_err() {
            break;
        }
    }
}

/// Sends the hello and what the client missed, or a reset when the gap is gone.
async fn greet(
    server: &Server,
    query: &ResumeQuery,
    outgoing: &mpsc::Sender<yawc::Frame>,
) -> Option<broadcast::Receiver<Arc<EventRecord>>> {
    let (receiver, replayed, reset) = server
        .resume_and_subscribe(query.run_id.as_deref(), query.last_received_event)
        .await;
    let hello = serde_json::to_string(&ServerMessage {
        server: ServerInfo {
            version: &server.version,
            run_id: &server.run_id,
        },
    })
    .ok()?;
    if !send_text(outgoing, &hello).await {
        return None;
    }
    if reset {
        return send_text(outgoing, r#"{"reset":true}"#)
            .await
            .then_some(receiver);
    }
    for event in replayed {
        if !send_text(outgoing, &event.message).await {
            return None;
        }
    }
    Some(receiver)
}

/// False once the socket's writer is gone.
async fn send_text(outgoing: &mpsc::Sender<yawc::Frame>, text: &str) -> bool {
    outgoing
        .send(yawc::Frame::text(text.to_owned()))
        .await
        .is_ok()
}

async fn send_reply(outgoing: &mpsc::Sender<yawc::Frame>, reply: Reply) -> bool {
    match serde_json::to_string(&reply) {
        Ok(message) => send_text(outgoing, &message).await,
        Err(_) => false,
    }
}

async fn media(
    State(server): State<Server>,
    AxumPath((media_server, media_id)): AxumPath<(String, String)>,
    Query(query): Query<MediaQuery>,
) -> Response {
    let source = query
        .source
        .and_then(|source| URL_SAFE_NO_PAD.decode(source).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| format!("mxc://{media_server}/{media_id}"));
    let bytes = match server
        .core
        .fetch_media(
            source,
            query.width.unwrap_or(0),
            query.height.unwrap_or(0),
            query.background.unwrap_or(false),
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => return rpc_error_response(error),
    };
    let content_type = if query.width.unwrap_or(0) > 0 || query.height.unwrap_or(0) > 0 {
        "image/jpeg"
    } else {
        "application/octet-stream"
    };
    let mut response = (StatusCode::OK, bytes).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    let disposition = if query.inline.unwrap_or(false) && content_type.starts_with("image/") {
        "inline"
    } else {
        "attachment"
    };
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static(disposition),
    );
    response
}

async fn upload(State(server): State<Server>, headers: HeaderMap, body: Bytes) -> Response {
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    match server.core.upload_media(mime, body.into()).await {
        Ok(uri) => (StatusCode::OK, axum::Json(uri)).into_response(),
        Err(error) => rpc_error_response(error),
    }
}

#[derive(Deserialize)]
struct ForgetMediaRequest {
    source: String,
}

async fn forget_media(
    State(server): State<Server>,
    axum::Json(request): axum::Json<ForgetMediaRequest>,
) -> Response {
    match server.core.forget_media(request.source).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => rpc_error_response(error),
    }
}

async fn send_attachment(
    State(server): State<Server>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Ok(request) = decode_carried::<sable_core::protocol::SendAttachmentRequest>(&headers)
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match server.core.send_attachment(request, body.into()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => rpc_error_response(error),
    }
}

async fn send_gallery(State(server): State<Server>, headers: HeaderMap, body: Bytes) -> Response {
    let Ok(request) = decode_carried::<sable_core::protocol::SendGalleryRequest>(&headers) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match server.core.send_gallery(request, body.into()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => rpc_error_response(error),
    }
}

fn decode_carried<T: DeserializeOwned>(headers: &HeaderMap) -> Result<T, ()> {
    let Some(encoded) = headers
        .get("x-sable-request")
        .and_then(|value| value.to_str().ok())
    else {
        return Err(());
    };
    URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| ())
        .and_then(|request| serde_json::from_slice(&request).map_err(|_| ()))
}

fn rpc_error_response(error: RpcError) -> Response {
    (StatusCode::BAD_GATEWAY, axum::Json(error)).into_response()
}

#[derive(Parser)]
#[command(name = "sable-server")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    #[arg(long)]
    config: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Command {
    HashPassword,
}

pub async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    if matches!(cli.command, Some(Command::HashPassword)) {
        use argon2::{Argon2, Params, PasswordHasher, Version};

        let password = if std::io::stdin().is_terminal() {
            rpassword::prompt_password("Password: ")?
        } else {
            let mut password = String::new();
            std::io::stdin().read_to_string(&mut password)?;
            password.trim_end().to_owned()
        };
        let params = Params::new(19_456, 2, 1, None)?;
        let argon2 = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params);
        println!("{}", argon2.hash_password(password.as_bytes())?);
        return Ok(());
    }
    let config = Config::load(cli.config)?;
    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    let server = Server::new(config)?;
    tracing::info!(address = %listener.local_addr()?, "sable server listening");
    axum::serve(
        listener,
        server
            .app()
            .into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let ctrl_c = tokio::signal::ctrl_c();
        let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        else {
            return;
        };
        tokio::select! {
            _ = ctrl_c => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
