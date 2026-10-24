// everydaytool Tauri 桌面壳入口。
// 窗口 + Tauri commands + Node 业务运行时（sidecar）。
mod appearance;
mod commands;
mod platform;
mod sidecar;
mod treease;
mod webviews;

use appearance::WindowAppearance;
use serde_json::json;
use sidecar::SidecarHost;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use webviews::WebviewMap;

pub struct WebviewState {
    pub map: WebviewMap,
}

pub struct AppState {
    pub host: Arc<SidecarHost>,
    pub appearance: Mutex<WindowAppearance>,
}

fn create_main_window(
    app: &tauri::AppHandle,
    appearance: &WindowAppearance,
) -> tauri::Result<WebviewWindow> {
    #[cfg(dev)]
    let url = WebviewUrl::External(
        "http://localhost:5173"
            .parse()
            .expect("invalid dev server url"),
    );
    #[cfg(not(dev))]
    let url = WebviewUrl::App("index.html".into());

    let capabilities = appearance::resolve_capabilities();
    // 透明 / 系统材质只在窗口创建时生效；运行时切换只更新 CSS 与 effects。
    // Windows 透明窗口必须 frameless；macOS 走 vibrancy（不能叠加 transparent）。
    let transparent = cfg!(windows) && appearance.enabled && capabilities.supports_transparent;
    // macOS 保留原生红绿灯（titleBarStyle Overlay + hidden_title，decorations=true）；
    // Windows/Linux 必须 decorations=false，彻底移除原生 caption（标题 + 关闭/最小化/最大化）。
    let decorations = cfg!(target_os = "macos");

    let builder = WebviewWindowBuilder::new(app, "main", url)
        .title("everydaytool")
        .inner_size(1200.0, 900.0)
        .min_inner_size(800.0, 500.0)
        .resizable(true)
        .center()
        .decorations(decorations)
        .transparent(transparent);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(20.0, 13.0));

    // Windows 必须显式传入 data_directory：wry 会忽略 WEBVIEW2_USER_DATA_FOLDER，
    // 回退到可能被历史 ACL / 其它实例占用的默认目录（表现为 setup 阶段 os error 5）。
    #[cfg(windows)]
    let builder = builder.data_directory(appearance::webview_data_dir());

    // WebView2 数据目录已在 run() 中通过 WEBVIEW2_USER_DATA_FOLDER 固定，
    // 这里不再传 data_directory（避免同一窗口出现两套环境配置）。

    builder.build()
}

fn hook_window_events(app: &tauri::AppHandle, window: &WebviewWindow) {
    let handle = app.clone();
    let last = Arc::new(Mutex::new((false, false)));
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Resized(_)) {
            return;
        }
        let Some(win) = handle.get_webview_window("main") else {
            return;
        };
        let fullscreen = win.is_fullscreen().unwrap_or(false);
        let maximized = win.is_maximized().unwrap_or(false);
        if let Ok(mut state) = last.lock() {
            if *state == (fullscreen, maximized) {
                return;
            }
            *state = (fullscreen, maximized);
        }
        // 全屏：保持既有事件通道语义（前端 App.vue 已有订阅）
        let _ = handle.emit(
            "edt:event",
            json!({
                "channel": "edt-app:event:fullscreen-changed",
                "payload": fullscreen,
            }),
        );
        // 自绘窗口按钮的状态同步（最大化 / 还原图标）
        let _ = handle.emit(
            "edt:window-state",
            json!({ "fullscreen": fullscreen, "maximized": maximized }),
        );
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebView2 数据目录跟随数据根目录（设置页可改），目录绑定在 create_main_window 的 data_directory。
    let _ = std::fs::create_dir_all(appearance::webview_data_dir());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_command,
            commands::interceptor_command,
            commands::chrome_sandbox_command,
            commands::env_browser_command,
            commands::treease_command,
            commands::wxp_command,
            commands::offline_pack_command,
            commands::edt_window_state,
            commands::edt_window_action,
            commands::edt_open_external,
            webviews::edt_webview,
        ])
        .setup(|app| {
            let current = appearance::load(app.handle());
            let host = SidecarHost::start(app.handle().clone())
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;

            app.manage(AppState {
                host: Arc::new(host),
                appearance: Mutex::new(current.clone()),
            });
            app.manage(WebviewState {
                map: Arc::new(Mutex::new(HashMap::new())),
            });
            app.manage(Arc::new(treease::TreeaseState::default()));

            let window = create_main_window(app.handle(), &current).map_err(
                |error| -> Box<dyn std::error::Error> {
                    std::io::Error::other(format!("create_main_window: {error}")).into()
                },
            )?;
            appearance::apply_effects(&window, &current);
            hook_window_events(app.handle(), &window);
            let _ = window.set_focus();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build everydaytool tauri application");

    let shutdown_started = AtomicBool::new(false);
    let shutdown_finished = Arc::new(AtomicBool::new(false));
    let finished = shutdown_finished.clone();
    app.run(move |handle, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            // 收尾线程启动后可能再次收到用户关窗 / 系统退出请求：在 Node 完成
            // checkpoint 之前必须继续阻止退出，只有收尾线程主动 exit 时才放行。
            if shutdown_started.swap(true, Ordering::SeqCst) {
                if !finished.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
                return;
            }
            api.prevent_exit();
            let handle = handle.clone();
            let finished = finished.clone();
            std::thread::spawn(move || {
                if let Some(state) = handle.try_state::<AppState>() {
                    state.host.shutdown();
                }
                finished.store(true, Ordering::SeqCst);
                handle.exit(code.unwrap_or(0));
            });
        }
    });
}
