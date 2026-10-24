// chrome-sandbox 域：命令分发与服务编排（Rust 原生实现，对齐 Node 版 sandbox-service）。
pub mod developer_mode;
pub mod fingerprint;
pub mod paths;
pub mod process;
pub mod profile;
pub mod store;

use crate::iso_time::now_iso;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

pub const SANDBOX_COLOR: &str = "#3390ec";

/// 探测 Chrome 可执行文件：配置过的路径优先，其次各平台默认安装位置
pub fn detect_chrome_path(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(configured) = store::config_get_string("chromePath") {
        if Path::new(&configured).exists() {
            return Ok(configured);
        }
    }
    for candidate in paths::default_chrome_paths() {
        if candidate.exists() {
            let found = candidate.to_string_lossy().to_string();
            let _ = store::config_update(&json!({ "chromePath": found }));
            return Ok(found);
        }
    }
    let _ = app;
    Err("未找到 Chrome 浏览器，请在设置中手动指定路径".into())
}

fn get_free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|address| address.port())
}

/// 与 Node 版 syncRunningState 对齐：状态与实际进程不一致时校正并广播
fn sync_running_state(app: &tauri::AppHandle, sandbox: &store::Sandbox) -> Option<store::Sandbox> {
    let running = process::is_running(
        app,
        &sandbox.id,
        &sandbox.user_data_path,
        sandbox.status == "running",
    );
    if running == (sandbox.status == "running") {
        return Some(sandbox.clone());
    }
    if !running {
        process::emit_event(
            app,
            "sandbox:process-exited",
            json!({ "sandboxId": sandbox.id }),
        );
    }
    store::update_sandbox_fields(
        &sandbox.id,
        &json!({
            "status": if running { "running" } else { "stopped" },
            "chromePid": if running { sandbox.chrome_pid } else { None::<i64> },
        }),
    )
}

fn get_sandbox_synced(app: &tauri::AppHandle, id: &str) -> Result<store::Sandbox, String> {
    let sandbox = store::find_sandbox(id).ok_or("沙箱不存在")?;
    sync_running_state(app, &sandbox).ok_or_else(|| "沙箱不存在".to_string())
}

fn refresh_sandbox_pid(app: &tauri::AppHandle, sandbox: &store::Sandbox) -> Option<store::Sandbox> {
    let pids = process::query_pids(app, &sandbox.user_data_path);
    let pid = pids
        .first()
        .copied()
        .map(|p| p as i64)
        .or(sandbox.chrome_pid);
    if pid == sandbox.chrome_pid {
        return Some(sandbox.clone());
    }
    store::update_sandbox_fields(&sandbox.id, &json!({ "chromePid": pid }))
}

fn focus_running_sandbox(
    app: &tauri::AppHandle,
    sandbox: &store::Sandbox,
) -> Option<store::Sandbox> {
    let pid = process::find_running_pid(app, &sandbox.id, &sandbox.user_data_path)
        .or(sandbox.chrome_pid.map(|pid| pid as u32))?;
    process::focus_chrome_window(pid);
    store::update_sandbox_fields(
        &sandbox.id,
        &json!({
            "status": "running",
            "chromePid": pid,
            "lastActiveAt": now_iso(),
        }),
    )
}

fn handle_get_all(app: &tauri::AppHandle) -> Result<Value, String> {
    let items: Vec<Value> = store::load_sandboxes()
        .iter()
        .filter_map(|sandbox| sync_running_state(app, sandbox))
        .filter_map(|sandbox| serde_json::to_value(sandbox).ok())
        .collect();
    Ok(Value::Array(items))
}

