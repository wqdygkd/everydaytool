// telegram-cache 域：诊断导出（脱敏）+ M3 可行性报告。
//
// 脱敏口径：只导出「显示地址」（query 值已替换为 ***）、统计与任务摘要；
// 不导出 fetchUrl、cookie、会话、任何凭据。
use super::types::*;
use serde_json::{json, Value};

pub fn export() -> Result<Value, String> {
    let state = super::lock();
    let archives = state.archives.clone();
    let resources: Vec<Value> = state
        .resources
        .values()
        .map(|entry| {
            json!({
                "resourceKey": entry.resource_key,
                "displayUrl": entry.display_url,
                "host": entry.host,
                "resourceType": entry.resource_type,
                "size": entry.size,
                "sizeKnown": entry.size_known,
                "requests": entry.requests,
                "stored": entry.stored,
            })
        })
        .collect();
    let counts = json!({
        "resources": resources.len(),
        "traffic": state.traffic.len(),
        "tasks": super::tasks::task_snapshots(&state).len(),
        "archives": archives.len(),
    });
    let bundle = json!({
        "generatedAt": super::now_iso_string(),
        "app": {
            "product": "everydaytool",
            "version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        },
        "stats": {
            "requests": state.counters.requests,
            "completed": state.counters.completed,
            "failed": state.counters.failed,
            "fromCache": state.counters.from_cache,
            "networkBytes": state.counters.network_bytes,
            "unknownSizeCount": state.unknown_size,
        },
        "config": state.config,
        "capabilities": super::capabilities(),
        "counts": counts,
        "resources": resources,
        "traffic": state.traffic.iter().cloned().collect::<Vec<Value>>(),
        "tasks": super::tasks::task_snapshots(&state),
        "archives": archives,
        "benchmarks": state.benchmark_records,
        "mtproto": serde_json::to_value(super::mtproto::status()).unwrap_or(Value::Null),
    });
    drop(state);

    super::store::ensure_dirs()?;
    let stamp = super::now_ms();
    let file_name = format!("diagnostics-{stamp}.json");
    let path = super::store::root_dir().join("diagnostics").join(&file_name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = serde_json::to_string_pretty(&bundle).map_err(|error| error.to_string())?;
    crate::appearance::write_json_atomic(&path, &format!("{body}\n"))?;
    let bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);

    Ok(json!({
        "relativePath": format!("telegram-cache/diagnostics/{file_name}"),
        "bytes": bytes,
        "exportedAt": stamp,
        "counts": counts,
    }))
}

/// M3 可行性报告：能力边界 + 观测归类 + MTProto 前置条件
pub fn feasibility_report() -> Value {
    let state = super::lock();
    let by_type = super::capabilities();
    let image_requests = state
        .by_type
        .get("image")
        .map(|stat| stat.requests)
        .unwrap_or(0);
    let media_requests = state.by_type.get("media").map(|stat| stat.requests).unwrap_or(0);
    let websocket_requests = state
        .by_type
        .get("websocket")
        .map(|stat| stat.requests)
        .unwrap_or(0);
    let total = state.counters.requests;
    let mtproto_status = super::mtproto::status();
    let mtproto_available = mtproto_status.configured && mtproto_status.has_session;

    let http_majority = if total == 0 {
        None
    } else {
        Some(image_requests + media_requests > websocket_requests)
    };
    let summary = match http_majority {
        None => "尚未观测到流量：先在页面里播放 / 打开一次媒体，再生成报告".to_string(),
        Some(true) => "观测量以普通 HTTP 资源为主：缓存与归档路径有效".to_string(),
        Some(false) => "WebSocket 占比更高：媒体很可能走 MTProto，HTTP 缓存只能覆盖头像 / 贴纸等".to_string(),
    };

    json!({
        "checkedAt": super::now_ms(),
        "environment": {
            "electron": Value::Null,
            "chrome": Value::Null,
            "node": Value::Null,
            "platform": std::env::consts::OS,
            "userAgent": Value::Null,
            "pageUrl": state.page_webview.clone(),
            "serviceWorkerActive": Value::Null,
            "blobUrlCount": Value::Null,
            "mediaElementCount": Value::Null,
            "websocketObserved": websocket_requests > 0,
        },
        "dependencies": {
            "teleproto": {
                // 本项目用 grammers（Rust）而不是 teleproto（Node）
                "packageName": "grammers-client",
                "installed": true,
                "version": mtproto_status.lib_version,
            },
        },
        "checks": checks(&state, &mtproto_status),
        "observation": {
            "requests": total,
            "websocketRequests": websocket_requests,
            "imageRequests": image_requests,
            "mediaRequests": media_requests,
            "blobClues": Value::Null,
            "byType": super::type_stats(&state),
            "topHosts": super::host_stats(&state),
            "note": "观测量来自页面资源计时 API；blob / 播放中数据与 MTProto 明文不可得",
        },
        "capture": {
            "available": false,
            "enabled": state.config.enable_page_capture,
            "attached": false,
            "hits": 0,
            "misses": 0,
            "capturedBytes": 0,
            "supported": ["HTTP(S) 资源（经下载服务落库）"],
            "limitations": [
                "Tauri/wry 没有 CDP 客户端，无法读取页面已下载的响应体",
                "blob: / MediaSource 拼装的媒体不在可捕获范围内",
            ],
        },
        "mtproto": {
            "available": mtproto_available,
            "prerequisites": [
                "在 .env 里提供 TG_API_ID / TG_API_HASH（或环境变量）",
                "用已登录的会话文件（telegram-session，由桌面壳加密保存）",
            ],
            "notes": [
                "MTProto 客户端为 grammers（Rust），不依赖 Node 运行时",
                "会话文件缺失时只能走 HTTP 缓存路径",
            ],
        },
        "decision": { "httpMediaMajority": http_majority, "summary": summary },
        "capabilities": by_type,
    })
}

fn checks(state: &super::TelState, mtproto: &MtprotoStatus) -> Vec<Value> {
    let pass = |id: &str, title: &str, ok: bool, detail: &str| {
        json!({
            "id": id,
            "title": title,
            "status": if ok { "pass" } else { "fail" },
            "detail": detail,
        })
    };
    vec![
        pass(
            "observation",
            "页面观测可用",
            state.config.observation_enabled,
            "子 Webview 只读采集脚本（PerformanceObserver 语义）",
        ),
        pass(
            "resource-index",
            "资源索引可写",
            super::store::root_dir().exists(),
            "registry.json 位于数据目录 telegram-cache/",
        ),
        pass(
            "mtproto-credentials",
            "MTProto 凭据",
            mtproto.configured,
            if mtproto.configured { "已配置" } else { "缺少 TG_API_ID / TG_API_HASH" },
        ),
        pass(
            "mtproto-session",
            "MTProto 会话",
            mtproto.has_session,
            if mtproto.has_session { "已保存会话" } else { "尚无会话文件" },
        ),
        json!({
            "id": "local-response",
            "title": "本地响应替换",
            "status": "blocked",
            "detail": "Tauri 无 protocol.handle 等价能力：配置项保留但不生效",
        }),
        json!({
            "id": "cdp-capture",
            "title": "页面已下载字节捕获",
            "status": "blocked",
            "detail": "Tauri 无 CDP 客户端：无法读取页面已完成的响应体",
        }),
    ]
}
