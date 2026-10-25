// interceptor 域：控制通道（WS 服务端）——扩展 MV3 service worker 连入。
// 握手（Origin 校验，无配对码）、心跳保活、名单 / 规则 / 脚本下发、代理端口下发。
// 对齐 Node 版 ws-bridge.ts：只绑回环、只接受本扩展来源、hello 超时断开、心跳掉线检测。
use super::traffic;
use serde_json::{json, Value};

pub type HandlerFn = Arc<dyn Fn(&tauri::AppHandle, &str, Value) + Send + Sync>;
type SiteInfoFn = Arc<dyn Fn(&str) -> Value + Send + Sync>;
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tungstenite::Message;

pub const INTERCEPTOR_EXTENSION_ID: &str = "hlinfcmdeamelkpdemppomgncenalong";
const HELLO_TIMEOUT_MS: u64 = 5_000;
const HEARTBEAT_INTERVAL_MS: u64 = 20_000;
const CONNECTION_STALE_MS: u64 = 65_000;

#[derive(Default)]
struct Handlers {
    targets: Option<Arc<dyn Fn() -> Vec<Value> + Send + Sync>>,
    scripts: Option<Arc<dyn Fn() -> Vec<Value> + Send + Sync>>,
    rules: Option<Arc<dyn Fn() -> Vec<Value> + Send + Sync>>,
    site_info: Option<SiteInfoFn>,
}

struct Connection {
    client_id: String,
    app_id: String,
    version: String,
    connected_at: u64,
    proxy_enabled: bool,
    proxy_error: String,
    socket: Arc<Mutex<tungstenite::WebSocket<std::net::TcpStream>>>,
    last_seen_at: Instant,
    authed: bool,
}

struct BridgeState {
    port: u16,
    connections: HashMap<String, Arc<Mutex<Connection>>>,
}

static STATE: LazyLock<Mutex<Option<BridgeState>>> = LazyLock::new(|| Mutex::new(None));
static GENERATION: AtomicU64 = AtomicU64::new(0);

static HANDLERS: LazyLock<Mutex<Handlers>> = LazyLock::new(|| Mutex::new(Handlers::default()));

fn handler_targets() -> Vec<Value> {
    HANDLERS
        .lock()
        .unwrap()
        .targets
        .as_ref()
        .map(|f| f())
        .unwrap_or_default()
}

fn handler_scripts() -> Vec<Value> {
    HANDLERS
        .lock()
        .unwrap()
        .scripts
        .as_ref()
        .map(|f| f())
        .unwrap_or_default()
}

fn handler_rules() -> Vec<Value> {
    HANDLERS
        .lock()
        .unwrap()
        .rules
        .as_ref()
        .map(|f| f())
        .unwrap_or_default()
}

fn handler_site_info(url: &str) -> Value {
    HANDLERS
        .lock()
        .unwrap()
        .site_info
        .as_ref()
        .map(|f| f(url))
        .unwrap_or(json!({}))
}

