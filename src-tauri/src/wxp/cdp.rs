// wxp-enhancer 域：CDP 客户端（短连接调用，对齐 Node 版 cdp-client.ts）。
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use tungstenite::Message;

const CDP_HTTP_TIMEOUT_MS: u64 = 5000;
const CDP_WS_TIMEOUT_MS: u64 = 15_000;

pub struct Target {
    pub id: String,
    pub url: String,
    pub type_: String,
    pub ws_url: String,
}

/// 极简 HTTP GET（仅 127.0.0.1 的 CDP 端点）
fn http_get(port: u16, path: &str) -> Result<Value, String> {
    let address = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect(&address).map_err(|e| format!("CDP 连接失败：{e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(CDP_HTTP_TIMEOUT_MS)))
        .map_err(|e| e.to_string())?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("CDP 请求发送失败：{e}"))?;
    let mut body = String::new();
    stream
        .read_to_string(&mut body)
        .map_err(|e| format!("CDP 响应读取失败：{e}"))?;
    let payload = body
        .split_once("\r\n\r\n")
        .map(|(_, rest)| rest)
        .unwrap_or("");
    serde_json::from_str(payload).map_err(|e| format!("CDP 响应解析失败：{e}"))
}

fn is_local_debugger_url(url: &str, port: u16) -> bool {
    url.starts_with(&format!("ws://127.0.0.1:{port}/"))
        || url.starts_with(&format!("ws://localhost:{port}/"))
}

/// 只信任本机同端口的可调试目标（page / iframe）
pub fn fetch_targets(port: u16) -> Result<Vec<Target>, String> {
    let list = http_get(port, "/json")?;
    let mut targets = Vec::new();
    if let Some(items) = list.as_array() {
        for item in items {
            let type_ = item.get("type").and_then(Value::as_str).unwrap_or_default();
            if type_ != "page" && type_ != "iframe" {
                continue;
            }
            let ws_url = item
                .get("webSocketDebuggerUrl")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !is_local_debugger_url(ws_url, port) {
                continue;
            }
            targets.push(Target {
                id: item
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                url: item
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                type_: type_.to_string(),
                ws_url: ws_url.to_string(),
            });
        }
    }
    Ok(targets)
}

/// 单次 CDP 调用：连接 → 发送 → 等待响应 → 关闭（与 Node 版一致的短连接语义）
fn cdp_call(ws_url: &str, method: &str, params: Value) -> Result<Value, String> {
    let mut socket = tungstenite::connect(ws_url)
        .map_err(|_| format!("WebSocket 连接失败: {ws_url}"))?
        .0;
    let id = 1;
    let request = serde_json::json!({ "id": id, "method": method, "params": params });
    socket
        .send(Message::Text(request.to_string().into()))
        .map_err(|e| format!("CDP 发送失败：{e}"))?;
    let deadline = std::time::Instant::now() + Duration::from_millis(CDP_WS_TIMEOUT_MS);
    loop {
        if std::time::Instant::now() > deadline {
            return Err(format!("CDP 超时: {method}"));
        }
        let message = socket.read().map_err(|e| format!("CDP 读取失败：{e}"))?;
        let Message::Text(text) = message else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if parsed.get("id").and_then(Value::as_i64) != Some(id) {
            continue;
        }
        let _ = socket.close(None);
        if let Some(error) = parsed.get("error") {
            return Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("CDP 调用失败")
                .to_string());
        }
        return Ok(parsed
            .get("result")
            .cloned()
            .unwrap_or(serde_json::json!({})));
    }
}

/// 向单个目标注入脚本：Page.enable → 移除旧标识 → addScriptOnNewDocument → 立即求值
pub fn inject_target(
    ws_url: &str,
    source: &str,
    previous_identifier: Option<&str>,
) -> Result<String, String> {
    cdp_call(ws_url, "Page.enable", serde_json::json!({}))?;
    if let Some(identifier) = previous_identifier {
        // 旧标识可能已失效，忽略错误
        let _ = cdp_call(
            ws_url,
            "Page.removeScriptToEvaluateOnNewDocument",
            serde_json::json!({ "identifier": identifier }),
        );
    }
    let result = cdp_call(
        ws_url,
        "Page.addScriptToEvaluateOnNewDocument",
        serde_json::json!({ "source": source }),
    )?;
    let identifier = result
        .get("identifier")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    cdp_call(
        ws_url,
        "Runtime.evaluate",
        serde_json::json!({ "expression": source, "returnByValue": true }),
    )?;
    Ok(identifier)
}

/// 存活探针：注入脚本的版本指纹是否仍在当前文档执行
pub fn probe_injection_alive(ws_url: &str, rev: u32) -> bool {
    cdp_call(
        ws_url,
        "Runtime.evaluate",
        serde_json::json!({
            "expression": format!("!!(window.__wxpEnv&&window.__wxpEnv.rev==={rev})"),
            "returnByValue": true,
        }),
    )
    .ok()
    .and_then(|result| result.pointer("/result/value").and_then(Value::as_bool))
    .unwrap_or(false)
}

/// 在全部可调试页面执行表达式，返回成功求值的页面数
pub fn evaluate_in_page_targets(port: u16, expression: &str) -> Result<usize, String> {
    let targets = fetch_targets(port)?;
    let mut evaluated = 0;
    for target in &targets {
        if target.ws_url.is_empty() {
            continue;
        }
        if cdp_call(
            &target.ws_url,
            "Runtime.evaluate",
            serde_json::json!({ "expression": expression, "returnByValue": true }),
        )
        .is_ok()
        {
            evaluated += 1;
        }
    }
    Ok(evaluated)
}

/// 在 WXP 主页面（app:// 优先）执行表达式并返回求值结果
pub fn evaluate_on_main_page(port: u16, expression: &str) -> Result<Value, String> {
    let targets = fetch_targets(port)?;
    let pages: Vec<&Target> = targets
        .iter()
        .filter(|item| item.type_ == "page" && !item.url.starts_with("devtools://"))
        .collect();
    let main = pages
        .iter()
        .find(|item| item.url.starts_with("app://"))
        .or(pages.first())
        .ok_or("未找到可调试的 WXP 页面，请确认 WXP 已完全启动")?;
    if main.ws_url.is_empty() {
        return Err("未找到可调试的 WXP 页面，请确认 WXP 已完全启动".into());
    }
    let result = cdp_call(
        &main.ws_url,
        "Runtime.evaluate",
        serde_json::json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
    )?;
    if let Some(details) = result.get("exceptionDetails") {
        let description = details
            .pointer("/exception/description")
            .and_then(Value::as_str)
            .or_else(|| details.get("text").and_then(Value::as_str))
            .unwrap_or("未知错误");
        return Err(format!("采集脚本执行失败: {description}"));
    }
    Ok(result
        .pointer("/result/value")
        .cloned()
        .unwrap_or(Value::Null))
}

/// 轮询等待 CDP 端口出现可用页面
pub fn wait_for_cdp_port(port: u16, timeout_ms: u64) -> Result<Vec<Target>, String> {
    let started = std::time::Instant::now();
    while (started.elapsed().as_millis() as u64) < timeout_ms {
        if let Ok(targets) = fetch_targets(port) {
            if !targets.is_empty() {
                return Ok(targets);
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(format!("CDP 端口 {port} 在 {timeout_ms}ms 内无可用页面"))
}
