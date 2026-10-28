// telegram-cache 域：单飞任务协调器 + HTTP 下载 + 归档。
//
// 单飞（single-flight）：同一资源键在任意时刻只有一个底层下载；后来的消费者加入同一任务
// （consumers / joinedConsumers 计数），取消一个消费者不影响其它消费者。
// 下载：受 maxResourceBytes / cacheMaxBytes 约束，先写临时文件 → SHA-256 → 原子 rename 成
// 内容对象（内容寻址），再按 HTTP 语义决定能否作为本地复用内容。
use super::types::*;
use super::{identity, store};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::AppHandle;

pub struct TaskRuntime {
    pub snapshot: TaskSnapshot,
    pub cancel: Arc<AtomicBool>,
    /// 已取消但仍挂着该任务的消费者数（全部取消后才真正中止）
    pub consumers: u32,
}

static RUNTIME: LazyLock<Mutex<HashMap<String, TaskRuntime>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static HISTORY: LazyLock<Mutex<Vec<TaskSnapshot>>> = LazyLock::new(|| Mutex::new(Vec::new()));
static ACTIVE_DOWNLOADS: AtomicUsize = AtomicUsize::new(0);

fn slot_of(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    digest[..12].to_string()
}

pub fn task_snapshots(state: &super::TelState) -> Vec<TaskSnapshot> {
    let _ = state;
    let mut out: Vec<TaskSnapshot> = RUNTIME
        .lock()
        .map(|runtime| runtime.values().map(|item| item.snapshot.clone()).collect())
        .unwrap_or_default();
    let history = HISTORY.lock().map(|list| list.clone()).unwrap_or_default();
    out.extend(history);
    out
}

