// interceptor 域：MITM 代理内核（对齐 Node 版 proxy-service.ts）。
// - HTTP：absolute-form 转发；命中处理名单才拆包/改包/记日志，其余透明转发；
// - HTTPS：CONNECT 后按名单分流——命中用根 CA 现场签叶证书做 MITM，未命中原始 TCP 隧道；
// - WebSocket 升级：两侧透传桥接（v1 不改帧）；
// - 回环目标上游跳过证书校验；代理自身端口做自连防护。
use super::{certs, origin, rule_engine, traffic};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

/// 内存缓冲上限：请求/响应体在此范围内完整缓冲（支持改体与完整日志），超出降级为直通
const BUFFER_LIMIT_BYTES: usize = 8 * 1024 * 1024;
/// 上游请求超时
const UPSTREAM_TIMEOUT_MS: u64 = 30_000;
/// 日志正文上限（字符）
const TRAFFIC_BODY_MAX_CHARS: usize = 64 * 1024;
/// 随机端口最多尝试次数
const RANDOM_PORT_ATTEMPTS: u32 = 20;
const RANDOM_PORT_MIN: u16 = 20_000;
const RANDOM_PORT_MAX: u16 = 59_000;

const HOP_BY_HOP_HEADERS: [&str; 9] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

#[derive(Clone)]
pub struct ProxyDeps {
    pub get_targets: Arc<dyn Fn() -> Vec<Value> + Send + Sync>,
    pub get_rules: Arc<dyn Fn() -> Vec<Value> + Send + Sync>,
    pub on_traffic: Arc<dyn Fn(Value) + Send + Sync>,
    /// 代理 / WS 桥自身端口（回环自连防护）
    pub is_own_port: Arc<dyn Fn(u16) -> bool + Send + Sync>,
}

struct ProxyState {
    port: u16,
    deps: ProxyDeps,
    running: Arc<AtomicBool>,
    tunnels: Arc<Mutex<Vec<TcpStream>>>,
}

static STATE: LazyLock<Mutex<Option<ProxyState>>> = LazyLock::new(|| Mutex::new(None));
static CONN_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn port() -> Option<u16> {
    STATE.lock().unwrap().as_ref().map(|state| state.port)
}

