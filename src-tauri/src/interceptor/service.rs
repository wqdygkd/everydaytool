// interceptor 域：总调度（装配代理 / WS 桥 / 证书 / 名单 / 规则 / 流量），并向渲染层广播状态事件。
use super::{
    ca_trust, certs, origin, paths, proxy, rule_engine, script_compile, store, traffic, ws_bridge,
};
use serde_json::{json, Value};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;
use tauri::Emitter;

const CA_STATUS_CACHE_MS: u128 = 3_000;
/// WS 桥端口段（与 shared/interceptor.ts 的 INTERCEPTOR_WS_PORT_BASE / RANGE 一致）
const WS_PORT_BASE: u16 = 59_763;
const WS_PORT_RANGE: u16 = 5;

static INITIALIZED: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));
static CA_CACHE: LazyLock<Mutex<Option<(Instant, Value)>>> = LazyLock::new(|| Mutex::new(None));
static PORT_NOTE: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
static EXTENSION_DIR: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

fn emit(app: &tauri::AppHandle, channel: &str, payload: Value) {
    let _ = app.emit(
        "edt:event",
        json!({ "channel": channel, "payload": payload }),
    );
}

fn emit_status(app: &tauri::AppHandle) {
    emit(app, "interceptor:event:status", runtime_status());
}

fn emit_targets(app: &tauri::AppHandle) {
    emit(app, "interceptor:event:targets", json!(targets()));
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "unsupported"
    }
}

fn targets() -> Vec<Value> {
    store::load_config()
        .map(|(_, targets)| targets)
        .unwrap_or_default()
}

fn runtime_status() -> Value {
    let port_note = PORT_NOTE.lock().unwrap().clone();
    let extension_dir = EXTENSION_DIR.lock().unwrap().clone();
    json!({
        "wsPort": ws_bridge::port(),
        "proxyPort": proxy::port(),
        "proxyRunning": proxy::is_running(),
        "proxyPortNote": port_note,
        "connections": ws_bridge::connections(),
        "extensionDir": extension_dir,
    })
}

// ---------------------------------------------------------------------------
// 扩展资源目录（打包态复制到 userData 稳定路径：安装目录可变，load unpacked 的路径必须稳）
// ---------------------------------------------------------------------------

fn copy_dir_all(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let destination = target.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &destination)?;
        } else {
            std::fs::copy(&path, &destination)?;
        }
    }
    Ok(())
}