fn upsert_runtime(snapshot: TaskSnapshot) {
    if let Ok(mut runtime) = RUNTIME.lock() {
        if let Some(existing) = runtime.get_mut(&snapshot.task_id) {
            existing.snapshot = snapshot;
            return;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        runtime.insert(
            snapshot.task_id.clone(),
            TaskRuntime {
                snapshot,
                cancel,
                consumers: 1,
            },
        );
    }
}

fn finish(snapshot: TaskSnapshot) {
    let removed = RUNTIME
        .lock()
        .map(|mut runtime| runtime.remove(&snapshot.task_id))
        .ok();
    let _ = removed;
    if let Ok(mut history) = HISTORY.lock() {
        history.insert(0, snapshot);
        history.truncate(TASK_HISTORY_LIMIT);
    }
}

/// 取回/落库：同步等待结果（与 Electron 版一致——面板的「存库 / 归档」按完成态返回）。
/// 同一资源已有任务在跑时加入它并等它结束（single-flight），不重复下载。
pub fn acquire(app: &AppHandle, resource_key: &str, kind: &str) -> Result<Value, String> {
    let (display_url, host, fetch_url, mime_hint) = {
        let state = super::lock();
        let entry = state
            .resources
            .get(resource_key)
            .ok_or("资源不在索引中（请先在页面里触发一次该请求）")?;
        (
            entry.display_url.clone(),
            entry.host.clone(),
            state.fetch_urls.get(resource_key).cloned().unwrap_or_default(),
            entry.mime_type.clone(),
        )
    };
    let _ = mime_hint;
    if fetch_url.is_empty() {
        return Err("该资源没有可复用的 HTTP 地址（blob:/data: 一类不可下载）".into());
    }

    // 已有同资源任务：加入并等它结束
    let existing = {
        let mut runtime = RUNTIME.lock().map_err(|_| "任务表锁定失败")?;
        runtime
            .values_mut()
            .find(|item| {
                item.snapshot.resource_key == resource_key
                    && matches!(item.snapshot.status.as_str(), "queued" | "running")
            })
            .map(|item| {
                item.snapshot.joined_consumers += 1;
                item.consumers += 1;
                item.snapshot.consumers = item.consumers;
                if !item.snapshot.kinds.iter().any(|value| value == kind) {
                    item.snapshot.kinds.push(kind.to_string());
                }
                item.snapshot.clone()
            })
    };
    if let Some(snapshot) = existing {
        super::emit_task(app, &snapshot);
        let deadline = super::now_ms() + 10 * 60 * 1000;
        while super::now_ms() < deadline {
            let done = RUNTIME
                .lock()
                .ok()
                .and_then(|runtime| runtime.get(&snapshot.task_id).map(|item| item.snapshot.clone()));
            match done {
                Some(current) if matches!(current.status.as_str(), "queued" | "running") => {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                }
                _ => break,
            }
        }
        // 结果从历史里取（任务结束后会移入 HISTORY）
        let finished = HISTORY
            .lock()
            .ok()
            .and_then(|history| history.iter().find(|item| item.task_id == snapshot.task_id).cloned());
        return match finished {
            Some(task) if task.status == "completed" => Ok(acquire_outcome(app, resource_key, true, true)),
            Some(task) => Err(task.error.unwrap_or_else(|| "任务失败".into())),
            None => Ok(acquire_outcome(app, resource_key, false, true)),
        };
    }

    let task_id = format!("tel-{}", super::now_ms());
    let snapshot = TaskSnapshot {
        task_id: task_id.clone(),
        resource_key: resource_key.to_string(),
        display_url,
        host,
        status: "queued".into(),
        priority: 0,
        consumers: 1,
        joined_consumers: 1,
        kinds: vec![kind.to_string()],
        bytes: 0,
        total_bytes: None,
        attempts: 0,
        error: None,
        queued_at: super::now_ms(),
        started_at: None,
        finished_at: None,
    };
    upsert_runtime(snapshot.clone());
    super::emit_task(app, &snapshot);
    run_http_task(
        app.clone(),
        task_id.clone(),
        resource_key.to_string(),
        kind.to_string(),
        fetch_url,
    );

    let finished = HISTORY
        .lock()
        .ok()
        .and_then(|history| history.iter().find(|item| item.task_id == task_id).cloned());
    match finished {
        Some(task) if task.status == "completed" => Ok(acquire_outcome(app, resource_key, false, false)),
        Some(task) => Err(task.error.unwrap_or_else(|| "任务失败".into())),
        None => Ok(acquire_outcome(app, resource_key, false, false)),
    }
}

/// 组装面板需要的落库结果（资源记录 + 归档路径）
fn acquire_outcome(app: &AppHandle, resource_key: &str, reused: bool, joined: bool) -> Value {
    let state = super::lock();
    let entry = state.resources.get(resource_key);
    let stored = entry.and_then(|item| item.stored.clone());
    let archive_relative = state
        .archives
        .iter()
        .find(|archive| archive.resource_key == resource_key)
        .map(|archive| archive.relative_path.clone());
    let record = match (&stored, entry) {
        (Some(stored), Some(entry)) => serde_json::json!({
            "resourceKey": resource_key,
            "displayUrl": entry.display_url,
            "size": stored.size,
            "sha256": stored.sha256,
            "relativePath": stored.relative_path,
            "mimeType": entry.mime_type,
            "verification": stored.verification,
        }),
        _ => serde_json::Value::Null,
    };
    drop(state);
    let _ = app;
    serde_json::json!({
        "reused": reused,
        "joined": joined,
        "archiveRelativePath": archive_relative,
        "record": record,
    })
}

pub fn cancel(app: &AppHandle, task_id: &str) -> Result<Value, String> {
    let snapshot = {
        let mut runtime = RUNTIME.lock().map_err(|_| "任务表锁定失败")?;
        let Some(task) = runtime.get_mut(task_id) else {
            return Err("任务不存在或已结束".into());
        };
        task.consumers = task.consumers.saturating_sub(1);
        task.snapshot.consumers = task.consumers;
        if task.consumers > 0 {
            let snapshot = task.snapshot.clone();
            drop(runtime);
            super::emit_task(app, &snapshot);
            return Ok(json!({ "cancelled": false, "stillAttached": true }));
        }
        task.cancel.store(true, Ordering::SeqCst);
        task.snapshot.status = "cancelled".into();
        task.snapshot.finished_at = Some(super::now_ms());
        task.snapshot.clone()
    };
    finish(snapshot.clone());
    super::emit_task(app, &snapshot);
    let _ = super::push_snapshot(app, true);
    Ok(json!({ "cancelled": true, "stillAttached": false }))
}

fn wait_for_slot(limit: u32, cancel: &AtomicBool) -> Result<(), String> {
    let limit = limit.max(1) as usize;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("已取消".into());
        }
        let active = ACTIVE_DOWNLOADS.load(Ordering::SeqCst);
        if active < limit {
            ACTIVE_DOWNLOADS.fetch_add(1, Ordering::SeqCst);
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
    }
}

