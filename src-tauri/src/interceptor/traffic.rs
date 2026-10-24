// interceptor 域：流量日志（内存环形缓冲，不落库；相关域名提示）。
use serde_json::{json, Value};
use std::sync::{LazyLock, Mutex};

const TRAFFIC_RING_SIZE: usize = 1000;

static ENTRIES: LazyLock<Mutex<Vec<Value>>> = LazyLock::new(|| Mutex::new(Vec::new()));

pub fn add_entry(entry: Value) {
    let mut entries = ENTRIES.lock().unwrap();
    entries.push(entry);
    if entries.len() > TRAFFIC_RING_SIZE {
        let overflow = entries.len() - TRAFFIC_RING_SIZE;
        entries.drain(0..overflow);
    }
}

pub fn list() -> Vec<Value> {
    ENTRIES.lock().unwrap().clone()
}

pub fn clear() {
    ENTRIES.lock().unwrap().clear();
}

/// 相关域名提示：给定页面 URL，从最近流量里找"该页实际请求过的域名"
pub fn suggest_hosts_for_url(page_url: &str, limit: usize) -> Vec<String> {
    let Ok(page) = url::Url::parse(page_url) else {
        return Vec::new();
    };
    let page_origin = page.origin().ascii_serialization();
    let page_host = page.host_str().unwrap_or_default().to_lowercase();

    let entries = ENTRIES.lock().unwrap();
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for entry in entries.iter().rev() {
        if result.len() >= limit {
            break;
        }
        let Some(host) = entry.get("host").and_then(Value::as_str) else {
            continue;
        };
        if seen.contains(host) {
            continue;
        }
        let header = |key: &str| -> String {
            entry
                .pointer(&format!("/requestHeaders/{key}"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let origin = header("origin");
        let referer = header("referer");
        let from_page = origin == page_origin
            || (!referer.is_empty()
                && (referer.starts_with(&format!("{page_origin}/")) || referer == page_origin))
            || host == page_host;
        if !from_page {
            continue;
        }
        seen.insert(host.to_string());
        result.push(host.to_string());
    }

    result
}

/// 构造流量条目（字段与 Node 版 buildEntry 一致；缺失字段为 null）
#[allow(clippy::too_many_arguments)]
pub fn build_entry(
    started_at: u64,
    method: &str,
    url: &str,
    scheme: &str,
    host: &str,
    path: &str,
    status: Option<u16>,
    status_text: Option<&str>,
    duration_ms: u64,
    request_headers: Option<Value>,
    request_body: Option<String>,
    response_headers: Option<Value>,
    response_body: Option<String>,
    body_truncated: bool,
    mocked: bool,
    canceled: bool,
    redirected_to: Option<String>,
    delayed_by_ms: Option<i64>,
    rewritten_to: Option<String>,
    matched_rule_ids: Vec<String>,
    matched_rule_names: Vec<String>,
    error: Option<String>,
) -> Value {
    json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "at": started_at,
        "method": method,
        "url": url,
        "scheme": scheme,
        "host": host,
        "path": path,
        "status": status,
        "statusText": status_text,
        "durationMs": duration_ms,
        "requestHeaders": request_headers,
        "requestBody": request_body,
        "responseHeaders": response_headers,
        "responseBody": response_body,
        "bodyTruncated": body_truncated,
        "mocked": mocked,
        "canceled": canceled,
        "redirectedTo": redirected_to,
        "delayedByMs": delayed_by_ms,
        "rewrittenTo": rewritten_to,
        "matchedRuleIds": matched_rule_ids,
        "matchedRuleNames": matched_rule_names,
        "error": error,
    })
}
