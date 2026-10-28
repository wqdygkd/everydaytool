// Tauri commands：按业务域分组，前端直接 invoke，不再有通用 Tauri commands / 通道白名单。
use crate::appearance::{self, WindowAppearance};
use crate::treease::TreeaseState;
use crate::{AppState, WebviewState};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, Window};

fn merge_appearance(current: &WindowAppearance, patch: &Value) -> WindowAppearance {
    let mut next = current.clone();
    if let Some(value) = patch.get("enabled").and_then(|v| v.as_bool()) {
        next.enabled = value;
    }
    if let Some(value) = patch.get("material").and_then(|v| v.as_str()) {
        next.material = value.to_string();
    }
    if let Some(value) = patch.get("vibrancy").and_then(|v| v.as_str()) {
        next.vibrancy = value.to_string();
    }
    if let Some(value) = patch.get("testWallpaper").and_then(|v| v.as_bool()) {
        next.test_wallpaper = value;
    }
    next
}

fn appearance_get(state: &AppState) -> Value {
    let current = state
        .appearance
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    json!({
        "appearance": current,
        "capabilities": appearance::resolve_capabilities(),
    })
}

fn appearance_set(app: &AppHandle, state: &AppState, patch: &Value) -> Result<Value, String> {
    let capabilities = appearance::resolve_capabilities();
    let next = {
        let current = state
            .appearance
            .lock()
            .map_err(|_| "窗口外观状态锁定失败")?
            .clone();
        appearance::sanitize(&merge_appearance(&current, patch), &capabilities)
    };
    // 持久化失败不应阻断本次切换：先应用 + 广播，再尽力写盘（受限环境下会走可写回退目录）。
    if let Err(error) = appearance::save(app, &next) {
        log::warn!("[appearance] 保存失败（仅当前会话生效）：{error}");
    }
    if let Ok(mut guard) = state.appearance.lock() {
        *guard = next.clone();
    }
    if let Some(window) = app.get_window("main") {
        appearance::apply_effects(&window, &next);
    }
    let _ = app.emit(
        "edt:event",
        json!({
            "channel": "edt-app:event:appearance-changed",
            "payload": next,
        }),
    );
    serde_json::to_value(next).map_err(|error| error.to_string())
}

/// 统一的域调度：各域 handle 是同步代码（文件 IO / 进程等待），统一放进阻塞线程池，
/// 避免占住 async 运行时线程拖慢其它命令与事件推送。
async fn dispatch_blocking<F>(label: &str, task: F) -> Result<Value, String>
where
    F: FnOnce() -> Result<Value, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{label}：{error}"))?
}

