// chrome-sandbox 域：通过 CDP 自动开启 chrome://extensions 的开发者模式。
// HTTP 走 127.0.0.1 的极简 GET（无需 HTTP 客户端依赖）；WebSocket 用 tungstenite 阻塞客户端。
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use tungstenite::Message;

const CDP_HTTP_TIMEOUT_MS: u64 = 5000;
const CDP_WS_TIMEOUT_MS: u64 = 8000;
const TOGGLE_SCRIPT: &str = r#"(enable) => {
  const toggle = document.querySelector('extensions-manager')?.shadowRoot
    ?.querySelector('extensions-toolbar')?.shadowRoot?.querySelector('#devMode');
  if (!toggle) return { found: false, checked: false };
  if (enable && !toggle.checked) toggle.click();
  return { found: true, checked: !!toggle.checked };
}"#;

fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

/// 极简 HTTP GET（仅用于 127.0.0.1 的 CDP 端点，Connection: close 保证读到 EOF）
fn http_get_json(port: u16, path: &str) -> Result<serde_json::Value, String> {
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
    // 分离 header / body（可能存在 chunked 编码时 CDP 不使用，直接取空行后内容）
    let payload = body
        .split_once("\r\n\r\n")
        .map(|(_, rest)| rest)
        .unwrap_or("");
    serde_json::from_str(payload).map_err(|e| format!("CDP 响应解析失败：{e}"))
}

fn wait_for_cdp(port: u16, timeout_ms: u64) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if http_get_json(port, "/json/version").is_ok() {
            return true;
        }
        sleep_ms(300);
    }
    false
}

fn is_local_debugger_url(url: &str, port: u16) -> bool {
    url.starts_with(&format!("ws://127.0.0.1:{port}/"))
        || url.starts_with(&format!("ws://localhost:{port}/"))
}

fn browser_ws_url(port: u16) -> Result<String, String> {
    let version = http_get_json(port, "/json/version")?;
    let url = version
        .get("webSocketDebuggerUrl")
        .and_then(|v| v.as_str())
        .ok_or("CDP 响应缺少 webSocketDebuggerUrl")?;
    if !is_local_debugger_url(url, port) {
        return Err("CDP 调试地址不是本机端口".into());
    }
    Ok(url.to_string())
}

/// 单次 CDP 调用：连接 → 发送 → 等待对应 id 的响应 → 关闭
fn cdp_call(
    ws_url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut socket = tungstenite::connect(ws_url)
        .map_err(|_| "CDP WebSocket 连接失败".to_string())?
        .0;
    let id = 1;
    let request = serde_json::json!({ "id": id, "method": method, "params": params });
    socket
        .send(Message::Text(request.to_string().into()))
        .map_err(|e| format!("CDP 发送失败：{e}"))?;

    let deadline = std::time::Instant::now() + Duration::from_millis(CDP_WS_TIMEOUT_MS);
    loop {
        if std::time::Instant::now() > deadline {
            return Err(format!("CDP 调用超时：{method}"));
        }
        let message = socket.read().map_err(|e| format!("CDP 读取失败：{e}"))?;
        let Message::Text(text) = message else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if parsed.get("id").and_then(|v| v.as_i64()) != Some(id) {
            continue;
        }
        let _ = socket.close(None);
        if let Some(error) = parsed.get("error") {
            return Err(error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string());
        }
        return Ok(parsed
            .get("result")
            .cloned()
            .unwrap_or(serde_json::json!({})));
    }
}

fn cdp_eval(ws_url: &str, expression: &str) -> Result<serde_json::Value, String> {
    let result = cdp_call(
        ws_url,
        "Runtime.evaluate",
        serde_json::json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
    )?;
    Ok(result
        .pointer("/result/value")
        .cloned()
        .unwrap_or(serde_json::json!(null)))
}

fn list_page_targets(port: u16) -> Vec<serde_json::Value> {
    match http_get_json(port, "/json/list") {
        Ok(serde_json::Value::Array(list)) => list
            .into_iter()
            .filter(|item| item.get("type").and_then(|v| v.as_str()) == Some("page"))
            .collect(),
        _ => Vec::new(),
    }
}

/// 判断沙箱是否已经开过开发者模式（profile 有会话 + Secure Preferences 记录）
pub fn should_skip_developer_mode_setup(sandbox_id: &str, developer_mode_enabled: bool) -> bool {
    if developer_mode_enabled {
        return true;
    }
    let profile_path = crate::chrome_sandbox::paths::sandbox_profile_path(sandbox_id);
    let sessions_dir = profile_path.join("Sessions");
    if !sessions_dir.is_dir() {
        return false;
    }
    let has_session = fs_read_dir_names(&sessions_dir)
        .iter()
        .any(|name| name.starts_with("Session_"));
    if !has_session {
        return false;
    }
    let prefs =
        std::fs::read_to_string(profile_path.join("Secure Preferences")).unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&prefs)
        .ok()
        .and_then(|prefs| {
            prefs
                .pointer("/extensions/ui/developer_mode")
                .and_then(|v| v.as_bool())
        })
        == Some(true)
}