pub fn is_running() -> bool {
    STATE
        .lock()
        .unwrap()
        .as_ref()
        .map(|state| state.running.load(Ordering::SeqCst))
        .unwrap_or(false)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 直接访问代理端口时的探活页（浏览器地址栏 / 插件探活都常见）
fn reachable_page(current_port: Option<u16>) -> String {
    [
        "edt 拦截器代理端口正在运行（HTTP 代理）。".to_string(),
        String::new(),
        format!(
            "请把浏览器或代理插件的「HTTP 代理」指向 127.0.0.1:{}，",
            current_port
                .map(|port| port.to_string())
                .unwrap_or_else(|| "?".into())
        ),
        "不要直接把该地址当网址打开；能用代理访问网站即表示链路正常。".to_string(),
        String::new(),
        "注意：本代理只接受 HTTP 代理协议（不支持 SOCKS4/5，也不支持 TLS 直连代理端口）。"
            .to_string(),
    ]
    .join("\n")
}

// ---------------------------------------------------------------------------
// 流抽象（明文 TCP / MITM TLS 共用一套会话读写）
// ---------------------------------------------------------------------------

trait Stream: Read + Write + Send {
    fn shutdown_handle(&self) -> Option<TcpStream>;
    fn set_timeout(&self, timeout: Option<Duration>);
}

impl Stream for TcpStream {
    fn shutdown_handle(&self) -> Option<TcpStream> {
        self.try_clone().ok()
    }

    fn set_timeout(&self, timeout: Option<Duration>) {
        let _ = self.set_read_timeout(timeout);
        let _ = self.set_write_timeout(timeout);
    }
}

impl Stream for native_tls::TlsStream<TcpStream> {
    fn shutdown_handle(&self) -> Option<TcpStream> {
        self.get_ref().try_clone().ok()
    }

    fn set_timeout(&self, timeout: Option<Duration>) {
        let _ = self.get_ref().set_read_timeout(timeout);
        let _ = self.get_ref().set_write_timeout(timeout);
    }
}

impl Stream for rustls::StreamOwned<rustls::ServerConnection, TcpStream> {
    fn shutdown_handle(&self) -> Option<TcpStream> {
        self.sock.try_clone().ok()
    }

    fn set_timeout(&self, timeout: Option<Duration>) {
        let _ = self.sock.set_read_timeout(timeout);
        let _ = self.sock.set_write_timeout(timeout);
    }
}

/// 带预读缓冲的会话：header 逐字节扫描、body 按需读取，残留数据留在缓冲里
struct Session {
    stream: Box<dyn Stream>,
    buffer: Vec<u8>,
}

impl Session {
    fn new(stream: Box<dyn Stream>) -> Self {
        Self {
            stream,
            buffer: Vec::new(),
        }
    }

    fn fill_at_least(&mut self, min: usize) -> std::io::Result<()> {
        let mut chunk = [0u8; 8192];
        while self.buffer.len() < min {
            let read = self.stream.read(&mut chunk)?;
            if read == 0 {
                break;
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
        Ok(())
    }

    /// 读取到 header 结束（含空行）；连接干净关闭返回 None
    fn read_head(&mut self) -> std::io::Result<Option<Vec<u8>>> {
        loop {
            if let Some(index) = find_header_end(&self.buffer) {
                let head = self.buffer.drain(..index + 4).collect::<Vec<u8>>();
                return Ok(Some(head));
            }
            if self.buffer.len() > 128 * 1024 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "请求头过大",
                ));
            }
            let before = self.buffer.len();
            self.fill_at_least(before + 1)?;
            if self.buffer.len() == before {
                return Ok(None);
            }
        }
    }

    fn read_exact_bytes(&mut self, count: usize) -> std::io::Result<Vec<u8>> {
        self.fill_at_least(count)?;
        let take = count.min(self.buffer.len());
        Ok(self.buffer.drain(..take).collect())
    }

    /// 读取 chunked 编码的原始字节（含长度行与结尾 0 块）
    fn read_chunked_raw(&mut self) -> std::io::Result<Vec<u8>> {
        let mut out = Vec::new();
        loop {
            let line = self.read_line()?;
            if line.is_empty() {
                break;
            }
            let size_text = line
                .split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            let size = usize::from_str_radix(&size_text, 16).unwrap_or(0);
            out.extend_from_slice(line.as_bytes());
            out.extend_from_slice(b"\r\n");
            if size == 0 {
                // 结尾可能有 trailer，读到空行为止
                loop {
                    let trailer = self.read_line()?;
                    out.extend_from_slice(trailer.as_bytes());
                    out.extend_from_slice(b"\r\n");
                    if trailer.is_empty() {
                        break;
                    }
                }
                break;
            }
            let data = self.read_exact_bytes(size)?;
            out.extend_from_slice(&data);
            let tail = self.read_exact_bytes(2)?;
            out.extend_from_slice(&tail);
        }
        Ok(out)
    }

    fn read_line(&mut self) -> std::io::Result<String> {
        loop {
            if let Some(index) = self.buffer.windows(2).position(|window| window == b"\r\n") {
                let line = self.buffer.drain(..index + 2).collect::<Vec<u8>>();
                return Ok(String::from_utf8_lossy(&line[..line.len() - 2]).to_string());
            }
            let before = self.buffer.len();
            self.fill_at_least(before + 1)?;
            if self.buffer.len() == before {
                return Ok(String::new());
            }
        }
    }

    /// 读到 EOF（用于无长度信息的响应体）
    fn read_to_end(&mut self) -> std::io::Result<Vec<u8>> {
        let mut out = std::mem::take(&mut self.buffer);
        let mut chunk = [0u8; 16384];
        loop {
            match self.stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    out.extend_from_slice(&chunk[..read]);
                    if out.len() > BUFFER_LIMIT_BYTES * 2 {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => break,
            }
        }
        Ok(out)
    }

    fn write_all_bytes(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.stream.write_all(data)?;
        self.stream.flush()
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

// ---------------------------------------------------------------------------
// HTTP 报文解析
// ---------------------------------------------------------------------------

struct ParsedRequest {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
}

fn parse_request_head(head: &[u8]) -> Option<ParsedRequest> {
    let mut slots = [httparse::EMPTY_HEADER; 96];
    let mut request = httparse::Request::new(&mut slots);
    let status = request.parse(head).ok()?;
    if !status.is_complete() {
        return None;
    }
    let headers = request
        .headers
        .iter()
        .map(|header| {
            (
                header.name.to_string(),
                String::from_utf8_lossy(header.value).to_string(),
            )
        })
        .collect();
    Some(ParsedRequest {
        method: request.method?.to_string(),
        target: request.path?.to_string(),
        headers,
    })
}

struct ParsedResponse {
    status_code: u16,
    status_text: String,
    headers: Vec<(String, String)>,
}

fn parse_response_head(head: &[u8]) -> Option<ParsedResponse> {
    let mut slots = [httparse::EMPTY_HEADER; 96];
    let mut response = httparse::Response::new(&mut slots);
    let status = response.parse(head).ok()?;
    if !status.is_complete() {
        return None;
    }
    let headers = response
        .headers
        .iter()
        .map(|header| {
            (
                header.name.to_string(),
                String::from_utf8_lossy(header.value).to_string(),
            )
        })
        .collect();
    Some(ParsedResponse {
        status_code: response.code?,
        status_text: response.reason.unwrap_or_default().to_string(),
        headers,
    })
}

fn header_get<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn header_set(headers: &mut Vec<(String, String)>, name: &str, value: &str) {
    if let Some(entry) = headers
        .iter_mut()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
    {
        entry.1 = value.to_string();
    } else {
        headers.push((name.to_string(), value.to_string()));
    }
}

fn header_remove(headers: &mut Vec<(String, String)>, name: &str) {
    headers.retain(|(key, _)| !key.eq_ignore_ascii_case(name));
}

fn strip_hop_by_hop(headers: &[(String, String)]) -> Vec<(String, String)> {
    headers
        .iter()
        .filter(|(key, _)| !HOP_BY_HOP_HEADERS.contains(&key.to_lowercase().as_str()))
        .cloned()
        .collect()
}

fn headers_to_json(headers: &[(String, String)]) -> Value {
    let mut map = serde_json::Map::new();
    for (key, value) in headers {
        map.insert(key.clone(), json!(value));
    }
    Value::Object(map)
}

fn headers_to_value_object(headers: &[(String, String)]) -> Value {
    headers_to_json(headers)
}

/// 从 JSON 头对象回到有序列表（规则引擎改头后回写用）
fn json_headers_to_vec(value: &Value) -> Vec<(String, String)> {
    value
        .as_object()
        .map(|map| {
            map.iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap_or_default().to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// 命中名单的响应要"每次都能看到"：去掉缓存控制 / 校验器
fn without_cache_headers(headers: Vec<(String, String)>) -> Vec<(String, String)> {
    const DROP: [&str; 6] = [
        "cache-control",
        "expires",
        "etag",
        "last-modified",
        "age",
        "pragma",
    ];
    let mut next: Vec<(String, String)> = headers
        .into_iter()
        .filter(|(key, _)| !DROP.contains(&key.to_lowercase().as_str()))
        .collect();
    next.push((
        "cache-control".into(),
        "no-store, no-cache, must-revalidate, max-age=0".into(),
    ));
    next.push(("pragma".into(), "no-cache".into()));
    next
}

fn is_textual_content_type(content_type: &str) -> bool {
    if content_type.is_empty() {
        return false;
    }
    let lower = content_type.to_lowercase();
    [
        "json",
        "text",
        "xml",
        "javascript",
        "html",
        "css",
        "x-www-form-urlencoded",
        "graphql",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

/// 资源类型推断：优先 Sec-Fetch-Dest，回退 Accept 启发
fn infer_resource_type(headers: &[(String, String)]) -> &'static str {
    if let Some(dest) = header_get(headers, "sec-fetch-dest") {
        return match dest {
            "document" => "main_frame",
            "iframe" | "frame" => "sub_frame",
            "script" => "script",
            "style" => "stylesheet",
            "image" => "image",
            "font" => "font",
            "video" | "audio" | "track" => "media",
            "empty" => "xmlhttprequest",
            _ => "other",
        };
    }
    let accept = header_get(headers, "accept")
        .unwrap_or_default()
        .to_lowercase();
    if accept.contains("text/html") {
        "main_frame"
    } else if accept.contains("text/css") {
        "stylesheet"
    } else if accept.contains("image/") {
        "image"
    } else if accept.contains("javascript") {
        "script"
    } else if accept.contains("json") {
        "xmlhttprequest"
    } else {
        "other"
    }
}

fn decode_body(body: &[u8], encoding: &str) -> Option<Vec<u8>> {
    match encoding.trim().to_lowercase().as_str() {
        "" | "identity" => Some(body.to_vec()),
        "gzip" => {
            let mut decoder = flate2::read::GzDecoder::new(body);
            let mut out = Vec::new();
            decoder.read_to_end(&mut out).ok().map(|_| out)
        }
        "deflate" => {
            let mut decoder = flate2::read::ZlibDecoder::new(body);
            let mut out = Vec::new();
            decoder.read_to_end(&mut out).ok().map(|_| out)
        }
        "br" => {
            let mut out = Vec::new();
            let mut reader = brotli::Decompressor::new(body, 8192);
            reader.read_to_end(&mut out).ok().map(|_| out)
        }
        _ => None,
    }
}

/// 日志正文截断（字符级，避免破坏 JSON 观感）
fn truncate_for_log(body: Option<&[u8]>, truncated: bool) -> (Option<String>, bool) {
    let Some(body) = body else {
        return (None, truncated);
    };
    let text = String::from_utf8_lossy(body).to_string();
    if text.chars().count() > TRAFFIC_BODY_MAX_CHARS {
        (
            Some(text.chars().take(TRAFFIC_BODY_MAX_CHARS).collect()),
            true,
        )
    } else {
        (Some(text), truncated)
    }
}

// ---------------------------------------------------------------------------
// 上游连接
// ---------------------------------------------------------------------------

enum Upstream {
    Plain(TcpStream),
    Tls(Box<native_tls::TlsStream<TcpStream>>),
}

impl Read for Upstream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Upstream::Plain(stream) => stream.read(buf),
            Upstream::Tls(stream) => stream.read(buf),
        }
    }
}

impl Write for Upstream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Upstream::Plain(stream) => stream.write(buf),
            Upstream::Tls(stream) => stream.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Upstream::Plain(stream) => stream.flush(),
            Upstream::Tls(stream) => stream.flush(),
        }
    }
}

fn connect_upstream(scheme: &str, host: &str, port: u16) -> Result<Upstream, String> {
    let tcp = TcpStream::connect((host, port)).map_err(|error| format!("上游连接失败：{error}"))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_millis(UPSTREAM_TIMEOUT_MS)));
    let _ = tcp.set_write_timeout(Some(Duration::from_millis(UPSTREAM_TIMEOUT_MS)));
    let _ = tcp.set_nodelay(true);
    if scheme == "https" {
        let mut builder = native_tls::TlsConnector::builder();
        // 回环目标默认跳过上游证书校验（本地自签名场景）；其余默认严格校验
        if origin::is_loopback_host(host) {
            builder.danger_accept_invalid_certs(true);
            builder.danger_accept_invalid_hostnames(true);
        }
        let connector = builder
            .build()
            .map_err(|error| format!("TLS 初始化失败：{error}"))?;
        let stream = connector
            .connect(host, tcp)
            .map_err(|error| format!("上游 TLS 握手失败：{error}"))?;
        Ok(Upstream::Tls(Box::new(stream)))
    } else {
        Ok(Upstream::Plain(tcp))
    }
}

fn build_request_bytes(
    method: &str,
    path_and_query: &str,
    headers: &[(String, String)],
    body: Option<&[u8]>,
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(format!("{method} {path_and_query} HTTP/1.1\r\n").as_bytes());
    for (key, value) in headers {
        out.extend_from_slice(format!("{key}: {value}\r\n").as_bytes());
    }
    out.extend_from_slice(b"\r\n");
    if let Some(body) = body {
        out.extend_from_slice(body);
    }
    out
}

fn build_response_bytes(
    status_code: u16,
    status_text: &str,
    headers: &[(String, String)],
    body: Option<&[u8]>,
) -> Vec<u8> {
    let reason = if status_text.is_empty() {
        default_reason(status_code)
    } else {
        status_text.to_string()
    };
    let mut out = Vec::new();
    out.extend_from_slice(format!("HTTP/1.1 {status_code} {reason}\r\n").as_bytes());
    for (key, value) in headers {
        out.extend_from_slice(format!("{key}: {value}\r\n").as_bytes());
    }
    out.extend_from_slice(b"\r\n");
    if let Some(body) = body {
        out.extend_from_slice(body);
    }
    out
}

