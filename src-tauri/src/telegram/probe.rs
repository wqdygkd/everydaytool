// telegram-cache 域：页面只读探测 + 观测采集脚本。
//
// 与 Electron 版的差异：没有 `webRequest` 与 CDP。观测改为「子 Webview 内只读采集脚本 +
// 宿主侧轮询取回」——脚本只读 `performance` 条目与资源计时，不改写请求、不碰 DOM；
// 轮询与上报由渲染层的 composable 驱动（见 tools/telegram-cache/composables/useTelegramObserver.ts）。
use serde_json::{json, Value};

/// 采集脚本：返回上次游标之后新增的资源计时条目（可重复调用，天然幂等）
pub fn observation_script(since: u64) -> String {
    format!(
        r#"(function() {{
  const since = {since};
  try {{
    const entries = performance.getEntriesByType('resource') || [];
    const out = [];
    for (const entry of entries) {{
      const start = Math.round(entry.startTime || 0);
      if (start < since) continue;
      const type = entry.initiatorType || 'other';
      out.push({{
        url: entry.name,
        method: 'GET',
        resourceType: type,
        // transferSize 为 0 + 有 decodedBodySize 说明来自缓存（Chromium 语义）
        fromCache: (entry.transferSize || 0) === 0 && (entry.decodedBodySize || 0) > 0,
        transferBytes: entry.transferSize ? Math.round(entry.transferSize) : null,
        durationMs: entry.duration ? Math.round(entry.duration) : null,
        at: start,
      }});
    }}
    const maxStart = entries.reduce((acc, item) => Math.max(acc, Math.round(item.startTime || 0)), since);
    return {{ ok: true, entries: out.slice(-200), cursor: maxStart }};
  }} catch (error) {{
    return {{ ok: false, error: String(error && error.message || error), entries: [], cursor: since }};
  }}
}})()"#
    )
}

/// 只读探测脚本：页面环境 / 媒体元素 / blob 线索 / performance 汇总
pub const PROBE_SCRIPT: &str = r#"(function() {
  try {
    const resources = performance.getEntriesByType('resource') || [];
    let transferSize = 0;
    let decodedBodySize = 0;
    const initiatorTypes = {};
    let blobUrlCount = 0;
    for (const entry of resources) {
      transferSize += entry.transferSize || 0;
      decodedBodySize += entry.decodedBodySize || 0;
      const type = entry.initiatorType || 'other';
      initiatorTypes[type] = (initiatorTypes[type] || 0) + 1;
      if (String(entry.name).startsWith('blob:')) blobUrlCount += 1;
    }
    const videos = document.querySelectorAll('video');
    const audios = document.querySelectorAll('audio');
    return {
      ok: true,
      url: location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      visible: document.visibilityState === 'visible',
      videoCount: videos.length,
      audioCount: audios.length,
      mediaElementCount: videos.length + audios.length,
      blobUrlCount,
      serviceWorkerActive: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      storageEstimateSupported: typeof navigator.storage !== 'undefined' && typeof navigator.storage.estimate === 'function',
      performance: {
        resources: resources.length,
        transferSize,
        decodedBodySize,
        initiatorTypes,
      },
    };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
})()"#;

/// 记下探测目标（子 Webview id）；真正的脚本执行走渲染层的 webview 桥。
pub fn attach(app: &tauri::AppHandle, webview_id: &str) -> Result<(), String> {
    if webview_id.trim().is_empty() {
        return Err("webview id 非法".into());
    }
    if let Ok(mut state) = super::STATE.lock() {
        state.page_webview = Some(webview_id.to_string());
    }
    super::push_snapshot(app, true);
    Ok(())
}