fn release_slot() {
    ACTIVE_DOWNLOADS.fetch_sub(1, Ordering::SeqCst);
}

fn run_http_task(
    app: AppHandle,
    task_id: String,
    resource_key: String,
    kind: String,
    fetch_url: String,
) {
    let cancel = {
        let runtime = RUNTIME.lock().ok();
        runtime
            .and_then(|runtime| runtime.get(&task_id).map(|task| task.cancel.clone()))
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
    };
    let limit = super::lock().config.max_http_concurrency;

    let mut snapshot = {
        let runtime = RUNTIME.lock().ok();
        runtime
            .and_then(|runtime| runtime.get(&task_id).map(|task| task.snapshot.clone()))
            .expect("task runtime missing")
    };
    snapshot.status = "running".into();
    snapshot.started_at = Some(super::now_ms());
    upsert_runtime(snapshot.clone());
    super::emit_task(&app, &snapshot);

    let mut last_error: Option<String> = None;
    for attempt in 1..=TASK_MAX_ATTEMPTS {
        if cancel.load(Ordering::SeqCst) {
            snapshot.status = "cancelled".into();
            break;
        }
        snapshot.attempts = attempt;
        let result = (|| -> Result<StoredInfo, String> {
            let _slot = wait_for_slot(limit, &cancel)?;
            let outcome = download_resource(&app, &task_id, &fetch_url, &resource_key, &cancel)?;
            release_slot();
            commit_object(&app, &resource_key, &kind, outcome, &fetch_url)
        })();
        match result {
            Ok(stored) => {
                snapshot.status = "completed".into();
                snapshot.bytes = stored.size;
                snapshot.total_bytes = Some(stored.size);
                snapshot.error = None;
                last_error = None;
                break;
            }
            Err(error) => {
                if cancel.load(Ordering::SeqCst) || error == "已取消" {
                    snapshot.status = "cancelled".into();
                    last_error = None;
                    break;
                }
                // 不可重试的错误（大小超限 / 4xx / 非白名单）直接失败
                if error.starts_with("资源超过单文件上限")
                    || error.starts_with("HTTP 4")
                    || error.starts_with("不可下载")
                {
                    last_error = Some(error);
                    snapshot.status = "failed".into();
                    break;
                }
                last_error = Some(error);
                snapshot.status = "failed".into();
            }
        }
    }

    snapshot.finished_at = Some(super::now_ms());
    if let Some(error) = last_error.clone() {
        snapshot.error = Some(error);
    }
    finish(snapshot.clone());
    super::emit_task(&app, &snapshot);
    let _ = super::push_snapshot(&app, true);
}

struct DownloadOutcome {
    sha256: String,
    size: u64,
    mime_type: Option<String>,
    cache_control: Option<String>,
    etag: Option<String>,
    vary: Option<String>,
    status_code: Option<u16>,
    age_seconds: Option<i64>,
}