fn default_reason(status: u16) -> String {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "",
    }
    .to_string()
}

// ---------------------------------------------------------------------------
// 启动 / 停止
// ---------------------------------------------------------------------------

fn listener_loop(listener: TcpListener, running: Arc<AtomicBool>, deps: ProxyDeps, port: u16) {
    std::thread::spawn(move || {
        let _ = listener.set_nonblocking(true);
        while running.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, peer)) => {
                    let deps = deps.clone();
                    let tunnels = STATE
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map(|state| state.tunnels.clone());
                    let Some(tunnels) = tunnels else { continue };
                    std::thread::spawn(move || {
                        handle_connection(stream, peer, deps, port, tunnels);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
    });
}

pub fn start(desired_port: Option<u16>, deps: ProxyDeps) -> Result<u16, String> {
    if let Some(existing) = STATE.lock().unwrap().as_ref() {
        return Ok(existing.port);
    }

    let (listener, port) = match desired_port {
        Some(port) => {
            let listener = TcpListener::bind(("127.0.0.1", port))
                .map_err(|error| format!("端口 {port} 不可用：{error}"))?;
            (listener, port)
        }
        None => {
            let mut last_error = String::new();
            let mut bound = None;
            for _ in 0..RANDOM_PORT_ATTEMPTS {
                let candidate = rand::random_range(RANDOM_PORT_MIN..=RANDOM_PORT_MAX);
                match TcpListener::bind(("127.0.0.1", candidate)) {
                    Ok(listener) => {
                        bound = Some((listener, candidate));
                        break;
                    }
                    Err(error) => last_error = format!("端口 {candidate} 不可用：{error}"),
                }
            }
            bound.ok_or(last_error)?
        }
    };

    let running = Arc::new(AtomicBool::new(true));
    *STATE.lock().unwrap() = Some(ProxyState {
        port,
        deps: deps.clone(),
        running: running.clone(),
        tunnels: Arc::new(Mutex::new(Vec::new())),
    });
    listener_loop(listener, running, deps, port);
    Ok(port)
}

pub fn stop() {
    let mut state = STATE.lock().unwrap();
    if let Some(existing) = state.as_mut() {
        existing.running.store(false, Ordering::SeqCst);
        for tunnel in existing.tunnels.lock().unwrap().drain(..) {
            let _ = tunnel.shutdown(Shutdown::Both);
        }
    }
    *state = None;
}

/// 名单变更后断开透传隧道，让新条目对已建立的连接也立即生效
pub fn close_transparent_tunnels() -> usize {
    let state = STATE.lock().unwrap();
    let Some(existing) = state.as_ref() else {
        return 0;
    };
    let mut tunnels = existing.tunnels.lock().unwrap();
    let count = tunnels.len();
    for tunnel in tunnels.drain(..) {
        let _ = tunnel.shutdown(Shutdown::Both);
    }
    count
}

// ---------------------------------------------------------------------------
// 连接处理
// ---------------------------------------------------------------------------

fn handle_connection(
    stream: TcpStream,
    _peer: std::net::SocketAddr,
    deps: ProxyDeps,
    proxy_port: u16,
    tunnels: Arc<Mutex<Vec<TcpStream>>>,
) {
    // Windows 上 accept 出的 socket 会继承监听器的非阻塞模式，必须显式设回阻塞
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(UPSTREAM_TIMEOUT_MS)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(UPSTREAM_TIMEOUT_MS)));
    let session_id = CONN_SEQ.fetch_add(1, Ordering::SeqCst);
    let _ = session_id;

    let mut session = Session::new(Box::new(match stream.try_clone() {
        Ok(clone) => clone,
        Err(_) => return,
    }));

    // 一个连接上可能连续多个请求（keep-alive）
    loop {
        let head = match session.read_head() {
            Ok(Some(head)) => head,
            Ok(None) => return,
            Err(_) => return,
        };
        let Some(request) = parse_request_head(&head) else {
            let _ =
                session.write_all_bytes(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
            return;
        };

        if request.method.eq_ignore_ascii_case("CONNECT") {
            handle_connect(session, request, deps, proxy_port, tunnels);
            return;
        }

        if !handle_http(&mut session, &request, deps.clone(), proxy_port) {
            return;
        }
    }
}