fn prepare_extension_directory(app: &tauri::AppHandle) -> String {
    let source = paths::extension_source_path(app);
    if cfg!(dev) {
        return source.to_string_lossy().to_string();
    }
    let target = paths::runtime_extension_path();
    let read_version = |dir: &std::path::Path| -> Option<String> {
        std::fs::read_to_string(dir.join("manifest.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|value| {
                value
                    .get("version")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
    };
    let source_version = read_version(&source);
    let target_version = read_version(&target);
    if target_version.is_none() || target_version != source_version {
        let _ = copy_dir_all(&source, &target);
    }
    target.to_string_lossy().to_string()
}

// ---------------------------------------------------------------------------
// 规则摘要 / 站点信息（扩展弹窗用）
// ---------------------------------------------------------------------------

fn summarize_rule(rule: &Value, scope: Option<&str>) -> Value {
    let key = rule
        .pointer("/source/key")
        .and_then(Value::as_str)
        .unwrap_or("url");
    let operator = rule
        .pointer("/source/operator")
        .and_then(Value::as_str)
        .unwrap_or("contains");
    let value = rule
        .pointer("/source/value")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let key_label = match key {
        "host" => "主机",
        "path" => "路径",
        _ => "URL",
    };
    let operator_label = match operator {
        "equals" => "等于",
        "matches" => "匹配",
        "wildcard" => "通配",
        _ => "包含",
    };
    let rule_type = rule.get("type").and_then(Value::as_str).unwrap_or_default();
    let type_label = match rule_type {
        "redirect" => "重定向",
        "replace" => "替换 URL",
        "queryParam" => "查询参数",
        "cancel" => "取消请求",
        "delay" => "延迟",
        "headers" => "修改请求 / 响应头",
        "userAgent" => "修改 User-Agent",
        "request" => "修改请求体",
        "response" => "修改响应体 / Mock",
        "script" => "动态脚本",
        _ => "",
    };
    let mut summary = json!({
        "id": rule.get("id").cloned().unwrap_or(Value::Null),
        "name": rule.get("name").cloned().unwrap_or(Value::Null),
        "type": rule_type,
        "typeLabel": type_label,
        "enabled": rule.get("enabled").and_then(Value::as_bool) == Some(true),
        "condition": format!("{key_label}{operator_label}{value}"),
        "source": rule.get("source").cloned().unwrap_or(Value::Null),
        "updatedAt": rule.get("updatedAt").cloned().unwrap_or(Value::Null),
    });
    if let Some(scope) = scope {
        summary["scope"] = json!(scope);
    }
    summary
}

fn rule_summaries() -> Vec<Value> {
    store::load_rules()
        .iter()
        .map(|rule| summarize_rule(rule, None))
        .collect()
}

fn extension_scripts() -> Vec<Value> {
    script_compile::compile_script_rules(&store::load_rules())
}

fn target_origin_host(origin_text: &str) -> String {
    url::Url::parse(origin_text)
        .ok()
        .and_then(|parsed| parsed.host_str().map(origin::normalize_host))
        .unwrap_or_default()
}

/// 当前站点的弹窗数据：origin 命中 / 同主机不同 origin / 按域可用规则
fn site_info(url_text: &str) -> Value {
    let all = targets();
    let Ok(parsed) = url::Url::parse(url_text) else {
        return json!({ "targets": [], "related": [], "rules": [], "total": all.len() });
    };
    let host = origin::normalize_host(parsed.host_str().unwrap_or_default());
    let scheme = if parsed.scheme() == "https" {
        "https"
    } else {
        "http"
    };
    let origin_text = origin::origin_of(scheme, &host, parsed.port().map(|port| port as i64));

    let mut matched = Vec::new();
    let mut related = Vec::new();
    for target in &all {
        let target_origin = target
            .get("origin")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if target_origin == origin_text {
            matched.push(target.clone());
        } else if target_origin_host(target_origin) == host {
            related.push(target.clone());
        }
    }

    let mut rules: Vec<Value> = store::load_rules()
        .iter()
        .filter_map(|rule| {
            rule_engine::rule_applies_to_host(rule, &host)
                .map(|scope| summarize_rule(rule, Some(scope)))
        })
        .collect();
    rules.sort_by_key(|rule| {
        if rule.get("scope").and_then(Value::as_str) == Some("site") {
            0
        } else {
            1
        }
    });

    json!({
        "targets": matched,
        "related": related,
        "rules": rules,
        "total": all.len(),
    })
}

// ---------------------------------------------------------------------------
// WS 桥消息处理（扩展弹窗的增删改直接落盘并广播）
// ---------------------------------------------------------------------------

fn handle_ws_message(app: &tauri::AppHandle, kind: &str, message: Value) {
    match kind {
        "connections-changed" => emit_status(app),
        "proxy-state-reported" => {
            let client_id = message
                .get("clientId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let enabled = message
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let error = message
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or_default();
            log::warn!(
                "[interceptor] 扩展代理状态：clientId={client_id} enabled={enabled} error={error}"
            );
        }
        "add-target" => {
            let url = message
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let _ = add_target_from_url(url);
            broadcast_targets(app);
        }
        "target-toggle" => {
            let id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let enabled = message
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let _ = update_target(id, &json!({ "enabled": enabled }));
            broadcast_targets(app);
        }
        "target-remove-id" => {
            let id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let _ = remove_target(id);
            broadcast_targets(app);
        }
        "rule-toggle" => {
            let id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let enabled = message
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if let Some(rule) = store::load_rules()
                .into_iter()
                .find(|rule| rule.get("id").and_then(Value::as_str) == Some(id))
            {
                let mut next = rule;
                next["enabled"] = json!(enabled);
                next["updatedAt"] = json!(crate::iso_time::now_iso());
                let _ = store::upsert_rule(next);
                sync_rules_to_extension();
            }
        }
        "rule-remove" => {
            let id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let _ = store::delete_rule(id);
            sync_rules_to_extension();
        }
        _ => {}
    }
}

fn sync_rules_to_extension() {
    ws_bridge::broadcast(&json!({ "type": "scripts-sync", "scripts": extension_scripts() }));
    ws_bridge::broadcast(&json!({ "type": "rules-sync", "rules": rule_summaries() }));
}

/// 名单变更统一出口：扩展（targets-sync）+ 渲染层（EVENT_TARGETS），并让旧隧道失效
fn broadcast_targets(app: &tauri::AppHandle) {
    let closed = proxy::close_transparent_tunnels();
    if closed > 0 {
        log::warn!("[interceptor] 名单变更后断开透传隧道 {closed} 条");
    }
    ws_bridge::broadcast(&json!({ "type": "targets-sync", "targets": targets() }));
    emit_targets(app);
}

// ---------------------------------------------------------------------------
// 名单
// ---------------------------------------------------------------------------

fn add_target_from_url(url_text: &str) -> Option<Value> {
    let parsed = url::Url::parse(url_text).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let scheme = if parsed.scheme() == "https" {
        "https"
    } else {
        "http"
    };
    let origin_text = origin::origin_of(
        scheme,
        parsed.host_str()?,
        parsed.port().map(|port| port as i64),
    );
    add_target(&origin_text).ok().flatten()
}

/// 新增名单条目（origin 级）：已存在则视为幂等
fn add_target(raw_origin: &str) -> Result<Option<Value>, String> {
    let Some(origin_text) = origin::parse_target_origin(raw_origin) else {
        return Ok(None);
    };
    let (proxy_port, mut list) = store::load_config()?;
    if let Some(existing) = list
        .iter()
        .find(|target| target.get("origin").and_then(Value::as_str) == Some(origin_text.as_str()))
    {
        return Ok(Some(existing.clone()));
    }
    let target = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "origin": origin_text,
        "enabled": true,
        // 默认强制回源：不开的话浏览器命中缓存就没有请求，流量页会莫名空白
        "noCache": true,
        "createdAt": crate::iso_time::now_iso(),
    });
    list.push(target.clone());
    store::save_config(proxy_port, &list)?;
    Ok(Some(target))
}

fn update_target(target_id: &str, patch: &Value) -> Result<bool, String> {
    let (proxy_port, mut list) = store::load_config()?;
    let Some(target) = list
        .iter_mut()
        .find(|target| target.get("id").and_then(Value::as_str) == Some(target_id))
    else {
        return Ok(false);
    };
    if let Some(enabled) = patch.get("enabled").and_then(Value::as_bool) {
        target["enabled"] = json!(enabled);
    }
    if let Some(no_cache) = patch.get("noCache").and_then(Value::as_bool) {
        target["noCache"] = json!(no_cache);
    }
    store::save_config(proxy_port, &list)?;
    Ok(true)
}

fn remove_target(target_id: &str) -> Result<bool, String> {
    let (proxy_port, list) = store::load_config()?;
    let before = list.len();
    let next: Vec<Value> = list
        .into_iter()
        .filter(|target| target.get("id").and_then(Value::as_str) != Some(target_id))
        .collect();
    if next.len() == before {
        return Ok(false);
    }
    store::save_config(proxy_port, &next)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// CA
// ---------------------------------------------------------------------------

fn get_ca_status(force: bool) -> Value {
    if !force {
        if let Some((at, status)) = CA_CACHE.lock().unwrap().as_ref() {
            if at.elapsed().as_millis() < CA_STATUS_CACHE_MS {
                return status.clone();
            }
        }
    }

    let status = if !certs::is_root_ca_generated() {
        json!({
            "generated": false,
            "platform": platform_name(),
            "trustState": "not-found",
            "fingerprint": "",
            "commonName": "edt Interceptor CA",
            "certPath": "",
        })
    } else {
        match certs::read_root_ca() {
            Some(root) => {
                let trust = ca_trust::get_ca_trust_state(&root.fingerprint);
                json!({
                    "generated": true,
                    "platform": platform_name(),
                    "trustState": trust.state,
                    "fingerprint": root.fingerprint,
                    "commonName": "edt Interceptor CA",
                    "certPath": paths::ca_cert_path().to_string_lossy(),
                    "detail": trust.detail,
                })
            }
            None => json!({
                "generated": false,
                "platform": platform_name(),
                "trustState": "not-found",
                "fingerprint": "",
                "commonName": "edt Interceptor CA",
                "certPath": "",
            }),
        }
    };

    *CA_CACHE.lock().unwrap() = Some((Instant::now(), status.clone()));
    status
}

fn install_ca(app: &tauri::AppHandle) -> Result<Value, String> {
    certs::ensure_root_ca()?;
    let cert_path = paths::ca_cert_path().to_string_lossy().to_string();
    let result = ca_trust::install_ca_trust(&cert_path);
    *CA_CACHE.lock().unwrap() = None;
    let status = get_ca_status(true);
    emit_status(app);
    Ok(json!({
        "ok": result.ok,
        "canceled": result.canceled,
        "detail": result.detail,
        "status": status,
    }))
}

fn uninstall_ca(app: &tauri::AppHandle) -> Result<Value, String> {
    let Some(root) = certs::read_root_ca() else {
        let status = get_ca_status(true);
        return Ok(json!({ "ok": true, "status": status }));
    };
    let result = ca_trust::uninstall_ca_trust(&root.fingerprint);
    *CA_CACHE.lock().unwrap() = None;
    let status = get_ca_status(true);
    emit_status(app);
    Ok(json!({
        "ok": result.ok,
        "canceled": result.canceled,
        "detail": result.detail,
        "status": status,
    }))
}

// ---------------------------------------------------------------------------
// 代理端口
// ---------------------------------------------------------------------------

fn proxy_deps(app: tauri::AppHandle) -> proxy::ProxyDeps {
    let traffic_app = app.clone();
    proxy::ProxyDeps {
        get_targets: Arc::new(targets),
        get_rules: Arc::new(store::load_rules),
        on_traffic: Arc::new(move |entry: Value| {
            traffic::add_entry(entry.clone());
            emit(&traffic_app, "interceptor:event:traffic", entry);
        }),
        is_own_port: Arc::new(|port: u16| {
            proxy::port() == Some(port) || ws_bridge::port() == Some(port)
        }),
    }
}

/// 按配置启动代理：配置端口可用则沿用（固定不变），不可用则重新随机一个并落盘
fn start_proxy_on_configured_port(app: &tauri::AppHandle) -> Result<(), String> {
    let (configured, _) = store::load_config()?;
    if let Some(port) = configured {
        let port = port as u16;
        match proxy::start(Some(port), proxy_deps(app.clone())) {
            Ok(_) => {
                *PORT_NOTE.lock().unwrap() = None;
                return Ok(());
            }
            Err(error) => {
                *PORT_NOTE.lock().unwrap() = Some(format!("端口 {port} 不可用，已改用随机端口"));
                log::warn!("[interceptor] 配置端口不可用：{error}");
            }
        }
    }
    let assigned = proxy::start(None, proxy_deps(app.clone()))?;
    let (_, list) = store::load_config()?;
    store::save_config(Some(assigned as i64), &list)?;
    Ok(())
}

fn change_proxy_port(app: &tauri::AppHandle, next_port: i64) -> Value {
    if !(1024..=65535).contains(&next_port) {
        return json!({
            "ok": false,
            "error": "端口需在 1024–65535 之间",
            "status": runtime_status(),
        });
    }
    let previous = proxy::port();
    if previous == Some(next_port as u16) {
        return json!({ "ok": true, "status": runtime_status() });
    }
    proxy::stop();
    match proxy::start(Some(next_port as u16), proxy_deps(app.clone())) {
        Ok(_) => {
            if let Ok((_, list)) = store::load_config() {
                let _ = store::save_config(Some(next_port), &list);
            }
            *PORT_NOTE.lock().unwrap() = None;
            // 已连接的扩展要按新端口重新挂载，否则浏览器仍会把流量发往旧端口
            ws_bridge::broadcast(&json!({ "type": "proxy-port", "proxyPort": next_port }));
            emit_status(app);
            json!({ "ok": true, "status": runtime_status() })
        }
        Err(error) => {
            // 回滚原端口（不让用户把代理弄停）
            if let Some(previous) = previous {
                let _ = proxy::start(Some(previous), proxy_deps(app.clone()));
            }
            emit_status(app);
            json!({
                "ok": false,
                "error": format!("端口 {next_port} 不可用：{error}"),
                "status": runtime_status(),
            })
        }
    }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

pub fn initialize(app: &tauri::AppHandle) {
    {
        let mut initialized = INITIALIZED.lock().unwrap();
        if *initialized {
            return;
        }
        *initialized = true;
    }

    if let Err(error) = store::load_config() {
        log::warn!("[interceptor] 配置加载失败：{error}");
    }
    if let Err(error) = store::migrate_legacy_scripts() {
        log::warn!("[interceptor] 旧版脚本迁移失败：{error}");
    }

    let extension_dir = prepare_extension_directory(app);
    *EXTENSION_DIR.lock().unwrap() = Some(extension_dir);

    if let Err(error) = start_proxy_on_configured_port(app) {
        *PORT_NOTE.lock().unwrap() = Some("代理启动失败，请在状态页检查端口".into());
        log::error!("[interceptor] 代理启动失败：{error}");
    }

    // 扩展数据源
    ws_bridge::set_handlers(
        Arc::new(targets),
        Arc::new(extension_scripts),
        Arc::new(rule_summaries),
        Arc::new(site_info),
    );

    let ws_app = app.clone();
    let handler: ws_bridge::HandlerFn =
        Arc::new(move |_app: &tauri::AppHandle, kind: &str, message: Value| {
            handle_ws_message(&ws_app, kind, message);
        });
    match ws_bridge::start(app, WS_PORT_BASE, WS_PORT_RANGE, handler) {
        Ok(port) => log::info!("[interceptor] WS 桥已启动：{port}"),
        Err(error) => log::error!("[interceptor] WS 桥启动失败：{error}"),
    }

    emit_status(app);
}

/// 数据目录切换后：重置缓存与存储，按新配置重启代理
pub fn on_data_directory_changed(app: &tauri::AppHandle) {
    store::reset_caches();
    certs::reset_cert_caches();
    traffic::clear();
    *CA_CACHE.lock().unwrap() = None;
    *EXTENSION_DIR.lock().unwrap() = None;

    let extension_dir = prepare_extension_directory(app);
    *EXTENSION_DIR.lock().unwrap() = Some(extension_dir);

    proxy::stop();
    if let Err(error) = start_proxy_on_configured_port(app) {
        *PORT_NOTE.lock().unwrap() = Some("代理重启失败，请在状态页检查端口".into());
        log::error!("[interceptor] 数据目录切换后代理重启失败：{error}");
    }
    emit_status(app);
}

pub fn dispose() {
    ws_bridge::stop();
    proxy::stop();
}

// ---------------------------------------------------------------------------
// 命令分发
// ---------------------------------------------------------------------------

// ── 命令入参结构校验（渲染层传来的规则 / 开关补丁）──────────────────────────────
//
// 坏形态落到规则引擎只会静默失效（表现为「规则不生效但没报错」），因此在边界上先拦：
// 类型枚举 / 必填字段 / 文本长度都有上限，子配置只要求「是普通对象」——
// 具体字段由规则引擎按类型各自解释，这里不做业务校验。

const RULE_TYPES: [&str; 10] = [
    "redirect",
    "replace",
    "queryParam",
    "cancel",
    "delay",
    "headers",
    "userAgent",
    "request",
    "response",
    "script",
];
const MAX_ID_LENGTH: usize = 200;
const MAX_NAME_LENGTH: usize = 500;
const MAX_DESCRIPTION_LENGTH: usize = 2_000;

fn require_object<'a>(value: &'a Value, field: &str) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("参数不合法：{field}"))
}