fn fs_read_dir_names(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn focus_toggle(ws_url: &str, enable: bool) -> Option<(bool, bool)> {
    let expression = format!(
        "({TOGGLE_SCRIPT})({})",
        if enable { "true" } else { "false" }
    );
    let value = cdp_eval(ws_url, &expression).ok()?;
    Some((
        value.get("found").and_then(|v| v.as_bool())?,
        value.get("checked").and_then(|v| v.as_bool())?,
    ))
}

/// 在后台 extensions 标签页里点开开发者模式开关；成功返回 true
pub fn setup_sandbox_developer_mode(
    debug_port: Option<u16>,
    window_bounds: Option<(i32, i32, i32, i32)>,
) -> bool {
    let Some(port) = debug_port else {
        return false;
    };
    if !wait_for_cdp(port, 20_000) {
        return false;
    }

    let browser_url = match browser_ws_url(port) {
        Ok(url) => url,
        Err(_) => return false,
    };

    let created = cdp_call(
        &browser_url,
        "Target.createTarget",
        serde_json::json!({ "url": "chrome://extensions/", "background": true }),
    );
    let target_id = match created {
        Ok(result) => result
            .get("targetId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        Err(_) => String::new(),
    };

    // 等待 extensions 标签页出现在 target 列表里并拿到其 ws 地址
    let mut ws_url = None;
    for _ in 0..40 {
        if let Some(target) = list_page_targets(port).into_iter().find(|item| {
            let id_match = !target_id.is_empty()
                && item.get("id").and_then(|v| v.as_str()) == Some(&target_id);
            let url_match = item
                .get("url")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .map(|url| url.starts_with("chrome://extensions"))
                .unwrap_or(false);
            id_match || url_match
        }) {
            if let Some(url) = target.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) {
                ws_url = Some(url.to_string());
                break;
            }
        }
        sleep_ms(200);
    }
    let Some(ws_url) = ws_url else {
        close_extensions_tab(port, &browser_url, &target_id);
        return false;
    };

    // 等 #devMode 渲染出来
    let mut toggle = None;
    for _ in 0..33 {
        if let Some(state) = focus_toggle(&ws_url, false) {
            toggle = Some(state);
            if state.0 {
                break;
            }
        }
        sleep_ms(300);
    }
    let mut enabled = matches!(toggle, Some((true, true)));
    if !enabled && matches!(toggle, Some((true, false))) {
        let _ = focus_toggle(&ws_url, true);
        sleep_ms(500);
        if let Some((found, checked)) = focus_toggle(&ws_url, false) {
            enabled = found && checked;
        }
    }

    close_extensions_tab(port, &browser_url, &target_id);

    // 开发者模式流程会把窗口移到屏幕外启动，这里恢复到目标位置
    if let Some((x, y, width, height)) = window_bounds {
        let pages = list_page_targets(port);
        if let Some(page) = pages
            .iter()
            .find(|item| {
                item.get("url")
                    .and_then(|v| v.as_str())
                    .map(|url| !url.starts_with("chrome://extensions"))
                    .unwrap_or(false)
            })
            .or(pages.first())
        {
            if let Some(target) = page.get("id").and_then(|v| v.as_str()) {
                if let Ok(window) = cdp_call(
                    &browser_url,
                    "Browser.getWindowForTarget",
                    serde_json::json!({ "targetId": target }),
                ) {
                    if let Some(window_id) = window.get("windowId").and_then(|v| v.as_i64()) {
                        let _ = cdp_call(
                            &browser_url,
                            "Browser.setWindowBounds",
                            serde_json::json!({
                                "windowId": window_id,
                                "bounds": { "left": x, "top": y, "width": width, "height": height, "windowState": "normal" }
                            }),
                        );
                    }
                }
            }
        }
    }

    enabled
}

fn close_extensions_tab(port: u16, browser_url: &str, target_id: &str) {
    if !target_id.is_empty() {
        let _ = cdp_call(
            browser_url,
            "Target.closeTarget",
            serde_json::json!({ "targetId": target_id }),
        );
    }
    for _ in 0..30 {
        if !list_page_targets(port).iter().any(|item| {
            item.get("url")
                .and_then(|v| v.as_str())
                .map(|url| url.starts_with("chrome://extensions"))
                .unwrap_or(false)
        }) {
            break;
        }
        sleep_ms(100);
    }
}