fn handle_create(app: &tauri::AppHandle, args: &[Value]) -> Result<Value, String> {
    let payload = args.first().cloned().ok_or("缺少创建参数")?;
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or("缺少 name")?;

    let sandbox_id = format!(
        "sandbox_{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    );
    let sandbox_path = paths::sandbox_path(&sandbox_id);
    std::fs::create_dir_all(&sandbox_path).map_err(|e| format!("创建沙箱目录失败：{e}"))?;
    profile::init_sandbox_user_data(
        &sandbox_path,
        &sandbox_id,
        payload.get("inheritExtensions").and_then(Value::as_bool) == Some(true),
    )?;

    let fingerprint = match payload.get("fingerprintData") {
        Some(Value::Null) | None => fingerprint::generate_random_fingerprint(),
        Some(value) => {
            serde_json::from_value(value.clone()).map_err(|e| format!("指纹数据无效：{e}"))?
        }
    };
    store::push_fingerprint(&fingerprint)?;
    profile::prepare_fingerprint_extension(
        app,
        &paths::sandbox_fingerprint_ext_path(&sandbox_id),
        &fingerprint,
    )?;

    let launch = payload
        .pointer("/launchOptions")
        .cloned()
        .unwrap_or(json!({}));
    let sandbox = store::Sandbox {
        id: sandbox_id.clone(),
        name,
        category: Some("other".into()),
        color: Some(SANDBOX_COLOR.into()),
        user_data_path: sandbox_path.to_string_lossy().to_string(),
        chrome_pid: None,
        status: "stopped".into(),
        fingerprint_id: Some(fingerprint.id),
        created_at: Some(now_iso()),
        last_used_at: None,
        last_active_at: None,
        metadata: Some(store::SandboxMetadata {
            inherit_extensions: Some(
                payload.get("inheritExtensions").and_then(Value::as_bool) == Some(true),
            ),
            launch_options: Some(store::LaunchOptions {
                disable_safety_checks: Some(
                    launch.get("disableSafetyChecks").and_then(Value::as_bool) == Some(true),
                ),
                disable_cors: Some(
                    launch.get("disableCors").and_then(Value::as_bool) == Some(true),
                ),
                custom_args: Some(
                    launch
                        .get("customArgs")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                ),
            }),
            developer_mode_enabled: None,
        }),
    };
    let mut items = store::load_sandboxes();
    items.push(sandbox.clone());
    store::save_sandboxes(&items)?;
    serde_json::to_value(sandbox).map_err(|e| e.to_string())
}

fn handle_activate(app: &tauri::AppHandle, args: &[Value]) -> Result<Value, String> {
    let sandbox_id = args
        .first()
        .and_then(Value::as_str)
        .ok_or("缺少沙箱 id")?
        .to_string();
    let mut sandbox = get_sandbox_synced(app, &sandbox_id)?;

    let inherit_extensions = sandbox
        .metadata
        .as_ref()
        .and_then(|meta| meta.inherit_extensions)
        == Some(true);
    profile::repair_sandbox_profile(
        &paths::sandbox_path(&sandbox_id),
        &sandbox_id,
        inherit_extensions,
    )?;

    if let Some(focused) = focus_running_sandbox(app, &sandbox) {
        return serde_json::to_value(focused).map_err(|e| e.to_string());
    }

    // 开发者模式只在未开过的沙箱上走 CDP 流程
    let metadata_developer_mode = sandbox
        .metadata
        .as_ref()
        .and_then(|meta| meta.developer_mode_enabled)
        == Some(true);
    let skip_setup =
        developer_mode::should_skip_developer_mode_setup(&sandbox_id, metadata_developer_mode);
    let enable_developer_mode = !metadata_developer_mode && !skip_setup;
    let debug_port = if enable_developer_mode {
        get_free_port()
    } else {
        None
    };

    let launch_options = sandbox
        .metadata
        .clone()
        .and_then(|meta| meta.launch_options)
        .unwrap_or_default();
    let pid = process::launch_chrome(
        app,
        &sandbox_id,
        &sandbox.user_data_path,
        &paths::sandbox_profile_directory_name(&sandbox_id),
        paths::sandbox_fingerprint_ext_path(&sandbox_id).to_str(),
        debug_port,
        launch_options.disable_safety_checks == Some(true),
        launch_options.disable_cors == Some(true),
        launch_options.custom_args.as_deref().unwrap_or_default(),
        (100, 100),
        (1280, 800),
    )?;

    let mut metadata = sandbox.metadata.clone().unwrap_or_default();
    if skip_setup && !metadata_developer_mode {
        metadata.developer_mode_enabled = Some(true);
    }
    if debug_port.is_some()
        && developer_mode::setup_sandbox_developer_mode(debug_port, Some((100, 100, 1280, 800)))
    {
        metadata.developer_mode_enabled = Some(true);
    }
    sandbox.metadata = Some(metadata);

    let updated = store::update_sandbox_fields(
        &sandbox_id,
        &json!({
            "status": "running",
            "chromePid": pid,
            "lastUsedAt": now_iso(),
            "lastActiveAt": now_iso(),
            "metadata": serde_json::to_value(&sandbox.metadata).unwrap_or(Value::Null),
        }),
    )
    .ok_or("沙箱不存在")?;
    process::emit_event(
        app,
        "sandbox:status-changed",
        json!({ "sandboxId": sandbox_id, "status": "running" }),
    );
    let refreshed = refresh_sandbox_pid(app, &updated).unwrap_or(updated);
    serde_json::to_value(refreshed).map_err(|e| e.to_string())
}

fn handle_close(app: &tauri::AppHandle, args: &[Value]) -> Result<Value, String> {
    let sandbox_id = args
        .first()
        .and_then(Value::as_str)
        .ok_or("缺少沙箱 id")?
        .to_string();
    let sandbox = get_sandbox_synced(app, &sandbox_id)?;
    process::kill_process(app, &sandbox_id, &sandbox.user_data_path);
    let updated = store::update_sandbox_fields(
        &sandbox_id,
        &json!({ "status": "stopped", "chromePid": null }),
    )
    .ok_or("沙箱不存在")?;
    process::emit_event(
        app,
        "sandbox:status-changed",
        json!({ "sandboxId": sandbox_id, "status": "stopped" }),
    );
    serde_json::to_value(updated).map_err(|e| e.to_string())
}

fn handle_delete(app: &tauri::AppHandle, args: &[Value]) -> Result<Value, String> {
    let sandbox_id = args
        .first()
        .and_then(Value::as_str)
        .ok_or("缺少沙箱 id")?
        .to_string();
    let sandbox = get_sandbox_synced(app, &sandbox_id)?;
    if sandbox.status == "running" {
        handle_close(app, &[Value::String(sandbox_id.clone())])?;
    }

    // 删除是递归强删：必须确认目标仍在沙箱根目录内，防止脏数据指向业务目录之外
    let sandboxes_root = paths::sandboxes_directory();
    let target = Path::new(&sandbox.user_data_path);
    let canonical_root = sandboxes_root
        .canonicalize()
        .map_err(|_| "沙箱目录异常，已阻止删除".to_string())?;
    let canonical_target = target
        .canonicalize()
        .map_err(|_| "沙箱目录异常，已阻止删除".to_string())?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err("沙箱目录异常，已阻止删除".into());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| format!("删除沙箱目录失败：{e}"))?;
    }
    if let Some(fingerprint_id) = &sandbox.fingerprint_id {
        store::delete_fingerprint(fingerprint_id);
    }
    let mut items = store::load_sandboxes();
    items.retain(|item| item.id != sandbox_id);
    store::save_sandboxes(&items)?;
    Ok(Value::Bool(true))
}