fn require_field_string(value: &Value, field: &str, max_len: usize) -> Result<String, String> {
    let text = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("参数不合法：{field}"))?;
    if text.chars().count() > max_len {
        return Err(format!("参数不合法：{field}"));
    }
    Ok(text.to_string())
}

fn assert_rule_payload(rule: &Value) -> Result<(), String> {
    let object = require_object(rule, "rule")?;
    let rule_type = require_field_string(
        object.get("type").unwrap_or(&Value::Null),
        "rule.type",
        MAX_ID_LENGTH,
    )?;
    if !RULE_TYPES.contains(&rule_type.as_str()) {
        return Err("参数不合法：rule.type".into());
    }
    let _id = require_field_string(
        object.get("id").unwrap_or(&Value::Null),
        "rule.id",
        MAX_ID_LENGTH,
    )?;
    let _name = require_field_string(
        object.get("name").unwrap_or(&Value::Null),
        "rule.name",
        MAX_NAME_LENGTH,
    )?;
    if let Some(description) = object.get("description").and_then(Value::as_str) {
        if description.chars().count() > MAX_DESCRIPTION_LENGTH {
            return Err("参数不合法：rule.description".into());
        }
    }
    if let Some(enabled) = object.get("enabled") {
        if !enabled.is_boolean() {
            return Err("参数不合法：rule.enabled".into());
        }
    }
    for key in [
        "filters",
        "redirect",
        "replace",
        "queryParam",
        "delay",
        "headers",
        "userAgent",
        "request",
        "response",
        "script",
    ] {
        if let Some(value) = object.get(key) {
            if !value.is_null() && !value.is_object() {
                return Err(format!("参数不合法：rule.{key}"));
            }
        }
    }
    Ok(())
}