/// CONNECT：名单内 MITM / 名单外原始隧道
fn handle_connect(
    mut session: Session,
    request: ParsedRequest,
    deps: ProxyDeps,
    proxy_port: u16,
    tunnels: Arc<Mutex<Vec<TcpStream>>>,
) {
    let Some((host, port)) = parse_authority(&request.target) else {
        let _ = session.write_all_bytes(b"HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
    };
    if origin::is_loopback_host(&host) && (deps.is_own_port)(port) {
        let _ = session.write_all_bytes(b"HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
    }
    let _ = proxy_port;

    // CONNECT 一定是 https：这里就是请求的 origin
    let origin_text = origin::origin_of("https", &host, Some(port as i64));
    let targets = (deps.get_targets)();
    let matched = targets.iter().find(|target| {
        target.get("enabled").and_then(Value::as_bool) != Some(false)
            && target.get("origin").and_then(Value::as_str) == Some(origin_text.as_str())
    });

    if matched.is_none() {
        raw_tunnel(session, host, port, tunnels);
        return;
    }

    // 命中名单：MITM（浏览器不信任根 CA 时 TLS 握手会失败）
    let root = match certs::ensure_root_ca() {
        Ok(root) => root,
        Err(_) => return,
    };
    let leaf = match certs::get_leaf_certificate(&root, &host) {
        Ok(leaf) => leaf,
        Err(_) => return,
    };
    if session
        .write_all_bytes(
            b"HTTP/1.1 200 Connection Established\r\nProxy-Agent: edt-interceptor\r\n\r\n",
        )
        .is_err()
    {
        return;
    }

    // MITM 服务端用 rustls：schannel 只接受 RSA 私钥，叶证书是 ECDSA
    let config = match mitm_server_config(&leaf) {
        Ok(config) => config,
        Err(_) => return,
    };
    let Some(handle) = session.stream.shutdown_handle() else {
        return;
    };
    let Ok(connection) = rustls::ServerConnection::new(config) else {
        return;
    };
    let tls_stream = rustls::StreamOwned::new(connection, handle);
    let _ = tls_stream
        .sock
        .set_read_timeout(Some(Duration::from_millis(UPSTREAM_TIMEOUT_MS)));

    // TLS 层之上重新按明文 HTTP 处理，携带 MITM 目标信息
    let mut inner = Session::new(Box::new(tls_stream));
    loop {
        let head = match inner.read_head() {
            Ok(Some(head)) => head,
            // 对端关闭（浏览器复用连接后正常断开）或读失败：结束本次会话
            _ => return,
        };
        let Some(request) = parse_request_head(&head) else {
            return;
        };
        let mitm = Some((host.clone(), port));
        if !handle_http_with_mitm(&mut inner, &request, deps.clone(), mitm) {
            return;
        }
    }
}

/// MITM 服务端 TLS 配置（每次现场签发的叶证书一份配置；证书链只含叶证书）
fn mitm_server_config(
    leaf: &certs::LeafCertificate,
) -> Result<std::sync::Arc<rustls::ServerConfig>, String> {
    // rustls 0.23 需要显式安装进程级 crypto provider（幂等）
    let _ = rustls::crypto::ring::default_provider().install_default();
    let cert_chain = vec![rustls::pki_types::CertificateDer::from(
        leaf.cert_der.clone(),
    )];
    let key = rustls::pki_types::PrivateKeyDer::try_from(leaf.key_der.clone())
        .map_err(|error| format!("叶证书私钥解析失败：{error}"))?;
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(cert_chain, key)
        .map_err(|error| format!("MITM TLS 配置失败：{error}"))?;
    Ok(std::sync::Arc::new(config))
}

fn raw_tunnel(mut session: Session, host: String, port: u16, tunnels: Arc<Mutex<Vec<TcpStream>>>) {
    let Ok(upstream) = TcpStream::connect((host.as_str(), port)) else {
        let _ = session.write_all_bytes(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
        return;
    };
    let _ = upstream.set_nodelay(true);
    if session
        .write_all_bytes(
            b"HTTP/1.1 200 Connection Established\r\nProxy-Agent: edt-interceptor\r\n\r\n",
        )
        .is_err()
    {
        return;
    }
    // 记下透传隧道：名单变更时主动断开，否则浏览器会一直复用旧连接
    let Some(client_write_handle) = session.stream.shutdown_handle() else {
        return;
    };
    if let Ok(clone) = client_write_handle.try_clone() {
        tunnels.lock().unwrap().push(clone);
    }
    let Ok(mut upstream_write) = upstream.try_clone() else {
        return;
    };
    let mut upstream_read = upstream;
    let mut client_write = client_write_handle;
    // 客户端 → 上游（session 移入本线程）
    let client_to_upstream = std::thread::spawn(move || {
        let mut buffer = [0u8; 16384];
        loop {
            match session.stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if upstream_write.write_all(&buffer[..read]).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = upstream_write.shutdown(Shutdown::Both);
    });
    // 上游 → 客户端
    let mut buffer = [0u8; 16384];
    loop {
        match upstream_read.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if client_write.write_all(&buffer[..read]).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let _ = client_write.shutdown(Shutdown::Both);
    let _ = client_to_upstream.join();
}

fn parse_authority(authority: &str) -> Option<(String, u16)> {
    let authority = authority.trim();
    if authority.is_empty() {
        return None;
    }
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = rest[..end].to_string();
        let after = &rest[end + 1..];
        let port = after
            .strip_prefix(':')
            .and_then(|text| text.parse::<u16>().ok())
            .unwrap_or(443);
        return Some((host, port));
    }
    match authority.rfind(':') {
        Some(index) => {
            let host = authority[..index].to_string();
            let port = authority[index + 1..].parse::<u16>().ok()?;
            Some((host, port))
        }
        None => Some((authority.to_string(), 443)),
    }
}

/// `host[:port]` authority 串（IPv6 带括号；443 省略端口）
fn format_authority(host: &str, port: u16) -> String {
    let bracketed = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    if port == 443 {
        bracketed
    } else {
        format!("{bracketed}:{port}")
    }
}

// ---------------------------------------------------------------------------
// 明文 HTTP / MITM 后的 HTTP 处理
// ---------------------------------------------------------------------------

fn handle_http(
    session: &mut Session,
    request: &ParsedRequest,
    deps: ProxyDeps,
    _proxy_port: u16,
) -> bool {
    handle_http_with_mitm(session, request, deps, None)
}

fn handle_http_with_mitm(
    session: &mut Session,
    request: &ParsedRequest,
    deps: ProxyDeps,
    mitm: Option<(String, u16)>,
) -> bool {
    let started_at = now_ms();

    let (scheme, host, target_port, path_and_query, full_url) = match &mitm {
        Some((host, port)) => (
            "https".to_string(),
            host.clone(),
            *port,
            request.target.clone(),
            format!(
                "https://{}{}",
                format_authority(host, *port),
                request.target
            ),
        ),
        None => {
            let Ok(parsed) = url::Url::parse(&request.target) else {
                // 直接把代理端口当网址访问：回一页人话，顺便证明端口可达
                let body = reachable_page(port());
                let response = build_response_bytes(
                    200,
                    "OK",
                    &[
                        ("content-type".into(), "text/plain; charset=utf-8".into()),
                        ("content-length".into(), body.len().to_string()),
                    ],
                    Some(body.as_bytes()),
                );
                let _ = session.write_all_bytes(&response);
                return false;
            };
            let scheme = if parsed.scheme() == "https" {
                "https"
            } else {
                "http"
            };
            let host = parsed.host_str().unwrap_or_default().to_string();
            let port = parsed
                .port()
                .unwrap_or(if scheme == "https" { 443 } else { 80 });
            let path_and_query = match parsed.query() {
                Some(query) => format!("{}?{query}", parsed.path()),
                None => parsed.path().to_string(),
            };
            (
                scheme.to_string(),
                host,
                port,
                path_and_query,
                parsed.to_string(),
            )
        }
    };

    if origin::is_loopback_host(&host) && (deps.is_own_port)(target_port) {
        let response = build_response_bytes(
            403,
            "Forbidden",
            &[
                ("content-type".into(), "text/plain; charset=utf-8".into()),
                ("content-length".into(), "33".into()),
            ],
            Some(b"Forbidden: edt interceptor self-connection"),
        );
        let _ = session.write_all_bytes(&response);
        return false;
    }

    // 名单是白名单闸门：只按请求 origin 判定
    let origin_text = origin::origin_of(&scheme, &host, Some(target_port as i64));
    let targets = (deps.get_targets)();
    let matched = targets.iter().find(|target| {
        target.get("enabled").and_then(Value::as_bool) != Some(false)
            && target.get("origin").and_then(Value::as_str) == Some(origin_text.as_str())
    });

    let Some(target) = matched else {
        // 非名单：透明转发（不改包、不记日志、不跑规则）
        return forward_transparent(
            session,
            request,
            &scheme,
            &host,
            target_port,
            &path_and_query,
        );
    };

    // 强制回源是条目级开关（缺省开）
    let no_cache = target.get("noCache").and_then(Value::as_bool) != Some(false);
    let path = path_and_query.split('?').next().unwrap_or("/").to_string();
    let request_content_type = header_get(&request.headers, "content-type")
        .unwrap_or_default()
        .to_string();

    let rules = (deps.get_rules)();
    let enabled_rules: Vec<&Value> = rules
        .iter()
        .filter(|rule| rule.get("enabled").and_then(Value::as_bool) == Some(true))
        .collect();

    // 请求体：任一启用规则需要体（payload 过滤器 / 改体）时先整体缓冲
    let requires_body = enabled_rules.iter().any(|rule| {
        rule.get("type").and_then(Value::as_str) == Some("request")
            || rule.pointer("/filters/requestPayload").is_some()
    });

    let mut request_body: Option<Vec<u8>> = None;
    if requires_body {
        match read_request_body(session, &request.headers) {
            Ok(Some(body)) => request_body = Some(body),
            Ok(None) => {}
            Err(message) => {
                let response = build_response_bytes(
                    502,
                    "Bad Gateway",
                    &[
                        ("content-type".into(), "text/plain; charset=utf-8".into()),
                        ("content-length".into(), message.len().to_string()),
                    ],
                    Some(message.as_bytes()),
                );
                let _ = session.write_all_bytes(&response);
                return false;
            }
        }
    }

    let page_url = header_get(&request.headers, "referer")
        .or_else(|| header_get(&request.headers, "origin"))
        .map(str::to_string);
    let resource_type = infer_resource_type(&request.headers);
    let normalized_host = origin::normalize_host(&host);

    let context = rule_engine::MatchContext {
        method: &request.method,
        url: &full_url,
        host: &normalized_host,
        path: &path,
        resource_type,
        page_url: page_url.as_deref(),
        request_body: request_body.as_deref(),
        request_content_type: Some(&request_content_type),
    };

    let matched_rules = rule_engine::find_matching_rules(&enabled_rules, &context);
    let matched_ids: Vec<String> = matched_rules
        .iter()
        .map(|rule| {
            rule.get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    let matched_names: Vec<String> = matched_rules
        .iter()
        .map(|rule| {
            rule.get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    let rule_refs: Vec<&Value> = matched_rules.iter().collect();
    let plan = rule_engine::plan_request(&rule_refs, &full_url);
    // cancel：直接断开连接，浏览器侧表现为请求失败
    if plan.cancel {
        let entry = traffic::build_entry(
            started_at,
            &request.method,
            &full_url,
            &scheme,
            &host,
            &path,
            None,
            None,
            now_ms().saturating_sub(started_at),
            Some(headers_to_json(&request.headers)),
            request_body
                .as_deref()
                .and_then(|body| truncate_for_log(Some(body), false).0),
            None,
            None,
            false,
            false,
            true,
            None,
            None,
            None,
            matched_ids,
            matched_names,
            Some("canceled by rule".into()),
        );
        (deps.on_traffic)(entry);
        return false;
    }

    if plan.delay_ms > 0 {
        std::thread::sleep(Duration::from_millis(plan.delay_ms as u64));
    }

    // 重定向：本地 30x 响应，不请求上游
    if let Some(location) = &plan.redirected_to {
        let mut headers: Vec<(String, String)> = vec![
            ("location".into(), location.clone()),
            ("content-type".into(), "text/plain; charset=utf-8".into()),
            ("content-length".into(), "0".into()),
        ];
        if no_cache {
            headers = without_cache_headers(headers);
        }
        let response = build_response_bytes(plan.redirect_status_code, "", &headers, None);
        let _ = session.write_all_bytes(&response);
        let reason = default_reason(plan.redirect_status_code);
        let entry = traffic::build_entry(
            started_at,
            &request.method,
            &full_url,
            &scheme,
            &host,
            &path,
            Some(plan.redirect_status_code),
            Some(&reason),
            now_ms().saturating_sub(started_at),
            Some(headers_to_json(&request.headers)),
            request_body
                .as_deref()
                .and_then(|body| truncate_for_log(Some(body), false).0),
            Some(headers_to_json(&headers)),
            None,
            false,
            false,
            false,
            Some(location.clone()),
            Some(plan.delay_ms),
            None,
            matched_ids,
            matched_names,
            None,
        );
        (deps.on_traffic)(entry);
        return true;
    }

    // URL 改写（replace / queryParam）后的最终上游目标
    let Ok(final_url) = url::Url::parse(&plan.url) else {
        return false;
    };
    let final_scheme = if final_url.scheme() == "https" {
        "https"
    } else {
        "http"
    };
    let final_host = final_url.host_str().unwrap_or_default().to_string();
    let final_port = final_url
        .port()
        .unwrap_or(if final_scheme == "https" { 443 } else { 80 });
    let final_path_and_query = match final_url.query() {
        Some(query) => format!("{}?{query}", final_url.path()),
        None => final_url.path().to_string(),
    };
    let rewritten_to = if plan.rewritten {
        Some(plan.url.clone())
    } else {
        None
    };

    // 上游请求头：去逐跳头 + 规则改头 + UA
    let mut upstream_headers = strip_hop_by_hop(&request.headers);
    if no_cache {
        upstream_headers.retain(|(key, _)| {
            !matches!(
                key.to_lowercase().as_str(),
                "if-none-match" | "if-modified-since" | "if-range"
            )
        });
    }
    let mut headers_value = headers_to_value_object(&upstream_headers);
    for operation in &plan.request_headers {
        rule_engine::apply_header_operations(&mut headers_value, Some(&json!([operation])));
    }
    upstream_headers = json_headers_to_vec(&headers_value);
    if let Some(user_agent) = &plan.user_agent {
        header_set(&mut upstream_headers, "user-agent", user_agent);
    }
    if rewritten_to.is_some() && (final_host != host || final_port != target_port) {
        header_set(&mut upstream_headers, "host", final_url.authority());
    }

    // 请求体改写：静态替换优先，其次动态脚本
    let mut outgoing_body = request_body.clone();
    if let Some(replace) = &plan.body_replace {
        outgoing_body = Some(replace.as_bytes().to_vec());
    } else if let Some(_script) = &plan.body_script {
        // 动态请求体脚本需要 JS 引擎（见 docs/interceptor.md）；Rust 侧暂不执行，保留原体
        log::warn!("[interceptor] 动态请求体脚本暂未在 Rust 侧执行，已保留原请求体");
    }
    if outgoing_body != request_body {
        let length = outgoing_body.as_ref().map(|body| body.len()).unwrap_or(0);
        header_set(&mut upstream_headers, "content-length", &length.to_string());
    }

    // mock 短路：不调服务器直接返回
    if let Some(mock_rule) = rule_engine::find_mock_rule(&rule_refs) {
        return respond_with_mock(
            session,
            &rule_refs,
            mock_rule,
            request,
            &full_url,
            &scheme,
            &host,
            &path,
            &upstream_headers,
            outgoing_body.as_deref(),
            started_at,
            plan.delay_ms,
            no_cache,
            matched_ids,
            matched_names,
            &deps,
        );
    }

    let owned_rules = matched_rules.clone();
    forward_to_upstream(
        session,
        request,
        ForwardOptions {
            scheme: final_scheme,
            host: final_host,
            port: final_port,
            path_and_query: final_path_and_query,
            method: request.method.clone(),
            headers: upstream_headers,
            body: outgoing_body,
            body_buffered: requires_body,
            request_content_type,
            matched_rules: owned_rules,
            matched_ids,
            matched_names,
            started_at,
            delayed_by_ms: plan.delay_ms,
            rewritten_to,
            no_cache,
            log_url: full_url,
            log_scheme: scheme,
            log_host: host,
            log_path: path,
            request_headers: request.headers.clone(),
            deps,
        },
    )
}

/// 读取请求体（Content-Length 或 chunked；chunked 会被解码）
fn read_request_body(
    session: &mut Session,
    headers: &[(String, String)],
) -> Result<Option<Vec<u8>>, String> {
    if header_get(headers, "transfer-encoding")
        .map(|value| value.to_lowercase().contains("chunked"))
        .unwrap_or(false)
    {
        let raw = session
            .read_chunked_raw()
            .map_err(|error| format!("请求体读取失败：{error}"))?;
        return Ok(Some(decode_chunked(&raw)));
    }
    match header_get(headers, "content-length").and_then(|value| value.trim().parse::<usize>().ok())
    {
        Some(length) if length > 0 => {
            if length > BUFFER_LIMIT_BYTES {
                return Err("request body exceeds buffer limit for rule processing".into());
            }
            let body = session
                .read_exact_bytes(length)
                .map_err(|error| format!("请求体读取失败：{error}"))?;
            Ok(Some(body))
        }
        _ => Ok(None),
    }
}

fn decode_chunked(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut rest = raw;
    while let Some(index) = rest.windows(2).position(|window| window == b"\r\n") {
        let line = String::from_utf8_lossy(&rest[..index]).to_string();
        rest = &rest[index + 2..];
        let size = usize::from_str_radix(line.split(';').next().unwrap_or_default().trim(), 16)
            .unwrap_or(0);
        if size == 0 {
            break;
        }
        if rest.len() < size {
            out.extend_from_slice(rest);
            break;
        }
        out.extend_from_slice(&rest[..size]);
        rest = &rest[(size + 2).min(rest.len())..];
    }
    out
}

struct ForwardOptions {
    scheme: &'static str,
    host: String,
    port: u16,
    path_and_query: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
    body_buffered: bool,
    request_content_type: String,
    matched_rules: Vec<Value>,
    matched_ids: Vec<String>,
    matched_names: Vec<String>,
    started_at: u64,
    delayed_by_ms: i64,
    rewritten_to: Option<String>,
    no_cache: bool,
    log_url: String,
    log_scheme: String,
    log_host: String,
    log_path: String,
    request_headers: Vec<(String, String)>,
    deps: ProxyDeps,
}

#[allow(clippy::too_many_arguments)]
fn forward_to_upstream(
    session: &mut Session,
    _request: &ParsedRequest,
    options: ForwardOptions,
) -> bool {
    let ForwardOptions {
        scheme,
        host,
        port,
        path_and_query,
        method,
        headers,
        body,
        body_buffered,
        request_content_type,
        matched_rules,
        matched_ids,
        matched_names,
        started_at,
        delayed_by_ms,
        rewritten_to,
        no_cache,
        log_url,
        log_scheme,
        log_host,
        log_path,
        request_headers,
        deps,
    } = options;

    let rule_refs: Vec<&Value> = matched_rules.iter().collect();

    let mut upstream = match connect_upstream(scheme, &host, port) {
        Ok(upstream) => upstream,
        Err(message) => {
            let response = build_response_bytes(
                502,
                "Bad Gateway",
                &[
                    ("content-type".into(), "text/plain; charset=utf-8".into()),
                    ("content-length".into(), message.len().to_string()),
                ],
                Some(message.as_bytes()),
            );
            let _ = session.write_all_bytes(&response);
            let entry = traffic::build_entry(
                started_at,
                &method,
                &log_url,
                &log_scheme,
                &log_host,
                &log_path,
                None,
                None,
                now_ms().saturating_sub(started_at),
                Some(headers_to_json(&request_headers)),
                None,
                None,
                None,
                false,
                false,
                false,
                None,
                None,
                rewritten_to.clone(),
                matched_ids,
                matched_names,
                Some(message),
            );
            (deps.on_traffic)(entry);
            return false;
        }
    };

    // 请求体：已缓冲则整块写出；未缓冲则从客户端流式转发
    let request_bytes = build_request_bytes(&method, &path_and_query, &headers, None);
    if upstream.write_all(&request_bytes).is_err() {
        return false;
    }

    let mut request_body_for_log = body.clone();
    if let Some(body) = &body {
        if upstream.write_all(body).is_err() {
            return false;
        }
    } else if !body_buffered {
        // 流式转发请求体（Content-Length 或 chunked 原样）
        let chunked = header_get(&headers, "transfer-encoding")
            .map(|value| value.to_lowercase().contains("chunked"))
            .unwrap_or(false);
        let length = header_get(&headers, "content-length")
            .and_then(|value| value.trim().parse::<usize>().ok());
        let mut logged: Vec<u8> = Vec::new();
        if chunked {
            if let Ok(raw) = session.read_chunked_raw() {
                let _ = upstream.write_all(&raw);
                if is_textual_content_type(&request_content_type) && raw.len() <= BUFFER_LIMIT_BYTES
                {
                    logged = decode_chunked(&raw);
                }
            }
        } else if let Some(length) = length {
            let data = session.read_exact_bytes(length).unwrap_or_default();
            let _ = upstream.write_all(&data);
            if is_textual_content_type(&request_content_type) && data.len() <= BUFFER_LIMIT_BYTES {
                logged = data;
            }
        }
        if !logged.is_empty() {
            request_body_for_log = Some(logged);
        }
    }
    let _ = upstream.flush();

    // 读响应头
    let mut upstream_session = Session::new(Box::new(UpstreamWrapper(upstream)));
    let response_head = match upstream_session.read_head() {
        Ok(Some(head)) => head,
        _ => {
            let _ =
                session.write_all_bytes(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
            return false;
        }
    };
    let Some(response) = parse_response_head(&response_head) else {
        let _ = session.write_all_bytes(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        return false;
    };

    let response_content_type = header_get(&response.headers, "content-type")
        .unwrap_or_default()
        .to_string();
    let response_content_encoding = header_get(&response.headers, "content-encoding")
        .unwrap_or_default()
        .to_string();
    let flat_headers = strip_hop_by_hop(&response.headers);
    let wants_body_replace = rule_refs.iter().any(|rule| {
        rule.get("type").and_then(Value::as_str) == Some("response")
            && rule.pointer("/response/bodyReplace").is_some()
    });

    // 读响应体
    let chunked = header_get(&response.headers, "transfer-encoding")
        .map(|value| value.to_lowercase().contains("chunked"))
        .unwrap_or(false);
    let content_length = header_get(&response.headers, "content-length")
        .and_then(|value| value.trim().parse::<usize>().ok());

    let raw_body: Option<Vec<u8>> = if wants_body_replace {
        if chunked {
            upstream_session
                .read_chunked_raw()
                .ok()
                .map(|raw| decode_chunked(&raw))
        } else if let Some(length) = content_length {
            if length > BUFFER_LIMIT_BYTES {
                None
            } else {
                upstream_session.read_exact_bytes(length).ok()
            }
        } else {
            upstream_session.read_to_end().ok()
        }
    } else {
        None
    };

    let mut headers_value = headers_to_value_object(&flat_headers);

    if wants_body_replace {
        if let Some(raw_body) = raw_body {
            let decoded = decode_body(&raw_body, &response_content_encoding);
            if let Some(decoded) = decoded {
                let mutation = rule_engine::apply_response_mutations(
                    &rule_refs,
                    response.status_code,
                    &mut headers_value,
                    Some(decoded),
                );
                let mut out_headers = json_headers_to_vec(&headers_value);
                header_remove(&mut out_headers, "transfer-encoding");
                header_remove(&mut out_headers, "content-encoding");
                let body = mutation.body.unwrap_or_default();
                header_set(&mut out_headers, "content-length", &body.len().to_string());
                if no_cache {
                    out_headers = without_cache_headers(out_headers);
                }
                let response_bytes = build_response_bytes(
                    mutation.status_code,
                    mutation.status_text.as_deref().unwrap_or_default(),
                    &out_headers,
                    Some(&body),
                );
                let _ = session.write_all_bytes(&response_bytes);
                let (logged_body, logged_truncated) = truncate_for_log(Some(&body), false);
                let entry = traffic::build_entry(
                    started_at,
                    &method,
                    &log_url,
                    &log_scheme,
                    &log_host,
                    &log_path,
                    Some(mutation.status_code),
                    mutation
                        .status_text
                        .as_deref()
                        .or(Some(default_reason(mutation.status_code).as_str())),
                    now_ms().saturating_sub(started_at),
                    Some(headers_to_json(&request_headers)),
                    request_body_for_log
                        .as_deref()
                        .and_then(|body| truncate_for_log(Some(body), false).0),
                    Some(headers_to_json(&out_headers)),
                    logged_body,
                    logged_truncated,
                    false,
                    false,
                    None,
                    Some(delayed_by_ms),
                    rewritten_to,
                    matched_ids,
                    matched_names,
                    None,
                );
                (deps.on_traffic)(entry);
                return true;
            }
            // 解码失败：按原始内容回写，不改体；状态码 / 响应头变更照常应用
            let mutation = rule_engine::apply_response_mutations(
                &rule_refs,
                response.status_code,
                &mut headers_value,
                None,
            );
            let mut out_headers = json_headers_to_vec(&headers_value);
            header_remove(&mut out_headers, "transfer-encoding");
            header_set(
                &mut out_headers,
                "content-length",
                &raw_body.len().to_string(),
            );
            if no_cache {
                out_headers = without_cache_headers(out_headers);
            }
            let response_bytes = build_response_bytes(
                mutation.status_code,
                mutation.status_text.as_deref().unwrap_or_default(),
                &out_headers,
                Some(&raw_body),
            );
            let _ = session.write_all_bytes(&response_bytes);
            let (logged_body, _) = truncate_for_log(Some(&raw_body), true);
            let entry = traffic::build_entry(
                started_at,
                &method,
                &log_url,
                &log_scheme,
                &log_host,
                &log_path,
                Some(mutation.status_code),
                mutation.status_text.as_deref(),
                now_ms().saturating_sub(started_at),
                Some(headers_to_json(&request_headers)),
                request_body_for_log
                    .as_deref()
                    .and_then(|body| truncate_for_log(Some(body), false).0),
                Some(headers_to_json(&out_headers)),
                logged_body,
                true,
                false,
                false,
                None,
                Some(delayed_by_ms),
                rewritten_to,
                matched_ids,
                matched_names,
                None,
            );
            (deps.on_traffic)(entry);
            return true;
        }
        // 超出缓冲上限：放弃改体，直通
        let mutation = rule_engine::apply_response_mutations(
            &rule_refs,
            response.status_code,
            &mut headers_value,
            None,
        );
        let mut out_headers = json_headers_to_vec(&headers_value);
        if chunked {
            header_set(&mut out_headers, "transfer-encoding", "chunked");
        }
        if no_cache {
            out_headers = without_cache_headers(out_headers);
        }
        let head_bytes = build_response_bytes(
            mutation.status_code,
            mutation.status_text.as_deref().unwrap_or_default(),
            &out_headers,
            None,
        );
        if session.write_all_bytes(&head_bytes).is_err() {
            return false;
        }
        stream_response_body(
            session,
            &mut upstream_session,
            chunked,
            content_length,
            true,
        );
        let entry = traffic::build_entry(
            started_at,
            &method,
            &log_url,
            &log_scheme,
            &log_host,
            &log_path,
            Some(mutation.status_code),
            mutation.status_text.as_deref(),
            now_ms().saturating_sub(started_at),
            Some(headers_to_json(&request_headers)),
            request_body_for_log
                .as_deref()
                .and_then(|body| truncate_for_log(Some(body), false).0),
            Some(headers_to_json(&out_headers)),
            None,
            true,
            false,
            false,
            None,
            Some(delayed_by_ms),
            rewritten_to,
            matched_ids,
            matched_names,
            None,
        );
        (deps.on_traffic)(entry);
        return true;
    }

    // 流式转发 + 采样日志
    let mutation = rule_engine::apply_response_mutations(
        &rule_refs,
        response.status_code,
        &mut headers_value,
        None,
    );
    let mut out_headers = json_headers_to_vec(&headers_value);
    // 上游是 chunked 时自己重新分帧：逐跳头已剥掉 Transfer-Encoding，正文必须按新帧发出
    if chunked {
        header_set(&mut out_headers, "transfer-encoding", "chunked");
    }
    if no_cache {
        out_headers = without_cache_headers(out_headers);
    }
    let head_bytes = build_response_bytes(
        mutation.status_code,
        mutation.status_text.as_deref().unwrap_or_default(),
        &out_headers,
        None,
    );
    if session.write_all_bytes(&head_bytes).is_err() {
        return false;
    }

    let textual = is_textual_content_type(&response_content_type);
    let sampled = stream_response_body(
        session,
        &mut upstream_session,
        chunked,
        content_length,
        true,
    );
    let (logged_body, logged_truncated) = if textual && !sampled.1 {
        let decoded = decode_body(&sampled.0, &response_content_encoding);
        match decoded {
            Some(decoded) => truncate_for_log(Some(&decoded), false),
            None => (None, true),
        }
    } else {
        (None, true)
    };

    let entry = traffic::build_entry(
        started_at,
        &method,
        &log_url,
        &log_scheme,
        &log_host,
        &log_path,
        Some(mutation.status_code),
        mutation.status_text.as_deref(),
        now_ms().saturating_sub(started_at),
        Some(headers_to_json(&request_headers)),
        request_body_for_log
            .as_deref()
            .and_then(|body| truncate_for_log(Some(body), false).0),
        Some(headers_to_json(&out_headers)),
        logged_body,
        logged_truncated,
        false,
        false,
        None,
        Some(delayed_by_ms),
        rewritten_to,
        matched_ids,
        matched_names,
        None,
    );
    (deps.on_traffic)(entry);
    true
}

/// 包装上游流为 Session 可用的 Stream
struct UpstreamWrapper(Upstream);

impl Read for UpstreamWrapper {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buf)
    }
}

impl Write for UpstreamWrapper {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

impl Stream for UpstreamWrapper {
    fn shutdown_handle(&self) -> Option<TcpStream> {
        None
    }

    fn set_timeout(&self, _timeout: Option<Duration>) {}
}

/// 流式转发响应体到客户端，返回（采样字节，是否超限）
fn stream_response_body(
    session: &mut Session,
    upstream: &mut Session,
    chunked: bool,
    content_length: Option<usize>,
    reframe_chunked: bool,
) -> (Vec<u8>, bool) {
    let mut sampled: Vec<u8> = Vec::new();
    let mut truncated = false;

    if chunked {
        // chunked：解帧后按需重新分帧（剥掉 Transfer-Encoding 时必须重帧，否则客户端把分帧当正文）
        let mut collected: Vec<u8> = Vec::new();
        while let Ok(line) = upstream.read_line() {
            if line.is_empty() {
                break;
            }
            let size = usize::from_str_radix(line.split(';').next().unwrap_or_default().trim(), 16)
                .unwrap_or(0);
            if size == 0 {
                // 结尾块：重新分帧与原始透传都是 0 长度块 + 空行
                let _ = session.write_all_bytes(b"0\r\n\r\n");
                break;
            }
            let Ok(data) = upstream.read_exact_bytes(size) else {
                break;
            };
            let _ = upstream.read_exact_bytes(2);
            if reframe_chunked {
                let head = format!("{size:x}\r\n");
                if session.write_all_bytes(head.as_bytes()).is_err() {
                    break;
                }
                let _ = session.write_all_bytes(&data);
                let _ = session.write_all_bytes(b"\r\n");
            } else {
                let mut head = line.clone();
                head.push_str("\r\n");
                let _ = session.write_all_bytes(head.as_bytes());
                let _ = session.write_all_bytes(&data);
                let _ = session.write_all_bytes(b"\r\n");
            }
            if collected.len() + data.len() <= BUFFER_LIMIT_BYTES {
                collected.extend_from_slice(&data);
            } else {
                truncated = true;
            }
        }
        sampled = collected;
    } else if let Some(length) = content_length {
        let mut remaining = length;
        while remaining > 0 {
            let want = remaining.min(16384);
            let Ok(data) = upstream.read_exact_bytes(want) else {
                break;
            };
            if data.is_empty() {
                break;
            }
            let _ = session.write_all_bytes(&data);
            if sampled.len() + data.len() <= BUFFER_LIMIT_BYTES {
                sampled.extend_from_slice(&data);
            } else {
                truncated = true;
            }
            remaining -= data.len();
        }
    } else {
        // 无长度信息：先冲掉已预读的缓冲，再读到 EOF
        let buffered = std::mem::take(&mut upstream.buffer);
        if !buffered.is_empty() {
            let _ = session.write_all_bytes(&buffered);
            if sampled.len() + buffered.len() <= BUFFER_LIMIT_BYTES {
                sampled.extend_from_slice(&buffered);
            } else {
                truncated = true;
            }
        }
        let mut chunk = [0u8; 16384];
        loop {
            match upstream.stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    let _ = session.write_all_bytes(&chunk[..read]);
                    if sampled.len() + read <= BUFFER_LIMIT_BYTES {
                        sampled.extend_from_slice(&chunk[..read]);
                    } else {
                        truncated = true;
                    }
                }
                Err(_) => break,
            }
        }
    }

    (sampled, truncated)
}

/// 透明转发（不在名单）：不改包、不记日志、不跑规则
fn forward_transparent(
    session: &mut Session,
    request: &ParsedRequest,
    scheme: &str,
    host: &str,
    port: u16,
    path_and_query: &str,
) -> bool {
    let Ok(mut upstream) = connect_upstream(scheme, host, port) else {
        let _ = session.write_all_bytes(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        return false;
    };
    let headers = strip_hop_by_hop(&request.headers);
    let head_bytes = build_request_bytes(&request.method, path_and_query, &headers, None);
    if upstream.write_all(&head_bytes).is_err() {
        return false;
    }

    // 请求体：Content-Length 或 chunked 原样透传
    let chunked = header_get(&request.headers, "transfer-encoding")
        .map(|value| value.to_lowercase().contains("chunked"))
        .unwrap_or(false);
    if chunked {
        if let Ok(raw) = session.read_chunked_raw() {
            let _ = upstream.write_all(&raw);
        }
    } else if let Some(length) = header_get(&request.headers, "content-length")
        .and_then(|value| value.trim().parse::<usize>().ok())
    {
        if let Ok(data) = session.read_exact_bytes(length) {
            let _ = upstream.write_all(&data);
        }
    }
    let _ = upstream.flush();

    // 响应原样回传：透明转发保留上游分帧方式（只去掉连接级头）
    let mut upstream_session = Session::new(Box::new(UpstreamWrapper(upstream)));
    let Ok(Some(response_head)) = upstream_session.read_head() else {
        let _ = session.write_all_bytes(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        return false;
    };
    let Some(response) = parse_response_head(&response_head) else {
        return false;
    };
    let out_headers: Vec<(String, String)> = response
        .headers
        .iter()
        .filter(|(key, _)| {
            !matches!(
                key.to_lowercase().as_str(),
                "connection"
                    | "keep-alive"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "proxy-connection"
            )
        })
        .cloned()
        .collect();
    let head_bytes = build_response_bytes(
        response.status_code,
        &response.status_text,
        &out_headers,
        None,
    );
    if session.write_all_bytes(&head_bytes).is_err() {
        return false;
    }
    let chunked = header_get(&response.headers, "transfer-encoding")
        .map(|value| value.to_lowercase().contains("chunked"))
        .unwrap_or(false);
    let content_length = header_get(&response.headers, "content-length")
        .and_then(|value| value.trim().parse::<usize>().ok());
    let _ = stream_response_body(
        session,
        &mut upstream_session,
        chunked,
        content_length,
        false,
    );
    true
}

#[allow(clippy::too_many_arguments)]
fn respond_with_mock(
    session: &mut Session,
    matched_rules: &[&Value],
    mock_rule: &Value,
    request: &ParsedRequest,
    full_url: &str,
    scheme: &str,
    host: &str,
    path: &str,
    request_headers: &[(String, String)],
    request_body: Option<&[u8]>,
    started_at: u64,
    delay_ms: i64,
    no_cache: bool,
    matched_ids: Vec<String>,
    matched_names: Vec<String>,
    deps: &ProxyDeps,
) -> bool {
    let status_code = mock_rule
        .pointer("/response/statusCode")
        .and_then(Value::as_u64)
        .unwrap_or(200) as u16;
    let body = mock_rule
        .pointer("/response/bodyReplace")
        .and_then(Value::as_str)
        .map(|text| text.as_bytes().to_vec());
    let content_type = body
        .as_ref()
        .map(|body| {
            let text = String::from_utf8_lossy(body);
            if text.trim_start().starts_with('{') || text.trim_start().starts_with('[') {
                "application/json; charset=utf-8"
            } else {
                "text/plain; charset=utf-8"
            }
        })
        .unwrap_or("text/plain; charset=utf-8");
    let mut headers_value = headers_to_value_object(&[
        ("content-type".to_string(), content_type.to_string()),
        (
            "content-length".to_string(),
            body.as_ref()
                .map(|body| body.len())
                .unwrap_or(0)
                .to_string(),
        ),
    ]);
    let mutation =
        rule_engine::apply_response_mutations(matched_rules, status_code, &mut headers_value, body);
    let mut out_headers = json_headers_to_vec(&headers_value);
    if no_cache {
        out_headers = without_cache_headers(out_headers);
    }
    let response_bytes = build_response_bytes(
        mutation.status_code,
        mutation.status_text.as_deref().unwrap_or_default(),
        &out_headers,
        mutation.body.as_deref(),
    );
    let _ = session.write_all_bytes(&response_bytes);

    let entry = traffic::build_entry(
        started_at,
        &request.method,
        full_url,
        scheme,
        host,
        path,
        Some(mutation.status_code),
        mutation.status_text.as_deref(),
        now_ms().saturating_sub(started_at),
        Some(headers_to_json(request_headers)),
        request_body.and_then(|body| truncate_for_log(Some(body), false).0),
        Some(headers_to_json(&out_headers)),
        mutation
            .body
            .as_deref()
            .and_then(|body| truncate_for_log(Some(body), false).0),
        false,
        true,
        false,
        None,
        Some(delay_ms),
        None,
        matched_ids,
        matched_names,
        None,
    );
    (deps.on_traffic)(entry);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 极简源站：读请求头后回固定正文，并把请求路径回显到 x-path 响应头
    fn spawn_origin_server() -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                std::thread::spawn(move || {
                    let mut buffer = [0u8; 8192];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let head = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let path = head
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/")
                        .to_string();
                    let body = format!("origin-body:{path}");
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nx-path: {path}\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                });
            }
        });
        port
    }

    fn deps_for(origin: String, rules: Vec<Value>) -> ProxyDeps {
        let targets = Arc::new(Mutex::new(vec![json!({
            "id": "t1",
            "origin": origin,
            "enabled": true,
            "noCache": false,
            "createdAt": "2024-01-01T00:00:00.000Z",
        })]));
        let rules = Arc::new(Mutex::new(rules));
        ProxyDeps {
            get_targets: {
                let targets = targets.clone();
                Arc::new(move || targets.lock().unwrap().clone())
            },
            get_rules: {
                let rules = rules.clone();
                Arc::new(move || rules.lock().unwrap().clone())
            },
            on_traffic: Arc::new(|_entry| {}),
            is_own_port: Arc::new(|_port| false),
        }
    }

    /// 通过代理发一个明文 HTTP 请求，返回（状态码，响应体）
    fn proxy_request(proxy_port: u16, url: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", proxy_port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let request = format!(
            "GET {url} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nAccept: */*\r\n\r\n",
            url.trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap_or_default()
        );
        stream.write_all(request.as_bytes()).unwrap();
        let mut response = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => response.extend_from_slice(&chunk[..read]),
                Err(_) => break,
            }
        }
        let text = String::from_utf8_lossy(&response).to_string();
        let status = text
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse::<u16>().ok())
            .unwrap_or(0);
        let body = text
            .split_once("\r\n\r\n")
            .map(|(_, body)| body.to_string())
            .unwrap_or_default();
        (status, body)
    }

    #[test]
    fn forwards_plain_http_to_upstream() {
        let origin_port = spawn_origin_server();
        let origin = format!("http://127.0.0.1:{origin_port}");
        let deps = deps_for(origin.clone(), vec![]);
        let proxy_port = start(None, deps).unwrap();

        let (status, body) = proxy_request(proxy_port, &format!("{origin}/hello"));
        stop();

        assert_eq!(status, 200);
        assert_eq!(body, "origin-body:/hello");
    }

    #[test]
    fn applies_mock_rule_without_touching_upstream() {
        let origin_port = spawn_origin_server();
        let origin = format!("http://127.0.0.1:{origin_port}");
        let rules = vec![json!({
            "id": "r1",
            "name": "mock 规则",
            "enabled": true,
            "type": "response",
            "source": { "key": "url", "operator": "contains", "value": "/mocked" },
            "response": { "statusCode": 201, "bodyReplace": "mocked-body", "mock": true },
            "updatedAt": "2024-01-01T00:00:00.000Z",
        })];
        let deps = deps_for(origin.clone(), rules);
        let proxy_port = start(None, deps).unwrap();

        let (status, body) = proxy_request(proxy_port, &format!("{origin}/mocked"));
        stop();

        assert_eq!(status, 201);
        assert_eq!(body, "mocked-body");
    }
}

#[cfg(test)]
mod mitm_tests {
    use super::*;
    use rcgen::{CertificateParams, KeyPair};

    /// 自签 TLS 源站（rustls；回环上游默认跳过校验，正好配合代理行为）
    fn spawn_tls_origin() -> u16 {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::default();
        params.subject_alt_names = vec![rcgen::SanType::IpAddress("127.0.0.1".parse().unwrap())];
        let cert = params.self_signed(&key).unwrap();
        let server_config = std::sync::Arc::new(
            rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(
                    vec![rustls::pki_types::CertificateDer::from(cert.der().to_vec())],
                    rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der()).unwrap(),
                )
                .unwrap(),
        );

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let server_config = server_config.clone();
                std::thread::spawn(move || {
                    let Ok(connection) = rustls::ServerConnection::new(server_config) else {
                        return;
                    };
                    let mut tls = rustls::StreamOwned::new(connection, stream);
                    let mut buffer = [0u8; 8192];
                    let read = tls.read(&mut buffer).unwrap_or(0);
                    let head = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let path = head
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/")
                        .to_string();
                    let body = format!("tls-origin:{path}");
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = tls.write_all(response.as_bytes());
                    let _ = tls.flush();
                });
            }
        });
        port
    }

    #[test]
    fn mitm_decrypts_matched_https_connect() {
        let origin_port = spawn_tls_origin();
        let origin = format!("https://127.0.0.1:{origin_port}");
        let targets = Arc::new(Mutex::new(vec![json!({
            "id": "t1",
            "origin": origin,
            "enabled": true,
            "noCache": false,
            "createdAt": "2024-01-01T00:00:00.000Z",
        })]));
        let deps = ProxyDeps {
            get_targets: {
                let targets = targets.clone();
                Arc::new(move || targets.lock().unwrap().clone())
            },
            get_rules: Arc::new(Vec::new),
            on_traffic: Arc::new(|_entry| {}),
            is_own_port: Arc::new(|_port| false),
        };
        let proxy_port = start(None, deps).unwrap();

        // 建立 CONNECT 隧道
        let mut stream = TcpStream::connect(("127.0.0.1", proxy_port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .write_all(
                format!("CONNECT 127.0.0.1:{origin_port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                    .as_bytes(),
            )
            .unwrap();
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            let read = stream.read(&mut byte).unwrap_or(0);
            if read == 0 {
                break;
            }
            head.push(byte[0]);
            if head.len() >= 4 && &head[head.len() - 4..] == b"\r\n\r\n" {
                break;
            }
        }
        let head_text = String::from_utf8_lossy(&head).to_string();
        assert!(
            head_text.starts_with("HTTP/1.1 200"),
            "CONNECT 失败：{head_text}"
        );

        // 隧道内做 TLS（客户端不校验证书：MITM 叶证书由本机 CA 现签）
        let connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap();
        let mut tls = match connector.connect("127.0.0.1", stream) {
            Ok(tls) => tls,
            Err(error) => panic!("客户端 TLS 握手失败：{error}"),
        };
        tls.write_all(b"GET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match tls.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => response.extend_from_slice(&chunk[..read]),
                Err(_) => break,
            }
        }
        stop();

        let text = String::from_utf8_lossy(&response).to_string();
        assert!(text.starts_with("HTTP/1.1 200"), "MITM 响应异常：{text}");
        assert!(
            text.contains("tls-origin:/hello"),
            "MITM 未取到源站正文：{text}"
        );
    }
}