async fn run_command(
    app: AppHandle,
    state: &AppState,
    webviews: &WebviewState,
    treease: Arc<TreeaseState>,
    domain: &'static str,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    if domain == "edtApp" {
        match command.as_str() {
            "edt-app:appearance:get" => return Ok(appearance_get(state)),
            "edt-app:appearance:set" => {
                let patch = args.first().cloned().unwrap_or_else(|| json!({}));
                return appearance_set(&app, state, &patch);
            }
            // 其余应用壳命令（数据目录 / 用量 / 缓存 / DevTools）由 Rust 原生实现
            _ => {
                let handle = app.clone();
                let command_clone = command.clone();
                let args_clone = args.clone();
                return dispatch_blocking("应用壳调度失败", move || {
                    crate::app_domain::handle(&handle, &command_clone, &args_clone)
                })
                .await;
            }
        }
    }

    if domain == "envBrowser" {
        let command_clone = command.clone();
        let args_clone = args.clone();
        return dispatch_blocking("环境浏览器调度失败", move || {
            crate::env_browser::handle(&command_clone, &args_clone)
        })
        .await;
    }

    if domain == "chromeSandbox" {
        let handle = app.clone();
        let command_clone = command.clone();
        let args_clone = args.clone();
        return dispatch_blocking("沙箱调度失败", move || {
            crate::chrome_sandbox::handle(&handle, &command_clone, &args_clone)
        })
        .await;
    }

    if domain == "offlinePack" {
        let handle = app.clone();
        let command_clone = command.clone();
        let args_clone = args.clone();
        return dispatch_blocking("离线包调度失败", move || {
            crate::offline_pack::handle(&handle, &command_clone, &args_clone)
        })
        .await;
    }

    if domain == "wxpEnhancer" {
        let handle = app.clone();
        let command_clone = command.clone();
        let args_clone = args.clone();
        return dispatch_blocking("WXP 调度失败", move || {
            crate::wxp::handle(&handle, &command_clone, &args_clone)
        })
        .await;
    }

    if domain == "interceptor" {
        let handle = app.clone();
        let command_clone = command.clone();
        let args_clone = args.clone();
        return dispatch_blocking("拦截器调度失败", move || {
            crate::interceptor::handle(&handle, &command_clone, &args_clone)
        })
        .await;
    }

    if domain == "workbuddy2apiPanel" {
        let handle = app.clone();
        let command_clone = command.clone();
        let args_clone = args.clone();
        return dispatch_blocking("workbuddy2api-panel 调度失败", move || {
            crate::workbuddy::handle(&handle, &command_clone, &args_clone)
        })
        .await;
    }

    if domain == "telegramCache" {
        let handle = app.clone();
        let command_clone = command.clone();
        let args_clone = args.clone();
        return dispatch_blocking("telegram-cache 调度失败", move || {
            crate::telegram::handle(&handle, &command_clone, &args_clone)
        })
        .await;
    }

    if domain == "treeaseEditor" {
        let handle = app.clone();
        let map = webviews.map.clone();
        let args_clone = args.clone();
        return dispatch_blocking("treease 调度失败", move || {
            crate::treease::handle(handle, map, treease, &command, &args_clone)
        })
        .await;
    }

    let _ = state;
    Err(format!("未知命令域：{domain}/{command}"))
}

#[tauri::command]
pub async fn app_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "edtApp",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn interceptor_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "interceptor",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn chrome_sandbox_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "chromeSandbox",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn env_browser_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "envBrowser",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn workbuddy_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "workbuddy2apiPanel",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn telegram_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "telegramCache",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn treease_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "treeaseEditor",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn wxp_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "wxpEnhancer",
        command,
        args,
    )
    .await
}

#[tauri::command]
pub async fn offline_pack_command(
    app: AppHandle,
    state: State<'_, AppState>,
    webviews: State<'_, WebviewState>,
    treease: State<'_, Arc<TreeaseState>>,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run_command(
        app,
        state.inner(),
        webviews.inner(),
        treease.inner().clone(),
        "offlinePack",
        command,
        args,
    )
    .await
}

fn window_state(window: &Window) -> Result<Value, String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    let fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    Ok(json!({ "maximized": maximized, "fullscreen": fullscreen }))
}

// 窗口命令注入调用方 Window：Tauri 2 的 WebviewWindowBuilder::build() 不把窗口登记进
// webview_windows 表，因此 get_webview_window("main") 与 WebviewWindow 注入都会失败；
// windows 表是正常的，用 Window 即可（窗口级能力都在这层）。
#[tauri::command]
pub fn edt_window_state(window: Window) -> Result<Value, String> {
    window_state(&window)
}

#[tauri::command]
pub fn edt_window_action(window: Window, action: String) -> Result<Value, String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|e| e.to_string())?,
        "toggle-maximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize().map_err(|e| e.to_string())?;
            } else {
                window.maximize().map_err(|e| e.to_string())?;
            }
        }
        "toggle-fullscreen" => {
            let next = !window.is_fullscreen().map_err(|e| e.to_string())?;
            window.set_fullscreen(next).map_err(|e| e.to_string())?;
        }
        "close" => {
            // 先取状态再关窗（关掉之后无法再查询）
            let state = window_state(&window)?;
            window.close().map_err(|e| e.to_string())?;
            return Ok(state);
        }
        other => return Err(format!("未知窗口动作：{other}")),
    }
    window_state(&window)
}

#[tauri::command]
pub fn edt_open_external(app: AppHandle, url: String) -> Result<(), String> {
    crate::platform::open_external(&app, &url)
}