fn assert_target_patch(patch: &Value) -> Result<(), String> {
    let object = require_object(patch, "patch")?;
    for key in ["enabled", "noCache"] {
        if let Some(value) = object.get(key) {
            if !value.is_boolean() {
                return Err(format!("参数不合法：patch.{key}"));
            }
        }
    }
    Ok(())
}

pub fn handle(app: &tauri::AppHandle, command: &str, args: &[Value]) -> Result<Value, String> {
    match command {
        "interceptor:status:get" => Ok(runtime_status()),

        "interceptor:ca:status" => Ok(get_ca_status(false)),
        "interceptor:ca:install" => install_ca(app),
        "interceptor:ca:uninstall" => uninstall_ca(app),
        "interceptor:ca:export" => {
            use tauri_plugin_dialog::DialogExt;
            let picked = app
                .dialog()
                .file()
                .set_title("导出根证书（手动导入兜底用）")
                .set_file_name(paths::CA_EXPORT_FILE_NAME)
                .add_filter("证书", &["crt", "pem"])
                .blocking_save_file();
            let Some(path) = picked else {
                return Ok(Value::Null);
            };
            let root = certs::ensure_root_ca()?;
            let destination = path.to_string();
            std::fs::write(&destination, &root.cert_pem)
                .map_err(|error| format!("导出证书失败：{error}"))?;
            Ok(json!(destination))
        }

        "interceptor:targets:get" => {
            store::load_config()?;
            Ok(json!(targets()))
        }
        "interceptor:targets:add" => {
            let raw = args
                .first()
                .and_then(Value::as_str)
                .ok_or("缺少 origin 参数")?;
            let existed = {
                let (_, list) = store::load_config()?;
                let parsed = origin::parse_target_origin(raw);
                list.iter().any(|target| {
                    parsed.is_some()
                        && target.get("origin").and_then(Value::as_str) == parsed.as_deref()
                })
            };
            let target = add_target(raw)?;
            broadcast_targets(app);
            Ok(json!({ "targets": targets(), "target": target, "existed": existed }))
        }
        "interceptor:targets:remove" => {
            let id = args
                .first()
                .and_then(Value::as_str)
                .ok_or("缺少 targetId 参数")?;
            remove_target(id)?;
            broadcast_targets(app);
            Ok(json!(targets()))
        }
        "interceptor:targets:update" => {
            let id = args
                .first()
                .and_then(Value::as_str)
                .ok_or("缺少 targetId 参数")?;
            let patch = args.get(1).cloned().unwrap_or(json!({}));
            assert_target_patch(&patch)?;
            update_target(id, &patch)?;
            broadcast_targets(app);
            Ok(json!(targets()))
        }

        "interceptor:rules:get" => Ok(json!(store::load_rules())),
        "interceptor:rules:upsert" => {
            let mut rule = args.first().cloned().ok_or("缺少规则内容")?;
            assert_rule_payload(&rule)?;
            rule["updatedAt"] = json!(crate::iso_time::now_iso());
            let rules = store::upsert_rule(rule)?;
            sync_rules_to_extension();
            Ok(json!(rules))
        }
        "interceptor:rules:delete" => {
            let id = args
                .first()
                .and_then(Value::as_str)
                .ok_or("缺少 ruleId 参数")?;
            let rules = store::delete_rule(id)?;
            sync_rules_to_extension();
            Ok(json!(rules))
        }

        "interceptor:traffic:get" => Ok(json!(traffic::list())),
        "interceptor:traffic:clear" => {
            traffic::clear();
            Ok(json!(true))
        }

        "interceptor:proxy:set-desired" => {
            let enabled = args
                .first()
                .and_then(Value::as_bool)
                .ok_or("缺少 enabled 参数")?;
            ws_bridge::broadcast(&json!({ "type": "set-proxy", "enabled": enabled }));
            Ok(json!(ws_bridge::port().is_some()))
        }
        "interceptor:proxy:port:set" => {
            let port = args
                .first()
                .and_then(Value::as_i64)
                .ok_or("缺少 port 参数")?;
            Ok(change_proxy_port(app, port))
        }

        "interceptor:extension:open-dir" => {
            let Some(dir) = EXTENSION_DIR.lock().unwrap().clone() else {
                return Ok(json!(false));
            };
            match open_directory(&dir) {
                Ok(()) => Ok(json!(true)),
                Err(error) => {
                    log::warn!("[interceptor] 打开扩展目录失败：{error}");
                    Ok(json!(false))
                }
            }
        }

        other => Err(format!("未实现的 interceptor 命令：{other}")),
    }
}