fn download_resource(
    app: &AppHandle,
    task_id: &str,
    fetch_url: &str,
    resource_key: &str,
    cancel: &AtomicBool,
) -> Result<DownloadOutcome, String> {
    let max_bytes = super::lock().config.max_resource_bytes;
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; edt-telegram-cache/1.0)")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("HTTP 客户端创建失败：{error}"))?;
    let mut response = client
        .get(fetch_url)
        .send()
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    let headers = response.headers().clone();
    let content_length = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if let Some(total) = content_length {
        if total > max_bytes {
            return Err(format!(
                "资源超过单文件上限（{total} > {max_bytes} 字节），已拒绝下载"
            ));
        }
    }

    std::fs::create_dir_all(store::temp_dir()).map_err(|error| error.to_string())?;
    let temp = store::temp_dir().join(format!("{}.part", slot_of(resource_key)));
    let mut file = std::fs::File::create(&temp).map_err(|error| format!("创建临时文件失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&temp);
            return Err("已取消".into());
        }
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("读取响应失败：{error}"))?;
        if read == 0 {
            break;
        }
        size += read as u64;
        if size > max_bytes {
            let _ = std::fs::remove_file(&temp);
            return Err(format!(
                "资源超过单文件上限（{size} > {max_bytes} 字节），已中止写入"
            ));
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read])
            .map_err(|error| format!("写入失败：{error}"))?;
        if let Some(total) = content_length {
            let progress = TaskSnapshot {
                task_id: task_id.to_string(),
                bytes: size,
                total_bytes: Some(total),
                ..Default::default()
            };
            let mut runtime_ok = false;
            if let Ok(mut runtime) = RUNTIME.lock() {
                if let Some(task) = runtime.get_mut(task_id) {
                    task.snapshot.bytes = size;
                    task.snapshot.total_bytes = Some(total);
                    runtime_ok = true;
                }
            }
            let _ = progress;
            if runtime_ok {
                let snapshot = RUNTIME
                    .lock()
                    .ok()
                    .and_then(|runtime| runtime.get(task_id).map(|task| task.snapshot.clone()));
                if let Some(snapshot) = snapshot {
                    super::emit_task(app, &snapshot);
                }
            }
        }
    }
    file.flush().map_err(|error| format!("写入失败：{error}"))?;
    drop(file);

    let header = |name: &str| -> Option<String> {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    Ok(DownloadOutcome {
        sha256: format!("{:x}", hasher.finalize()),
        size,
        mime_type: header("content-type"),
        cache_control: header("cache-control"),
        etag: header("etag"),
        vary: header("vary"),
        status_code: Some(status.as_u16()),
        age_seconds: header("age").and_then(|value| value.parse::<i64>().ok()),
    })
}

/// 把临时文件原子提交为内容对象，并按 HTTP 语义写索引 / 归档
fn commit_object(
    app: &AppHandle,
    resource_key: &str,
    kind: &str,
    outcome: DownloadOutcome,
    fetch_url: &str,
) -> Result<StoredInfo, String> {
    let object_path = store::object_absolute_path(&outcome.sha256);
    if let Some(parent) = object_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = store::temp_dir().join(format!("{}.part", slot_of(resource_key)));
    std::fs::rename(&temp, &object_path).map_err(|error| format!("提交内容对象失败：{error}"))?;

    let now = super::now_ms();
    let freshness = super::http_semantics::evaluate_response_caching(
        super::http_semantics::EvaluateInput {
            mime_type: outcome.mime_type.as_deref(),
            status_code: outcome.status_code,
            cache_control: outcome.cache_control.as_deref(),
            etag: outcome.etag.as_deref(),
            vary: outcome.vary.as_deref(),
            age_seconds: outcome.age_seconds,
            stored_at: now,
        },
    );

    let mut archived = false;
    let mut archive_relative = None;
    if kind == "archive" {
        let (relative, bytes) = archive_copy(resource_key, fetch_url, &outcome)?;
        archived = true;
        archive_relative = Some(relative.clone());
        let entry = ArchiveEntry {
            archive_id: format!("arc-{now}"),
            resource_key: resource_key.to_string(),
            display_url: super::lock()
                .resources
                .get(resource_key)
                .map(|entry| entry.display_url.clone())
                .unwrap_or_default(),
            host: super::lock()
                .resources
                .get(resource_key)
                .map(|entry| entry.host.clone())
                .unwrap_or_default(),
            relative_path: relative,
            size: bytes,
            sha256: outcome.sha256.clone(),
            mime_type: outcome.mime_type.clone(),
            saved_at: now,
        };
        if let Ok(mut state) = super::STATE.lock() {
            state.archives.insert(0, entry);
            state.archives.truncate(500);
        }
    }

    let stored = StoredInfo {
        size: outcome.size,
        sha256: outcome.sha256.clone(),
        completeness: "complete".into(),
        verification: "verified".into(),
        archived,
        relative_path: store::object_relative_path(&outcome.sha256),
        updated_at: now,
        cacheable: freshness.cacheable,
        serve_class: freshness.serve_class.clone(),
        quota_managed: freshness.quota_managed,
        fresh_until: freshness.fresh_until,
        cache_control: freshness.cache_control.clone(),
        etag: freshness.etag.clone(),
    };

    // 索引写入 + 配额淘汰
    let (entries, evicted) = {
        let mut state = super::lock();
        if let Some(entry) = state.resources.get_mut(resource_key) {
            entry.stored = Some(stored.clone());
            entry.size = outcome.size;
            entry.size_known = true;
        } else {
            let identity = identity::describe_url(fetch_url);
            state.resources.insert(
                resource_key.to_string(),
                RegistryEntry {
                    resource_key: resource_key.to_string(),
                    display_url: identity
                        .as_ref()
                        .map(|item| item.display_url.clone())
                        .unwrap_or_default(),
                    host: identity.as_ref().map(|item| item.host.clone()).unwrap_or_default(),
                    path: identity.as_ref().map(|item| item.path.clone()).unwrap_or_default(),
                    resource_type: "other".into(),
                    mime_type: outcome.mime_type.clone(),
                    size: outcome.size,
                    size_known: true,
                    requests: 1,
                    from_cache: false,
                    status_code: outcome.status_code,
                    last_seen_at: now,
                    downloadable: true,
                    stored: Some(stored.clone()),
                },
            );
        }
        let max = state.config.cache_max_bytes;
        let mut list: Vec<RegistryEntry> = state.resources.values().cloned().collect();
        let evicted = store::evict_for_quota(&mut list, max);
        state.resources = list.into_iter().map(|entry| (entry.resource_key.clone(), entry)).collect();
        (state.resources.values().cloned().collect::<Vec<_>>(), evicted)
    };

    for key in &evicted {
        log::info!("[telegram] 缓存配额淘汰：{key}");
    }
    if !evicted.is_empty() {
        if let Ok(mut state) = super::STATE.lock() {
            state.evictions += evicted.len() as u64;
            state.last_eviction_at = Some(now);
        }
    }
    store::write_registry(&entries)?;
    if kind == "archive" {
        let archives = { super::lock().archives.clone() };
        store::write_archives(&archives)?;
    }
    let _ = archive_relative;
    let _ = app;
    Ok(stored)
}

