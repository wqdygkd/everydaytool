// telegram-cache 域：Telegram Web A 网络资源优化（观测 / 资源索引 / 单飞任务 /
// 归档 / 诊断 / 基准 / MTProto 消息媒体下载）。
//
// 与 Electron 版的差异（方案 B，见 docs/telegram-cache.md）：
// - 观测：wry 没有 `webRequest`。改为子 Webview 注入**只读**采集脚本
//   （PerformanceObserver + fetch/XHR 耗时），经 `observation:report` 上报到桌面壳；
//   不改写任何请求、不碰页面 DOM。
// - 本地响应（protocol.handle）/ CDP 页面捕获：Tauri 无等价能力，
//   配置项与能力矩阵保留原语义（`handlerInstalled` / `pageCaptureAttached` 恒 false）。
pub mod chunk;
pub mod diagnostics;
pub mod http_semantics;
pub mod identity;
pub mod mtproto;
pub mod probe;
pub mod self_test;
pub mod session;
pub mod session_store;
pub mod store;
pub mod tasks;
pub mod types;

use crate::iso_time::now_iso;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use types::*;

pub const EVENT_SNAPSHOT: &str = "telegram-cache:event:snapshot";
pub const EVENT_TRAFFIC: &str = "telegram-cache:event:traffic";
pub const EVENT_TASK: &str = "telegram-cache:event:task";
pub const EVENT_MTPROTO: &str = "telegram-cache:event:mtproto";
pub const EVENT_BENCHMARK: &str = "telegram-cache:event:benchmark";

/// 观测累计计数（基准测试用区间差值，回绕单独记一条说明）
#[derive(Debug, Clone, Default)]
pub struct Counters {
    pub requests: u64,
    pub completed: u64,
    pub failed: u64,
    pub from_cache: u64,
    pub network_bytes: u64,
    pub unknown_size_count: u64,
    pub cache_served_bytes: u64,
    pub local_hits: u64,
    pub local_misses: u64,
    pub revalidations: u64,
    pub revalidation_hits: u64,
    pub page_captured_bytes: u64,
}