/// 应用退出前的清理入口（lib.rs 调用）
pub fn shutdown(app: &tauri::AppHandle) {
    let _ = app;
    dispose();
}

/// 供 lib.rs 在窗口创建后触发初始化
pub fn setup(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        // 让主窗口先完成首帧，避免初始化阻塞启动
        std::thread::sleep(std::time::Duration::from_millis(300));
        initialize(&handle);
    });
}

/// 供外部（数据目录变更）读取扩展目录
pub fn extension_dir() -> Option<String> {
    EXTENSION_DIR.lock().unwrap().clone()
}

/// 供外部读取当前运行时状态（调试 / 测试用）
pub fn status_snapshot() -> Value {
    runtime_status()
}

/// 在系统文件管理器中打开目录（Windows 走 explorer，避免 Shell API 阻塞）
fn open_directory(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = path;
        Err("当前平台暂不支持打开目录".into())
    }
}

#[cfg(test)]
mod payload_validation_tests {
    use super::{assert_rule_payload, assert_target_patch};
    use serde_json::json;

    #[test]
    fn accepts_well_formed_rule() {
        assert!(assert_rule_payload(&json!({
            "id": "rule-1",
            "name": "重定向到本地",
            "type": "redirect",
            "enabled": true,
            "redirect": { "to": "http://127.0.0.1:3000" }
        }))
        .is_ok());
    }