fn handle_update(args: &[Value]) -> Result<Value, String> {
    let sandbox_id = args
        .first()
        .and_then(Value::as_str)
        .ok_or("缺少沙箱 id")?
        .to_string();
    let patch = args.get(1).cloned().ok_or("缺少更新内容")?;
    let updated = store::update_sandbox_fields(&sandbox_id, &patch).ok_or("沙箱不存在")?;
    serde_json::to_value(updated).map_err(|e| e.to_string())
}

fn handle_refresh_status(app: &tauri::AppHandle, args: &[Value]) -> Result<Value, String> {
    let sandbox_id = args
        .first()
        .and_then(Value::as_str)
        .ok_or("缺少沙箱 id")?
        .to_string();
    let sandbox = get_sandbox_synced(app, &sandbox_id)?;
    let refreshed = refresh_sandbox_pid(app, &sandbox).unwrap_or(sandbox);
    serde_json::to_value(refreshed).map_err(|e| e.to_string())
}

fn handle_fingerprint_update(_app: &tauri::AppHandle, args: &[Value]) -> Result<Value, String> {
    let sandbox_id = args
        .first()
        .and_then(Value::as_str)
        .ok_or("缺少沙箱 id")?
        .to_string();
    let patch = args.get(1).cloned().ok_or("缺少指纹更新内容")?;
    let sandbox = store::find_sandbox(&sandbox_id).ok_or("沙箱不存在")?;
    let fingerprint_id = sandbox.fingerprint_id.clone().ok_or("沙箱未关联指纹")?;
    let updated = store::upsert_fingerprint_patch(&fingerprint_id, &patch).ok_or("指纹不存在")?;
    profile::update_fingerprint_config(
        &paths::sandbox_fingerprint_ext_path(&sandbox_id),
        &updated,
    )?;
    serde_json::to_value(updated).map_err(|e| e.to_string())
}

