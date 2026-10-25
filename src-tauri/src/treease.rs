// treease-editor 接口拦截（Tauri 版）：
// 旧版通过协议层接管 HTTP(S)（协议改写 / 屏蔽）。
// Tauri/WebView2 没有等价的公开协议拦截 API，这里改为在 treease webview 页面最早时刻
// 注入 fetch / XHR 拦截运行时（assets/treease-interceptor.js），规则语义保持一致：
//   - modify：命中 URL 的 JSON 响应按 patches 改写后返回
//   - block：命中后直接返回 403（不向上游发起请求）
// 命中计数由注入运行时统计，Rust 侧轮询并通过 treease:intercept-log 事件回推。
use crate::webviews::{eval_script, get_webview, WebviewMap};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const WEBVIEW_ID: &str = "treease";
const MAX_RULES: usize = 200;
const MAX_PATTERN_LENGTH: usize = 512;

#[derive(Default)]
pub struct TreeaseState {
    pub active: AtomicBool,
    pub rule_count: AtomicUsize,
    pub hits: AtomicI64,
    pub poller_started: AtomicBool,
}

fn sanitize_rules(raw: &Value) -> Vec<Value> {
    let Some(list) = raw.as_array() else {
        return Vec::new();
    };
    list.iter()
        .take(MAX_RULES)
        .filter_map(|rule| {
            let pattern = rule.get("urlPattern")?.as_str()?.trim();
            if pattern.is_empty() {
                return None;
            }
            let pattern = if pattern.chars().count() > MAX_PATTERN_LENGTH {
                pattern.chars().take(MAX_PATTERN_LENGTH).collect::<String>()
            } else {
                pattern.to_string()
            };
            let action = if rule.get("action").and_then(|v| v.as_str()) == Some("block") {
                "block"
            } else {
                "modify"
            };
            let patches: Vec<Value> = rule
                .get("patches")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter(|patch| {
                            patch
                                .get("path")
                                .and_then(|v| v.as_str())
                                .map(|p| !p.trim().is_empty())
                                .unwrap_or(false)
                        })
                        .take(64)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            Some(json!({
                "id": rule.get("id").cloned().unwrap_or(Value::Null),
                "name": rule.get("name").cloned().unwrap_or(Value::Null),
                "enabled": rule.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                "urlPattern": pattern,
                "action": action,
                "patches": patches,
            }))
        })
        .collect()
}

fn apply_rules(map: &WebviewMap, rules: &[Value], reset_hits: bool) -> Result<(), String> {
    let webview = get_webview(map, WEBVIEW_ID)?;
    let script = format!(
        "window.__edtTreease ? (window.__edtTreease.setRules({}, {}), true) : false",
        serde_json::to_string(rules).map_err(|e| e.to_string())?,
        reset_hits
    );
    let raw = eval_script(webview, &script)?;
    let envelope: Value =
        serde_json::from_str(&raw).map_err(|_| "拦截运行时返回格式不正确".to_string())?;
    if envelope.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(envelope
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("拦截运行时执行失败")
            .to_string());
    }
    if envelope.get("value").and_then(Value::as_bool) != Some(true) {
        return Err("拦截运行时未注入（请刷新页面后重试）".into());
    }
    Ok(())
}

fn read_status(map: &WebviewMap) -> Option<Value> {
    let webview = get_webview(map, WEBVIEW_ID).ok()?;
    let raw = eval_script(
        webview,
        "window.__edtTreease ? window.__edtTreease.status() : null",
    )
    .ok()?;
    let envelope: Value = serde_json::from_str(&raw).ok()?;
    let inner = envelope.get("value")?.clone();
    if inner.is_null() {
        None
    } else {
        Some(inner)
    }
}

fn active_rule_count(rules: &[Value]) -> usize {
    rules
        .iter()
        .filter(|rule| {
            if rule.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
                return false;
            }
            if rule.get("action").and_then(|v| v.as_str()) == Some("block") {
                return true;
            }
            rule.get("patches")
                .and_then(|v| v.as_array())
                .map(|p| !p.is_empty())
                .unwrap_or(false)
        })
        .count()
}

fn status_value(map: &WebviewMap, state: &TreeaseState) -> Value {
    if let Some(mut status) = read_status(map) {
        status["webviewId"] = json!(1);
        return status;
    }
    json!({
        "webviewId": 1,
        "attached": state.active.load(Ordering::SeqCst),
        "ruleCount": state.rule_count.load(Ordering::SeqCst),
        "hits": state.hits.load(Ordering::SeqCst),
    })
}

fn ensure_poller(app: AppHandle, map: WebviewMap, state: Arc<TreeaseState>) {
    if state.poller_started.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1200));
        if !state.active.load(Ordering::SeqCst) {
            continue;
        }
        let Some(status) = read_status(&map) else {
            continue;
        };
        let Some(hits) = status.get("hits").and_then(|v| v.as_i64()) else {
            continue;
        };
        let previous = state.hits.swap(hits, Ordering::SeqCst);
        if hits != previous {
            let _ = app.emit(
                "edt:event",
                json!({
                    "channel": "treease:intercept-log",
                    "payload": { "webviewId": 1, "hits": hits },
                }),
            );
        }
    });
}

pub fn handle(
    app: AppHandle,
    map: WebviewMap,
    state: Arc<TreeaseState>,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    match channel {
        "treease:intercept-start" => {
            let rules = sanitize_rules(args.get(1).unwrap_or(&Value::Null));
            let count = active_rule_count(&rules);
            if count == 0 {
                return Err("请至少启用一个接口规则（匹配 pattern，修改或屏蔽）".into());
            }
            apply_rules(&map, &rules, true)?;
            state.active.store(true, Ordering::SeqCst);
            state.rule_count.store(count, Ordering::SeqCst);
            state.hits.store(0, Ordering::SeqCst);
            ensure_poller(app, map.clone(), state.clone());
            Ok(status_value(&map, &state))
        }
        "treease:intercept-stop" => {
            // webview 已关闭或运行时未注入时，停止操作仍应把状态复位。
            if get_webview(&map, WEBVIEW_ID).is_ok() {
                if let Err(error) = apply_rules(&map, &[], true) {
                    log::warn!("[treease] reset rules failed: {error}");
                }
            }
            state.active.store(false, Ordering::SeqCst);
            state.rule_count.store(0, Ordering::SeqCst);
            Ok(json!(true))
        }
        "treease:intercept-update-rules" => {
            if !state.active.load(Ordering::SeqCst) {
                return Err("拦截未启动，请先启动拦截".into());
            }
            let rules = sanitize_rules(args.get(1).unwrap_or(&Value::Null));
            apply_rules(&map, &rules, false)?;
            state
                .rule_count
                .store(active_rule_count(&rules), Ordering::SeqCst);
            Ok(status_value(&map, &state))
        }
        "treease:intercept-status" => {
            if !state.active.load(Ordering::SeqCst) {
                return Ok(Value::Null);
            }
            Ok(status_value(&map, &state))
        }
        "treease:cache-clear" => {
            let webview = get_webview(&map, WEBVIEW_ID)?;
            webview
                .clear_all_browsing_data()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "treease:intercept-log" => Ok(Value::Null),
        other => Err(format!("未实现的 treease 通道：{other}")),
    }
}