    #[test]
    fn rejects_unknown_type_and_missing_fields() {
        assert!(assert_rule_payload(&json!({
            "id": "r", "name": "n", "type": "unknown"
        }))
        .is_err());
        assert!(assert_rule_payload(&json!({ "name": "n", "type": "cancel" })).is_err());
        assert!(assert_rule_payload(&json!({ "id": "r", "type": "cancel" })).is_err());
        assert!(assert_rule_payload(&json!("not-an-object")).is_err());
    }

    #[test]
    fn rejects_oversized_and_mistyped_fields() {
        let long_name = "x".repeat(501);
        assert!(assert_rule_payload(&json!({
            "id": "r", "name": long_name, "type": "cancel"
        }))
        .is_err());
        // 子配置必须是普通对象
        assert!(assert_rule_payload(&json!({
            "id": "r", "name": "n", "type": "headers", "headers": "bad"
        }))
        .is_err());
        // 布尔字段类型必须正确
        assert!(assert_rule_payload(&json!({
            "id": "r", "name": "n", "type": "cancel", "enabled": "yes"
        }))
        .is_err());
    }

    #[test]
    fn target_patch_only_accepts_known_booleans() {
        assert!(assert_target_patch(&json!({ "enabled": true, "noCache": false })).is_ok());
        assert!(assert_target_patch(&json!({ "enabled": 1 })).is_err());
        assert!(assert_target_patch(&json!([])).is_err());
    }
}