fn handle_config_select_directory(app: &tauri::AppHandle) -> Result<Value, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择数据目录")
        .blocking_pick_folder();
    match picked {
        Some(folder) => Ok(json!(folder.to_string())),
        None => Ok(Value::Null),
    }
}

/// 运行中沙箱的 userData 目录（应用壳清理缓存时整体跳过，避免删掉正在使用的 profile）
pub fn running_user_data_dirs() -> Vec<std::path::PathBuf> {
    store::load_sandboxes()
        .into_iter()
        .filter(|sandbox| sandbox.status == "running")
        .map(|sandbox| std::path::PathBuf::from(sandbox.user_data_path))
        .filter(|path| path.exists())
        .collect()
}

/// chrome_sandbox_command 的本地分发；命令名与 SANDBOX_COMMANDS 一致
pub fn handle(app: &tauri::AppHandle, command: &str, args: &[Value]) -> Result<Value, String> {
    match command {
        "sandbox:get-all" => handle_get_all(app),
        "sandbox:create" => handle_create(app, args),
        "sandbox:delete" => handle_delete(app, args),
        "sandbox:activate" => handle_activate(app, args),
        "sandbox:close" => handle_close(app, args),
        "sandbox:update" => handle_update(args),
        "sandbox:refresh-status" => handle_refresh_status(app, args),
        "fingerprint:generate-random" => {
            serde_json::to_value(fingerprint::generate_random_fingerprint())
                .map_err(|e| e.to_string())
        }
        "fingerprint:get-by-id" => {
            let id = args.first().and_then(Value::as_str).ok_or("缺少指纹 id")?;
            match store::find_fingerprint(id) {
                Some(found) => serde_json::to_value(found).map_err(|e| e.to_string()),
                None => Ok(Value::Null),
            }
        }
        "fingerprint:update" => handle_fingerprint_update(app, args),
        "chrome:detect-path" => detect_chrome_path(app).map(|path| json!(path)),
        "config:get" => Ok(store::with_setup_state(store::config_all(), None)),
        "config:select-data-directory" => handle_config_select_directory(app),
        "config:update" => {
            let patch = args.first().cloned().unwrap_or(json!({}));
            let config = store::config_update(&patch)?;
            Ok(store::with_setup_state(
                config,
                Some(json!({ "dataDirectoryChanged": false })),
            ))
        }
        other => Err(format!("未实现的沙箱命令：{other}")),
    }
}
