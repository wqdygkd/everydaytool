// workbuddy2api-panel 域：托管上游 workbuddy2api-panel 二进制（GitHub 下载 / 本地 ZIP 安装 /
// 启动停止 / 健康探活 / 单轨更新 + 回滚）。
//
// 与 Electron 版一一对应的行为约定（见 docs/workbuddy2api-panel.md）：
// - 二进制**不进安装包**，全部落在 `<数据目录>/workbuddy2api-panel/`；
// - 上游仓库限定 `misakano7545/workbuddy2api-panel`，下载 URL 走白名单；
// - START 前强制 `listen=127.0.0.1:<port>` 且关掉上游自更新；默认不自动启动；
// - 用户主动取消下载不算失败（不写 lastError）。
pub mod config;
pub mod digest;
pub mod health;
pub mod http;
pub mod install;
pub mod paths;
pub mod process;
pub mod store;
pub mod zip;

use crate::iso_time::now_iso;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Child;
use std::sync::{LazyLock, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_PORT: u16 = 7863;
pub const BINARY_NAME: &str = "wb2api";
pub const BINARY_NAME_WIN: &str = "wb2api.exe";
/// 探活身份字段：503 + 正确 service ≠ 进程挂
pub const HEALTH_SERVICE: &str = "workbuddy2api";
pub const GITHUB_SLUG: &str = "misakano7545/workbuddy2api-panel";

pub const EVENT_STATE: &str = "workbuddy2api-panel:event:state";
pub const EVENT_PROGRESS: &str = "workbuddy2api-panel:event:progress";

/// 最近一次「检查更新」拿到的上游 release 快照（内存缓存，只放上游那一半；
/// 已安装版本按 manifest 现算，否则会拿着过期结论误报「可更新 / 已最新」）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSnapshot {
    pub latest_version: String,
    pub latest_tag: String,
    pub asset_name: String,
    pub digest: String,
    pub download_url: String,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub tag: String,
    pub os: String,
    pub arch: String,
    pub asset_name: String,
    pub digest: String,
    pub source: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct PanelState {
    pub last_error: Option<String>,
    pub last_progress: Option<ProgressEvent>,
    pub release: Option<ReleaseSnapshot>,
    pub busy: bool,
    /// 用户主动取消下载的标记（与 http 层的原子标记同义，供状态展示与跨线程读取）
    pub cancel_requested: bool,
    pub child: Option<Child>,
    pub managed_pid: Option<u32>,
    /// 上游 stderr 的尾巴（进程异常退出时作为 lastError 兜底）
    pub last_stderr: String,
}

pub static STATE: LazyLock<Mutex<PanelState>> = LazyLock::new(|| {
    Mutex::new(PanelState {
        last_error: None,
        last_progress: None,
        release: None,
        busy: false,
        cancel_requested: false,
        child: None,
        managed_pid: None,
        last_stderr: String::new(),
    })
});

static APP: OnceLock<AppHandle> = OnceLock::new();

fn lock() -> std::sync::MutexGuard<'static, PanelState> {
    STATE.lock().unwrap_or_else(|poison| poison.into_inner())
}

pub fn set_last_error(message: Option<String>) {
    lock().last_error = message;
}

pub fn set_busy(value: bool) {
    lock().busy = value;
}

pub fn is_busy() -> bool {
    lock().busy
}

pub fn set_cancel_requested(value: bool) {
    lock().cancel_requested = value;
}

/// 用户主动取消：既不是安装失败，也不该记进 lastError。
#[derive(Debug)]
pub struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "已取消下载")
    }
}

pub fn emit_state(app: &AppHandle, state: &Value) {
    let _ = app.emit(
        "edt:event",
        json!({ "channel": EVENT_STATE, "payload": state }),
    );
}

pub fn emit_progress(app: &AppHandle, event: ProgressEvent) {
    lock().last_progress = Some(event.clone());
    let _ = app.emit(
        "edt:event",
        json!({ "channel": EVENT_PROGRESS, "payload": event }),
    );
    publish_state_soon(app);
}

/// 「推送状态」节流 200ms：连续进度事件不必每次都完整算一遍状态。
pub fn publish_state_soon(app: &AppHandle) {
    static SCHEDULED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if SCHEDULED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        SCHEDULED.store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = publish_state_now(&app);
    });
}

pub fn publish_state_now(app: &AppHandle) -> Value {
    let state = build_state();
    emit_state(app, &state);
    state
}