/// 归档：内容对象复制一份独立副本 + 自带 meta.json（不受以后缓存淘汰影响）
fn archive_copy(
    resource_key: &str,
    fetch_url: &str,
    outcome: &DownloadOutcome,
) -> Result<(String, u64), String> {
    std::fs::create_dir_all(store::archive_dir()).map_err(|error| error.to_string())?;
    let stamp = super::now_ms();
    let file_name = format!("{}-{stamp}.bin", &outcome.sha256[..16]);
    let source = store::object_absolute_path(&outcome.sha256);
    let target = store::archive_dir().join(&file_name);
    std::fs::copy(&source, &target).map_err(|error| format!("归档复制失败：{error}"))?;

    let meta = json!({
        "resourceKey": resource_key,
        "sourceUrl": fetch_url,
        "sha256": outcome.sha256,
        "size": outcome.size,
        "mimeType": outcome.mime_type,
        "savedAt": now_iso_string(),
    });
    let meta_path = store::archive_dir().join(format!("{file_name}.meta.json"));
    crate::appearance::write_json_atomic(
        &meta_path,
        &format!("{}\n", serde_json::to_string_pretty(&meta).unwrap_or_default()),
    )?;
    Ok((
        format!(
            "archive/{}",
            file_name
        ),
        outcome.size,
    ))
}

fn now_iso_string() -> String {
    crate::iso_time::now_iso()
}

impl Default for TaskSnapshot {
    fn default() -> Self {
        Self {
            task_id: String::new(),
            resource_key: String::new(),
            display_url: String::new(),
            host: String::new(),
            status: "queued".into(),
            priority: 0,
            consumers: 1,
            joined_consumers: 1,
            kinds: Vec::new(),
            bytes: 0,
            total_bytes: None,
            attempts: 0,
            error: None,
            queued_at: 0,
            started_at: None,
            finished_at: None,
        }
    }
}