impl Counters {
    pub fn to_contract(&self) -> BenchmarkCounters {
        BenchmarkCounters {
            requests: self.requests,
            completed: self.completed,
            failed: self.failed,
            from_cache: self.from_cache,
            network_bytes: self.network_bytes,
            unknown_size_count: self.unknown_size_count,
            cache_served_bytes: self.cache_served_bytes,
            local_hits: self.local_hits,
            local_misses: self.local_misses,
            revalidations: self.revalidations,
            revalidation_hits: self.revalidation_hits,
            page_captured_bytes: self.page_captured_bytes,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct HostStat {
    pub requests: u64,
    pub bytes: u64,
}

pub struct ActiveBenchmark {
    pub id: String,
    pub label: String,
    pub started_at: u64,
    pub snapshot: Counters,
}

pub struct TelState {
    pub config: CacheConfig,
    pub observing_since: Option<u64>,
    pub counters: Counters,
    pub by_type: HashMap<String, HostStat>,
    pub by_host: HashMap<String, HostStat>,
    pub unknown_size: u64,
    pub traffic: VecDeque<Value>,
    pub traffic_seq: u64,
    /// 资源索引（内存视图 = 磁盘 registry.json 的镜像，按 last_seen 收敛到 RESOURCE_LIMIT）
    pub resources: HashMap<String, RegistryEntry>,
    /// 完整地址（仅进程内持有，供下载用；不落盘、不进诊断包）
    pub fetch_urls: HashMap<String, String>,
    /// 已提交内容对象的运行时统计
    pub served_bytes: u64,
    pub evicted_bytes: u64,
    pub evictions: u64,
    pub last_eviction_at: Option<u64>,
    pub archives: Vec<ArchiveEntry>,
    pub benchmark: Option<ActiveBenchmark>,
    pub benchmark_records: Vec<BenchmarkRecord>,
    /// 页面探测脚本挂上的子 Webview id
    pub page_webview: Option<String>,
    pub mtproto: mtproto::MtprotoRuntime,
    pub last_snapshot_push: u64,
}

pub static STATE: LazyLock<Mutex<TelState>> = LazyLock::new(|| {
    Mutex::new(TelState {
        config: store::read_config(),
        observing_since: None,
        counters: Counters::default(),
        by_type: HashMap::new(),
        by_host: HashMap::new(),
        unknown_size: 0,
        traffic: VecDeque::new(),
        traffic_seq: 0,
        resources: HashMap::new(),
        fetch_urls: HashMap::new(),
        served_bytes: 0,
        evicted_bytes: 0,
        evictions: 0,
        last_eviction_at: None,
        archives: store::read_archives(),
        benchmark: None,
        benchmark_records: store::read_benchmarks(),
        page_webview: None,
        mtproto: mtproto::MtprotoRuntime::default(),
        last_snapshot_push: 0,
    })
});

pub fn lock() -> std::sync::MutexGuard<'static, TelState> {
    STATE.lock().unwrap_or_else(|poison| poison.into_inner())
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn emit(app: &AppHandle, channel: &str, payload: Value) {
    let _ = app.emit("edt:event", json!({ "channel": channel, "payload": payload }));
}

pub fn emit_task(app: &AppHandle, task: &TaskSnapshot) {
    emit(app, EVENT_TASK, serde_json::to_value(task).unwrap_or(Value::Null));
}

pub fn emit_mtproto(app: &AppHandle) {
    let status = mtproto::status();
    emit(app, EVENT_MTPROTO, serde_json::to_value(status).unwrap_or(Value::Null));
}

/// 快照推送节流（700ms）：观测高频到达时不必每次都完整重算
pub fn push_snapshot(app: &AppHandle, force: bool) {
    let now = now_ms();
    {
        let state = lock();
        if !force && now.saturating_sub(state.last_snapshot_push) < 700 {
            return;
        }
    }
    if let Ok(mut state) = STATE.lock() {
        state.last_snapshot_push = now;
    }
    let snapshot = build_snapshot();
    emit(app, EVENT_SNAPSHOT, snapshot);
}

pub fn setup() {
    if let Err(error) = store::ensure_dirs() {
        log::warn!("[telegram] 初始化数据目录失败：{error}");
    }
    // registry.json 是磁盘上的唯一事实来源：启动时载入内存镜像
    let entries = store::read_registry();
    if let Ok(mut state) = STATE.lock() {
        for entry in entries {
            state.resources.insert(entry.resource_key.clone(), entry);
        }
        state.observing_since = Some(now_ms());
    }
}

// ── 统计 / 快照 ────────────────────────────────────────────────────────────

pub fn type_stats(state: &TelState) -> Vec<Value> {
    let mut items: Vec<(String, HostStat)> = state
        .by_type
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    items.sort_by_key(|(_, stat)| std::cmp::Reverse(stat.requests));
    items
        .into_iter()
        .map(|(key, stat)| json!({ "resourceType": key, "requests": stat.requests, "bytes": stat.bytes }))
        .collect()
}

pub fn host_stats(state: &TelState) -> Vec<Value> {
    let mut items: Vec<(String, HostStat)> = state
        .by_host
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    items.sort_by_key(|(_, stat)| std::cmp::Reverse(stat.bytes));
    items
        .into_iter()
        .take(10)
        .map(|(key, stat)| json!({ "host": key, "requests": stat.requests, "bytes": stat.bytes }))
        .collect()
}

fn observation_stats(state: &TelState) -> Value {
    let cache_hit_rate = if state.counters.completed > 0 {
        Some(state.counters.from_cache as f64 / state.counters.completed as f64)
    } else {
        None
    };
    json!({
        "enabled": state.config.observation_enabled,
        "observingSince": state.observing_since,
        "requests": state.counters.requests,
        "completed": state.counters.completed,
        "failed": state.counters.failed,
        "fromCache": state.counters.from_cache,
        "networkBytes": state.counters.network_bytes,
        "unknownSizeCount": state.unknown_size,
        "cacheHitRate": cache_hit_rate,
        "byType": type_stats(state),
        "byHost": host_stats(state),
    })
}

fn cache_stats(state: &TelState) -> Value {
    let size_bytes: u64 = state
        .resources
        .values()
        .filter_map(|entry| entry.stored.as_ref())
        .filter(|stored| stored.quota_managed)
        .map(|stored| stored.size)
        .sum();
    let entry_count = state
        .resources
        .values()
        .filter(|entry| entry.stored.is_some())
        .count();
    json!({
        "sizeBytes": size_bytes,
        "entryCount": entry_count,
        "maxBytes": state.config.cache_max_bytes,
        "servedBytes": state.served_bytes,
        "localHits": state.counters.local_hits,
        "localMisses": state.counters.local_misses,
        "revalidations": state.counters.revalidations,
        "revalidationHits": state.counters.revalidation_hits,
        "evictedBytes": state.evicted_bytes,
        "evictions": state.evictions,
        "lastEvictionAt": state.last_eviction_at,
        // 本地响应（protocol.handle 等价能力）与页面捕获（CDP）在本项目不可用，恒为关闭
        "localResponseEnabled": state.config.local_response_enabled,
        "localMediaRangeEnabled": state.config.local_media_range_enabled,
        "handlerInstalled": false,
        "pageCaptureEnabled": state.config.enable_page_capture,
        "pageCaptureAttached": false,
        "pageCapturedBytes": state.counters.page_captured_bytes,
        "pageCaptureHits": 0,
        "pageCaptureMisses": 0,
    })
}

pub fn capabilities() -> Value {
    json!({
        // 观测改由子 Webview 注入的只读采集脚本提供（无 webRequest 等价能力）
        "httpObservation": true,
        "httpHeaderBytes": true,
        "pageMediaCapture": false,
        "telegramDownloader": true,
        "guestProbe": true,
        "localResponseReplacement": false,
        "persistence": "verified-content-store",
        "notes": [
            "观测来自子 Webview 内只读采集脚本（PerformanceObserver + fetch/XHR 耗时）；不改写请求、不注入 DOM",
            "本地响应替换（Electron protocol.handle）与 CDP 页面捕获在 Tauri 下没有等价能力，配置项保留但不会生效",
            "响应字节按资源计时 API 的 transferSize 统计，仅为可观测量级，不等于计费口径",
            "MTProto 下载走 grammers（Rust 客户端），需要 .env 凭据与已登录会话",
        ],
    })
}

fn web_session_info() -> Value {
    let dir = crate::webviews::profile_dir_public("telegram-cache");
    json!({
        "directory": dir.as_ref().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        "inDataDirectory": dir.is_ok(),
        "restartRequired": false,
    })
}

pub fn build_snapshot() -> Value {
    let state = lock();
    let resources: Vec<Value> = {
        let mut items: Vec<&RegistryEntry> = state.resources.values().collect();
        items.sort_by_key(|entry| std::cmp::Reverse(entry.last_seen_at));
        items
            .into_iter()
            .take(RESOURCE_LIMIT)
            .map(|entry| json!(entry))
            .collect()
    };
    let tasks = tasks::task_snapshots(&state);
    let archive_count = state.archives.len();
    let data_directory = crate::appearance::resolve_data_dir().to_string_lossy().to_string();
    json!({
        "stats": observation_stats(&state),
        "cache": cache_stats(&state),
        "resources": resources,
        "tasks": tasks,
        "capabilities": capabilities(),
        "config": state.config,
        "archiveCount": archive_count,
        "dataDirectory": data_directory,
        "webSession": web_session_info(),
        "generatedAt": now_ms(),
    })
}

// ── 观测上报 ──────────────────────────────────────────────────────────────

pub fn ingest_observation(app: &AppHandle, report: ObservationReport, raw_url: &str) {
    let Some(identity) = identity::describe_url(&report.url) else {
        return;
    };
    let now = now_ms();
    let resource_type = report
        .resource_type
        .clone()
        .unwrap_or_else(|| "other".to_string());
    let bytes = report.transfer_bytes.unwrap_or(0);
    let from_cache = report.from_cache;

    let mut state = lock();
    if !state.config.observation_enabled {
        return;
    }
    if state.observing_since.is_none() {
        state.observing_since = Some(now);
    }

    state.counters.requests += 1;
    if report.error.is_some() {
        state.counters.failed += 1;
    } else {
        state.counters.completed += 1;
        if from_cache {
            state.counters.from_cache += 1;
        } else if report.transfer_bytes.is_some() {
            state.counters.network_bytes += bytes;
        } else {
            state.unknown_size += 1;
        }
    }

    let type_entry = state.by_type.entry(resource_type.clone()).or_default();
    type_entry.requests += 1;
    type_entry.bytes += bytes;
    let host_entry = state.by_host.entry(identity.host.clone()).or_default();
    host_entry.requests += 1;
    host_entry.bytes += bytes;

    state.traffic_seq += 1;
    let traffic_id = state.traffic_seq;
    let entry = json!({
        "id": traffic_id,
        "at": now,
        "method": report.method.clone().unwrap_or_else(|| "GET".into()),
        "host": identity.host,
        "path": identity.path,
        "scheme": identity.scheme,
        "resourceType": resource_type,
        "statusCode": report.status_code,
        "fromCache": from_cache,
        "bytes": report.transfer_bytes,
        "durationMs": report.duration_ms,
        "mimeType": report.mime_type,
        "error": report.error,
    });
    state.traffic.push_front(entry.clone());
    while state.traffic.len() > TRAFFIC_LIMIT {
        state.traffic.pop_back();
    }

    // 资源索引：键 = 规范化地址哈希，不覆盖已有的 stored 信息
    if !identity.resource_key.is_empty() {
        let entry = state
            .resources
            .entry(identity.resource_key.clone())
            .or_insert_with(|| RegistryEntry {
                resource_key: identity.resource_key.clone(),
                display_url: identity.display_url.clone(),
                host: identity.host.clone(),
                path: identity.path.clone(),
                resource_type: resource_type.clone(),
                mime_type: report.mime_type.clone(),
                size: bytes,
                size_known: report.transfer_bytes.is_some(),
                requests: 0,
                from_cache: false,
                status_code: report.status_code,
                last_seen_at: now,
                downloadable: identity.downloadable,
                stored: None,
            });
        entry.requests += 1;
        entry.from_cache = from_cache;
        entry.last_seen_at = now;
        entry.resource_type = resource_type;
        if report.mime_type.is_some() {
            entry.mime_type = report.mime_type.clone();
        }
        if report.transfer_bytes.is_some() {
            entry.size = bytes;
            entry.size_known = true;
        }
        if report.status_code.is_some() {
            entry.status_code = report.status_code;
        }
        entry.display_url = identity.display_url;
        if !identity.fetch_url.is_empty() {
            state
                .fetch_urls
                .insert(identity.resource_key.clone(), identity.fetch_url.clone());
        }
    }

    // 收敛到上限：按 last_seen 由旧到新丢弃内存视图（磁盘仍保留已落库条目）
    if state.resources.len() > RESOURCE_LIMIT {
        let mut keys: Vec<(String, u64)> = state
            .resources
            .iter()
            .filter(|(_, entry)| entry.stored.is_none())
            .map(|(key, entry)| (key.clone(), entry.last_seen_at))
            .collect();
        keys.sort_by_key(|(_, seen)| *seen);
        let overflow = state.resources.len() - RESOURCE_LIMIT;
        for (key, _) in keys.into_iter().take(overflow) {
            state.resources.remove(&key);
        }
    }
    let counters = state.counters.to_contract();
    drop(state);

    let _ = raw_url;
    emit(app, EVENT_TRAFFIC, entry);
    let _ = counters;
    push_snapshot(app, false);
}

// ── 配置 / 清理 ────────────────────────────────────────────────────────────

pub fn update_config(app: &AppHandle, patch: &Value) -> Result<Value, String> {
    let mut state = lock();
    let mut next = state.config.clone();
    if let Some(value) = patch.get("observationEnabled").and_then(Value::as_bool) {
        next.observation_enabled = value;
    }
    if let Some(value) = patch.get("maxHttpConcurrency").and_then(Value::as_u64) {
        next.max_http_concurrency = value as u32;
    }
    if let Some(value) = patch.get("maxResourceBytes").and_then(Value::as_u64) {
        next.max_resource_bytes = value;
    }
    if let Some(value) = patch.get("cacheMaxBytes").and_then(Value::as_u64) {
        next.cache_max_bytes = value;
    }
    if let Some(value) = patch.get("localResponseEnabled").and_then(Value::as_bool) {
        next.local_response_enabled = value;
    }
    if let Some(value) = patch.get("localMediaRangeEnabled").and_then(Value::as_bool) {
        next.local_media_range_enabled = value;
    }
    if let Some(value) = patch.get("enablePageCapture").and_then(Value::as_bool) {
        next.enable_page_capture = value;
    }
    let next = next.sanitized();
    state.config = next.clone();
    drop(state);
    store::write_config(&next)?;
    push_snapshot(app, true);
    Ok(json!(next))
}

pub fn clear_observation(app: &AppHandle) -> Value {
    {
        let mut state = lock();
        state.counters = Counters::default();
        state.by_type.clear();
        state.by_host.clear();
        state.unknown_size = 0;
        state.traffic.clear();
        state.observing_since = Some(now_ms());
    }
    push_snapshot(app, true);
    json!(true)
}

/// 清缓存：删内容对象，保留归档副本
pub fn clear_cache(app: &AppHandle) -> Result<Value, String> {
    let mut freed = 0u64;
    {
        let mut state = lock();
        let keys: Vec<String> = state
            .resources
            .iter()
            .filter(|(_, entry)| entry.stored.as_ref().is_some_and(|stored| !stored.archived))
            .map(|(key, _)| key.clone())
            .collect();
        for key in &keys {
            if let Some(entry) = state.resources.get_mut(key) {
                if let Some(stored) = entry.stored.take() {
                    freed += stored.size;
                    let path = store::object_absolute_path(&stored.sha256);
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        state.resources.retain(|_, entry| entry.stored.is_some());
    }
    let entries: Vec<RegistryEntry> = {
        let state = lock();
        state.resources.values().cloned().collect()
    };
    store::write_registry(&entries)?;
    Ok(json!({
        "evictedBytes": freed,
        "evictions": 0,
        "snapshot": build_snapshot(),
    }))
}

// ── 命令分发 ──────────────────────────────────────────────────────────────

fn require_string(args: &[Value], index: usize, label: &str) -> Result<String, String> {
    args.get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{label}非法"))
}

pub fn handle(app: &AppHandle, command: &str, args: &[Value]) -> Result<Value, String> {
    match command {
        "telegram-cache:snapshot:get" => Ok(build_snapshot()),

        "telegram-cache:traffic:get" => {
            let state = lock();
            Ok(json!(state.traffic.iter().cloned().collect::<Vec<Value>>()))
        }

        "telegram-cache:config:set" => {
            let patch = args.first().cloned().unwrap_or_else(|| json!({}));
            let config = update_config(app, &patch)?;
            Ok(json!({ "config": config, "snapshot": build_snapshot() }))
        }

        "telegram-cache:observation:set-enabled" => {
            let enabled = args.first().and_then(Value::as_bool).unwrap_or(true);
            update_config(app, &json!({ "observationEnabled": enabled }))?;
            Ok(build_snapshot())
        }

        "telegram-cache:observation:clear" => {
            clear_observation(app);
            Ok(build_snapshot())
        }

        // 采集脚本由桌面壳下发（只此一份），渲染层按游标取用
        "telegram-cache:observation:script" => {
            let since = args.first().and_then(Value::as_u64).unwrap_or(0);
            Ok(json!({ "script": probe::observation_script(since), "cursor": since }))
        }

        // 子 Webview 注入脚本的上报入口（方案 B 的观测来源）
        "telegram-cache:observation:report" => {
            let payload = args.first().cloned().unwrap_or(Value::Null);
            let report: ObservationReport = serde_json::from_value(payload)
                .map_err(|error| format!("观测载荷非法：{error}"))?;
            ingest_observation(app, report, "");
            Ok(json!(true))
        }

        "telegram-cache:page:attach" => {
            let webview_id = require_string(args, 0, "webview id")?;
            probe::attach(app, &webview_id)?;
            Ok(json!({ "attached": true, "webviewId": webview_id }))
        }

        "telegram-cache:page:probe" => probe::probe(args.first()),

        "telegram-cache:resource:acquire" => {
            let resource_key = require_string(args, 0, "资源键")?;
            if !identity::is_resource_key(&resource_key) {
                return Err("资源键格式非法".into());
            }
            let kind = args
                .get(1)
                .and_then(Value::as_str)
                .unwrap_or("cache")
                .to_string();
            if kind != "cache" && kind != "archive" {
                return Err("资源用途非法（只接受 cache / archive）".into());
            }
            tasks::acquire(app, &resource_key, &kind)
        }

        "telegram-cache:task:cancel" => {
            let task_id = require_string(args, 0, "任务 id")?;
            let result = tasks::cancel(app, &task_id)?;
            Ok(json!(result.get("cancelled").and_then(Value::as_bool).unwrap_or(false)))
        }

        "telegram-cache:archive:list" => {
            let state = lock();
            Ok(json!(state.archives))
        }

        "telegram-cache:archive:open-dir" => {
            store::ensure_dirs()?;
            crate::platform::open_local_path(app, &store::archive_dir().to_string_lossy())?;
            Ok(json!(true))
        }

        "telegram-cache:cache:clear" => clear_cache(app),

        "telegram-cache:self-test" => Ok(self_test::run()),

        "telegram-cache:m3:report" => Ok(diagnostics::feasibility_report()),

        "telegram-cache:diagnostics:export" => diagnostics::export(),

        "telegram-cache:open-data-dir" => {
            store::ensure_dirs()?;
            crate::platform::open_local_path(app, &store::root_dir().to_string_lossy())?;
            Ok(json!(true))
        }

        "telegram-cache:mtproto:status" => {
            Ok(serde_json::to_value(mtproto::status()).unwrap_or(Value::Null))
        }

        "telegram-cache:mtproto:download" => {
            let link = require_string(args, 0, "消息链接")?;
            mtproto::start_download(app, &link)
        }

        "telegram-cache:mtproto:cancel" => mtproto::cancel_download(app),

        "telegram-cache:mtproto:session:migrate" => mtproto::migrate_session(app),

        "telegram-cache:mtproto:session:clear" => mtproto::clear_session(app),

        "telegram-cache:benchmark:status" => Ok(benchmark_status()),

        "telegram-cache:benchmark:start" => {
            let label = args
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            start_benchmark(app, label)
        }

        "telegram-cache:benchmark:stop" => stop_benchmark(app),

        "telegram-cache:benchmark:clear" => clear_benchmarks(app),

        other => Err(format!("未实现的命令：{other}")),
    }
}

// ── 基准测试 ──────────────────────────────────────────────────────────────

pub fn benchmark_status() -> Value {
    let state = lock();
    let active = state.benchmark.as_ref().map(|active| {
        json!({
            "id": active.id,
            "label": active.label,
            "startedAt": active.started_at,
            "snapshot": active.snapshot.to_contract(),
        })
    });
    json!({ "active": active, "records": state.benchmark_records })
}

pub fn start_benchmark(app: &AppHandle, label: String) -> Result<Value, String> {
    {
        let mut state = lock();
        if let Some(active) = state.benchmark.as_ref() {
            return Err(format!("已有基准测试在进行中：{}", active.label));
        }
        let id = format!("bench-{}", now_ms());
        state.benchmark = Some(ActiveBenchmark {
            id,
            label: if label.is_empty() {
                "未命名基准".to_string()
            } else {
                label
            },
            started_at: now_ms(),
            snapshot: state.counters.clone(),
        });
    }
    let status = benchmark_status();
    emit(app, EVENT_BENCHMARK, status.clone());
    Ok(status)
}

/// 计数器差值（回绕时记一条说明，避免把无效样本当结论）
pub fn counter_delta(before: &Counters, after: &Counters) -> (BenchmarkCounters, Option<String>) {
    let mut note = None;
    let mut diff = |a: u64, b: u64, name: &str| -> u64 {
        if b >= a {
            b - a
        } else {
            note = Some(format!("观测计数在基准期间被清空或回绕（{name}），样本可能无效"));
            0
        }
    };
    let counters = BenchmarkCounters {
        requests: diff(before.requests, after.requests, "requests"),
        completed: diff(before.completed, after.completed, "completed"),
        failed: diff(before.failed, after.failed, "failed"),
        from_cache: diff(before.from_cache, after.from_cache, "fromCache"),
        network_bytes: diff(before.network_bytes, after.network_bytes, "networkBytes"),
        unknown_size_count: diff(before.unknown_size_count, after.unknown_size_count, "unknownSize"),
        cache_served_bytes: diff(before.cache_served_bytes, after.cache_served_bytes, "cacheServed"),
        local_hits: diff(before.local_hits, after.local_hits, "localHits"),
        local_misses: diff(before.local_misses, after.local_misses, "localMisses"),
        revalidations: diff(before.revalidations, after.revalidations, "revalidations"),
        revalidation_hits: diff(before.revalidation_hits, after.revalidation_hits, "revalidationHits"),
        page_captured_bytes: diff(before.page_captured_bytes, after.page_captured_bytes, "pageCaptured"),
    };
    (counters, note)
}

pub fn stop_benchmark(app: &AppHandle) -> Result<Value, String> {
    let record = {
        let mut state = lock();
        let Some(active) = state.benchmark.take() else {
            return Err("当前没有进行中的基准测试".into());
        };
        let (counters, note) = counter_delta(&active.snapshot, &state.counters);
        let ended_at = now_ms();
        let duration_ms = ended_at.saturating_sub(active.started_at);
        let per_request = if counters.requests > 0 {
            Some(counters.network_bytes as f64 / counters.requests as f64)
        } else {
            None
        };
        let record = BenchmarkRecord {
            counters,
            id: active.id,
            label: active.label,
            started_at: active.started_at,
            ended_at,
            duration_ms,
            network_bytes_per_request: per_request,
            note,
        };
        state.benchmark_records.insert(0, record.clone());
        state.benchmark_records.truncate(20);
        record
    };
    let records = { lock().benchmark_records.clone() };
    store::write_benchmarks(&records)?;
    let status = benchmark_status();
    emit(app, EVENT_BENCHMARK, status.clone());
    let _ = record;
    Ok(status)
}

pub fn clear_benchmarks(app: &AppHandle) -> Result<Value, String> {
    {
        let mut state = lock();
        state.benchmark_records.clear();
    }
    store::write_benchmarks(&[])?;
    let status = benchmark_status();
    emit(app, EVENT_BENCHMARK, status.clone());
    Ok(status)
}

pub fn now_iso_string() -> String {
    now_iso()
}