/// 面板状态：manifest / settings / run config / 进程与健康综合出唯一结论。
pub fn build_state() -> Value {
    let manifest = store::read_manifest();
    let config = config::read_config_json();
    let port = config::resolve_configured_port(config.as_ref());
    let installed = process::resolve_current_binary_path().is_some();

    let snapshot_update = {
        let snapshot = lock().release.clone();
        snapshot.map(|snapshot| {
            json!({
                "currentVersion": manifest.as_ref().map(|item| item.version.clone()),
                "latestVersion": snapshot.latest_version,
                "latestTag": snapshot.latest_tag,
                "assetName": snapshot.asset_name,
                "digest": snapshot.digest,
                "downloadUrl": snapshot.download_url,
                // 已安装版本按 manifest 现算，永远取最新事实
                "hasUpdate": manifest.as_ref().map(|item| item.version.clone()) != Some(snapshot.latest_version.clone()),
            })
        })
    };

    let api_key = config
        .as_ref()
        .and_then(|value| value.get("api_key"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let stderr = process::peek_last_stderr();
    let mut state = json!({
        "status": "not_installed",
        "version": manifest.as_ref().map(|item| item.version.clone()),
        "port": port,
        "panelUrl": format!("http://127.0.0.1:{port}/panel/"),
        "apiKey": api_key,
        "lastError": Value::Null,
        "installed": installed,
        "orphanLikely": false,
        "updating": is_busy(),
        "progress": lock().last_progress,
        "update": snapshot_update,
    });

    let explicit_error = lock().last_error.clone();
    state["lastError"] = json!(explicit_error.clone().or_else(|| (!stderr.is_empty()).then_some(stderr)));

    if !installed {
        return state;
    }
    if is_busy() {
        state["status"] = json!("updating");
        return state;
    }
    if !process::is_process_managed_alive() {
        let orphans = process::find_orphan_pids(port);
        state["orphanLikely"] = json!(!orphans.is_empty());
        // 主动 STOP 会清 stderr，避免关停日志冒充错误
        state["status"] = json!(if explicit_error.is_some() { "error" } else { "stopped" });
        return state;
    }

    let health = health::probe_healthz(port);
    if !health.ok {
        state["status"] = json!("unhealthy");
        return state;
    }
    state["status"] = json!(health::classify_health_status(&health));
    state["lastError"] = Value::Null;
    state
}

pub fn set_release_snapshot(snapshot: Option<ReleaseSnapshot>) {
    lock().release = snapshot;
}

/// 命令分发（命令名与 shared/command-groups/workbuddy.ts 一致）。
pub fn handle(app: &AppHandle, command: &str, _args: &[Value]) -> Result<Value, String> {
    match command {
        "workbuddy2api-panel:get-state" => Ok(build_state()),

        "workbuddy2api-panel:install" => {
            set_last_error(None);
            let result = install::install_from_github(None);
            match result {
                Ok(_) => Ok(publish_state_now(app)),
                Err(error) => {
                    if error != "已取消下载" {
                        set_last_error(Some(error.clone()));
                    }
                    publish_state_now(app);
                    Err(error)
                }
            }
        }

        "workbuddy2api-panel:install-from-zip" => {
            set_last_error(None);
            match install::install_from_local_zip(app) {
                Ok(None) => Ok(build_state()),
                Ok(Some(_)) => Ok(publish_state_now(app)),
                Err(error) => {
                    set_last_error(Some(error.clone()));
                    publish_state_now(app);
                    Err(error)
                }
            }
        }

        "workbuddy2api-panel:cancel-download" => {
            let cancelled = http::cancel_active_download();
            publish_state_now(app);
            Ok(json!({ "cancelled": cancelled }))
        }

        "workbuddy2api-panel:check-update" => {
            let info = install::check_update()?;
            // 检查结果缓存在进程内：推一次状态，重开页签也能直接看到「最新版本」
            publish_state_now(app);
            Ok(info)
        }

        "workbuddy2api-panel:apply-update" => {
            set_last_error(None);
            match install::apply_update(app) {
                Ok(_) => Ok(publish_state_now(app)),
                Err(error) => {
                    if error != "已取消下载" {
                        set_last_error(Some(error.clone()));
                    }
                    publish_state_now(app);
                    Err(error)
                }
            }
        }

        "workbuddy2api-panel:start" => {
            set_last_error(None);
            match process::start_managed_process() {
                Ok(_) => Ok(publish_state_now(app)),
                Err(error) => {
                    set_last_error(Some(error.clone()));
                    publish_state_now(app);
                    Err(error)
                }
            }
        }

        "workbuddy2api-panel:stop" => {
            match process::stop_managed_process() {
                Ok(_) => {
                    set_last_error(None);
                    Ok(publish_state_now(app))
                }
                Err(error) => {
                    set_last_error(Some(error.clone()));
                    publish_state_now(app);
                    Err(error)
                }
            }
        }

        "workbuddy2api-panel:restart" => {
            set_last_error(None);
            let restarted = process::stop_managed_process()
                .and_then(|_| process::start_managed_process().map(|_| ()));
            match restarted {
                Ok(_) => Ok(publish_state_now(app)),
                Err(error) => {
                    set_last_error(Some(error.clone()));
                    publish_state_now(app);
                    Err(error)
                }
            }
        }

        "workbuddy2api-panel:kill-orphan" => {
            let config = config::read_config_json();
            let port = config::resolve_configured_port(config.as_ref());
            let killed = process::kill_orphan_processes(port);
            log::info!("[wb2api] 已结束残留进程：port={port} killed={killed:?}");
            Ok(publish_state_now(app))
        }

        "workbuddy2api-panel:open-data-dir" => {
            paths::ensure_dirs()?;
            crate::platform::open_local_path(app, &paths::root_dir().to_string_lossy())?;
            Ok(json!(true))
        }

        other => Err(format!("未实现的命令：{other}")),
    }
}

/// 域初始化：建目录 + 启动定时探活推送（运行中加账号后 health 会变）。
pub fn setup(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if let Err(error) = paths::ensure_dirs() {
        log::warn!("[wb2api] 初始化数据目录失败：{error}");
    }
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(3_000));
        // 未运行且未在安装 / 更新时跳过，避免空转
        if !process::is_process_managed_alive() && !is_busy() {
            continue;
        }
        let _ = publish_state_now(&handle);
    });
}

/// 域收尾：应用退出时停掉托管的服务进程（与关页签共用 STOP 语义）。
pub fn dispose() {
    if let Err(error) = process::stop_managed_process() {
        log::warn!("[wb2api] 退出时停止服务失败：{error}");
    }
}

pub fn now_timestamp() -> String {
    now_iso()
}