/// 注入真实数据源（targets / scripts / rules / site-info）
pub fn set_handlers(
    targets: Arc<dyn Fn() -> Vec<Value> + Send + Sync>,
    scripts: Arc<dyn Fn() -> Vec<Value> + Send + Sync>,
    rules: Arc<dyn Fn() -> Vec<Value> + Send + Sync>,
    site_info: Arc<dyn Fn(&str) -> Value + Send + Sync>,
) {
    let mut handlers = HANDLERS.lock().unwrap();
    handlers.targets = Some(targets);
    handlers.scripts = Some(scripts);
    handlers.rules = Some(rules);
    handlers.site_info = Some(site_info);
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn send_raw(socket: &Arc<Mutex<tungstenite::WebSocket<std::net::TcpStream>>>, message: &Value) {
    let mut guard = match socket.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let _ = guard.send(Message::Text(message.to_string().into()));
    let _ = guard.flush();
}

fn terminate(socket: &Arc<Mutex<tungstenite::WebSocket<std::net::TcpStream>>>) {
    if let Ok(mut guard) = socket.lock() {
        let _ = guard.close(None);
        let _ = guard.flush();
        if let Ok(stream) = guard.get_ref().try_clone() {
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
    }
}

pub fn start(
    app: &tauri::AppHandle,
    base_port: u16,
    range: u16,
    handler: HandlerFn,
) -> Result<u16, String> {
    if let Some(existing) = STATE.lock().unwrap().as_ref() {
        return Ok(existing.port);
    }

    let mut last_error = String::new();
    for offset in 0..range {
        let candidate = base_port + offset;
        match TcpListener::bind(("127.0.0.1", candidate)) {
            Ok(listener) => {
                *STATE.lock().unwrap() = Some(BridgeState {
                    port: candidate,
                    connections: HashMap::new(),
                });
                spawn_accept_loop(app.clone(), listener, handler.clone());
                spawn_heartbeat(app.clone());
                return Ok(candidate);
            }
            Err(error) => last_error = format!("端口 {candidate}：{error}"),
        }
    }
    Err(last_error)
}

pub fn stop() {
    let _ = GENERATION.fetch_add(1, Ordering::SeqCst);
    let mut state = STATE.lock().unwrap();
    if let Some(existing) = state.as_mut() {
        for connection in existing.connections.values() {
            terminate(&connection.lock().unwrap().socket.clone());
        }
        existing.connections.clear();
    }
    *state = None;
}

pub fn port() -> Option<u16> {
    STATE.lock().unwrap().as_ref().map(|state| state.port)
}

pub fn connections() -> Vec<Value> {
    let state = STATE.lock().unwrap();
    let Some(state) = state.as_ref() else {
        return Vec::new();
    };
    state
        .connections
        .values()
        .map(|connection| {
            let guard = connection.lock().unwrap();
            json!({
                "appId": guard.app_id,
                "clientId": guard.client_id,
                "version": guard.version,
                "connectedAt": guard.connected_at,
                "proxyEnabled": guard.proxy_enabled,
                "proxyError": guard.proxy_error,
            })
        })
        .collect()
}

/// 广播到所有已握手连接
pub fn broadcast(message: &Value) {
    let sockets: Vec<Arc<Mutex<tungstenite::WebSocket<std::net::TcpStream>>>> = {
        let state = STATE.lock().unwrap();
        state
            .as_ref()
            .map(|state| {
                state
                    .connections
                    .values()
                    .filter(|connection| connection.lock().unwrap().authed)
                    .map(|connection| connection.lock().unwrap().socket.clone())
                    .collect()
            })
            .unwrap_or_default()
    };
    for socket in sockets {
        send_raw(&socket, message);
    }
}

fn remove_connection(client_id: &str) {
    if let Some(state) = STATE.lock().unwrap().as_mut() {
        state.connections.remove(client_id);
    }
}

fn insert_connection(client_id: String, connection: Arc<Mutex<Connection>>) {
    if let Some(state) = STATE.lock().unwrap().as_mut() {
        // 重连（同 clientId 旧连接未清理）：接管为最新连接
        if let Some(previous) = state.connections.get(&client_id) {
            terminate(&previous.lock().unwrap().socket.clone());
        }
        state.connections.insert(client_id, connection);
    }
}

fn spawn_accept_loop(app: tauri::AppHandle, listener: TcpListener, handler: HandlerFn) {
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let Ok(peer) = stream.peer_addr() else {
                continue;
            };
            if !peer.ip().is_loopback() {
                continue;
            }
            let handler = handler.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = handle_incoming(app, stream, handler);
            });
        }
    });
}