/// 探测：无入参时返回「要跑哪个脚本 + 目标 webview」；带原始结果时按白名单解析成契约对象。
///
/// 远程页面返回的任何对象都不可信：所有字段重新取类型 / 截断长度，
/// 解析失败一律 ok:false，不向渲染层抛内部错误。
pub fn probe(raw: Option<&Value>) -> Result<Value, String> {
    let Some(raw) = raw else {
        let target = super::lock().page_webview.clone();
        return Ok(json!({ "script": PROBE_SCRIPT, "webviewId": target }));
    };

    let ok = raw.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let text = |key: &str, max: usize| -> String {
        raw.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(max)
            .collect()
    };
    let number = |key: &str| -> u64 {
        raw.get(key)
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let perf = raw.get("performance").cloned().unwrap_or_else(|| json!({}));
    let resources = perf.get("resources").and_then(Value::as_u64).unwrap_or(0);
    let transfer_size = perf.get("transferSize").and_then(Value::as_u64).unwrap_or(0);
    let decoded_body_size = perf.get("decodedBodySize").and_then(Value::as_u64).unwrap_or(0);
    let initiator_types: Vec<(String, u64)> = perf
        .get("initiatorTypes")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    Some((
                        key.chars().take(24).collect::<String>(),
                        value.as_u64().unwrap_or(0),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    let probe = json!({
        "ok": ok,
        "probedAt": super::now_ms(),
        "url": text("url", 512),
        "title": text("title", 200),
        "userAgent": text("userAgent", 200),
        "visible": raw.get("visible").and_then(Value::as_bool).unwrap_or(false),
        "videoCount": number("videoCount"),
        "audioCount": number("audioCount"),
        "mediaElementCount": number("mediaElementCount"),
        "blobUrlCount": number("blobUrlCount"),
        "serviceWorkerActive": raw.get("serviceWorkerActive").and_then(Value::as_bool).unwrap_or(false),
        "storageEstimateSupported": raw.get("storageEstimateSupported").and_then(Value::as_bool).unwrap_or(false),
        "performance": {
            "resources": resources,
            "transferSize": transfer_size,
            "decodedBodySize": decoded_body_size,
            "initiatorTypes": initiator_types.iter().cloned().collect::<std::collections::BTreeMap<String, u64>>(),
        },
        "findings": build_findings(
            number("blobUrlCount"),
            raw.get("serviceWorkerActive").and_then(Value::as_bool).unwrap_or(false),
            number("mediaElementCount"),
            number("videoCount"),
            number("audioCount"),
            resources,
            transfer_size,
            initiator_types.iter().find(|(key, _)| key == "other").map(|(_, count)| *count).unwrap_or(0),
        ),
        "error": raw.get("error").and_then(Value::as_str).map(|value| value.chars().take(200).collect::<String>()),
    });
    Ok(probe)
}

fn build_findings(
    blob_url_count: u64,
    service_worker_active: bool,
    media_element_count: u64,
    video_count: u64,
    audio_count: u64,
    resources: u64,
    transfer_size: u64,
    other_count: u64,
) -> Vec<String> {
    let mut findings: Vec<String> = Vec::new();
    if blob_url_count > 0 {
        findings.push(format!(
            "页面已产生 {blob_url_count} 条 blob: 资源：这类媒体由页面自行拼装，桌面壳拿不到可复用地址，不能当作归档数据源。"
        ));
    }
    if service_worker_active {
        findings.push(
            "页面存在活动 Service Worker：其发起的请求不属于页面主线程，属于观测的盲区。".to_string(),
        );
    }
    if media_element_count > 0 {
        findings.push(format!(
            "检测到 {media_element_count} 个媒体元素（video {video_count} / audio {audio_count}）：播放中的数据是否可复用需单独验证，本版本不捕获播放中的数据。"
        ));
    }
    if resources > 0 && transfer_size == 0 {
        findings.push(
            "performance 的 transferSize 为 0：跨域资源大小在页面侧不可见，只能依赖响应头统计。".to_string(),
        );
    }
    if other_count > 0 {
        findings.push(
            "performance 里有 other 类型资源：Telegram 的 MTProto / 长连接流量可能不经过普通 HTTP 路径，需要结合请求类型分布判断。"
                .to_string(),
        );
    }
    if findings.is_empty() {
        findings.push(
            "未发现 blob / Service Worker / 媒体元素线索：目标页面可能刚打开，或媒体走 MTProto 长连接。"
                .to_string(),
        );
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observation_script_embeds_cursor() {
        let script = observation_script(1234);
        assert!(script.contains("const since = 1234;"));
        assert!(script.contains("performance.getEntriesByType('resource')"));
        // 只读：不得出现改写请求或 DOM 的调用
        assert!(!script.contains("fetch("));
        assert!(!script.contains("XMLHttpRequest"));
        assert!(!script.contains("appendChild"));
    }
}