#[allow(clippy::result_large_err)]
fn handle_incoming(
    app: tauri::AppHandle,
    stream: std::net::TcpStream,
    handler: HandlerFn,
) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_nodelay(true);

    // Origin 校验：只接受本扩展来源（浏览器无法伪造 Origin）；非扩展来源直接拒绝握手
    use tungstenite::handshake::server::{
        ErrorResponse, Request as WsRequest, Response as WsResponse,
    };
    let verify = |request: &WsRequest,
                  response: WsResponse|
     -> std::result::Result<WsResponse, ErrorResponse> {
        let origin_ok = request.headers().iter().any(|(name, value)| {
            name.as_str().eq_ignore_ascii_case("origin")
                && String::from_utf8_lossy(value.as_bytes())
                    .eq_ignore_ascii_case(&format!("chrome-extension://{INTERCEPTOR_EXTENSION_ID}"))
        });
        if origin_ok {
            Ok(response)
        } else {
            let error_response = http::Response::builder()
                .status(403)
                .body(Some("edt interceptor: non-extension origin".into()))
                .unwrap_or_else(|_| ErrorResponse::new(Some("rejected".into())));
            Err(error_response)
        }
    };
    let socket = match tungstenite::accept_hdr(stream, verify) {
        Ok(socket) => socket,
        Err(_) => return Err("WS 桥拒绝非扩展来源".into()),
    };

    let connection = Arc::new(Mutex::new(Connection {
        client_id: String::new(),
        app_id: String::new(),
        version: String::new(),
        connected_at: now_ms(),
        proxy_enabled: false,
        proxy_error: String::new(),
        socket: Arc::new(Mutex::new(socket)),
        last_seen_at: Instant::now(),
        authed: false,
    }));

    let hello_deadline = Instant::now() + Duration::from_millis(HELLO_TIMEOUT_MS);
    loop {
        if Instant::now() > hello_deadline {
            terminate(&connection.lock().unwrap().socket.clone());
            return Err("hello 超时".into());
        }
        let incoming = {
            let shared = connection.lock().unwrap().socket.clone();
            let mut guard = shared.lock().unwrap();
            match guard.read() {
                Ok(message) => Some(message),
                Err(tungstenite::Error::Io(error))
                    if error.kind() == std::io::ErrorKind::WouldBlock =>
                {
                    None
                }
                Err(_) => return Err("连接中断".into()),
            }
        };
        if let Some(Message::Text(text)) = incoming {
            if is_hello(&text) {
                handle_message(&app, &connection, &handler, &text);
                break;
            }
        }
    }

    // 消息读取循环（1 秒读超时轮询；掉线 / 超时由心跳线程与 shutdown 兜底）
    loop {
        if GENERATION.load(Ordering::SeqCst) != generation_snapshot() {
            return Ok(());
        }
        let shared = connection.lock().unwrap().socket.clone();
        let incoming = {
            let mut guard = shared.lock().unwrap();
            match guard.read() {
                Ok(message) => Some(message),
                Err(tungstenite::Error::Io(error))
                    if error.kind() == std::io::ErrorKind::WouldBlock =>
                {
                    None
                }
                Err(_) => return Ok(()),
            }
        };
        if let Some(Message::Text(text)) = incoming {
            handle_message(&app, &connection, &handler, &text);
        }
    }
}

fn generation_snapshot() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}

fn is_hello(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| {
            value
                .get("type")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .as_deref()
        == Some("hello")
}

fn handle_message(
    app: &tauri::AppHandle,
    connection: &Arc<Mutex<Connection>>,
    handler: &HandlerFn,
    text: &str,
) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let Some(message_type) = message
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    {
        let mut guard = connection.lock().unwrap();
        guard.last_seen_at = Instant::now();
    }
    let (authed, client_id, socket) = {
        let guard = connection.lock().unwrap();
        (guard.authed, guard.client_id.clone(), guard.socket.clone())
    };
    if !authed && message_type != "hello" {
        return;
    }

    match message_type.as_str() {
        "hello" => {
            let new_client_id = message
                .get("clientId")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            {
                let mut guard = connection.lock().unwrap();
                guard.authed = true;
                guard.client_id = new_client_id.clone();
                guard.app_id = message
                    .get("appId")
                    .and_then(Value::as_str)
                    .unwrap_or("chrome")
                    .to_string();
                guard.version = message
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            insert_connection(new_client_id, connection.clone());
            send_raw(
                &socket,
                &json!({
                    "type": "hello-ok",
                    "wsPort": port().unwrap_or(0),
                    "proxyPort": super::proxy_port_hint().unwrap_or(0),
                    "targets": handler_targets(),
                    "scripts": handler_scripts(),
                    "rules": handler_rules(),
                    "proxyDesired": Value::Null,
                }),
            );
            handler(app, "connections-changed", json!({}));
        }
        "ping" => {}
        "proxy-state" => {
            if let Some(connection) = get_connection(&client_id) {
                let mut guard = connection.lock().unwrap();
                guard.last_seen_at = Instant::now();
                if let Some(enabled) = message.get("enabled").and_then(Value::as_bool) {
                    guard.proxy_enabled = enabled;
                }
                if let Some(error) = message.get("error").and_then(Value::as_str) {
                    guard.proxy_error = error.to_string();
                }
            }
            handler(app, "proxy-state-reported", message.clone());
            handler(app, "connections-changed", json!({}));
        }
        "add-target" | "target-toggle" | "target-remove-id" | "rule-toggle" | "rule-remove" => {
            handler(app, &message_type, message);
        }
        "site-info" | "target-suggest" => {
            let request_id = message.get("requestId").cloned().unwrap_or(Value::Null);
            let url = message
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let mut reply = if message_type == "site-info" {
                let mut reply = handler_site_info(url);
                if let Some(map) = reply.as_object_mut() {
                    map.insert("type".into(), json!("site-info-result"));
                    map.insert("requestId".into(), request_id);
                }
                reply
            } else {
                json!({
                    "type": "target-suggest-result",
                    "requestId": request_id,
                    "hosts": traffic::suggest_hosts_for_url(url, 12),
                })
            };
            if message_type == "target-suggest" {
                reply["hosts"] = json!(traffic::suggest_hosts_for_url(url, 12));
            }
            send_raw(&socket, &reply);
        }
        "script-log" => {
            let script_id = message.get("scriptId").cloned().unwrap_or(Value::Null);
            let level = message.get("level").cloned().unwrap_or(Value::Null);
            let log_message = message.get("message").cloned().unwrap_or(Value::Null);
            log::warn!(
                "[interceptor] [script-log] clientId={client_id} scriptId={script_id} level={level} {log_message}"
            );
        }
        _ => {}
    }
}

fn get_connection(client_id: &str) -> Option<Arc<Mutex<Connection>>> {
    STATE
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|state| state.connections.get(client_id).cloned())
}

fn spawn_heartbeat(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
        let sockets: Vec<Arc<Mutex<tungstenite::WebSocket<std::net::TcpStream>>>>;
        let stale: Vec<Arc<Mutex<tungstenite::WebSocket<std::net::TcpStream>>>>;
        {
            let state = STATE.lock().unwrap();
            let Some(state) = state.as_ref() else {
                return;
            };
            let now = now_ms();
            let mut live = Vec::new();
            let mut dead = Vec::new();
            for connection in state.connections.values() {
                let guard = connection.lock().unwrap();
                if now - now_ms() > CONNECTION_STALE_MS
                    || guard.last_seen_at.elapsed().as_millis() as u64 > CONNECTION_STALE_MS
                {
                    dead.push(guard.socket.clone());
                } else {
                    live.push(guard.socket.clone());
                }
            }
            sockets = live;
            stale = dead;
        }
        for socket in stale {
            terminate(&socket);
        }
        let _ = &app;
        for socket in sockets {
            send_raw(&socket, &json!({ "type": "heartbeat", "at": now_ms() }));
        }
    });
}
