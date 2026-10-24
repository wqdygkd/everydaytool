// everydaytool Tauri 桌面壳入口。
// 窗口 + Tauri commands + 各业务域（全部 Rust 原生实现，无 Node 运行时）。
mod app_domain;
mod appearance;
mod chrome_sandbox;
mod commands;
mod env_browser;
// 阶段 5 移植中：WS 桥 / MITM 代理接入前尚未接线（接线后移除 allow）
#[allow(dead_code)]
mod interceptor;
mod iso_time;
mod offline_pack;
mod platform;
mod treease;
mod webviews;
mod window_geometry;
mod wxp;

pub use interceptor::origin;

use appearance::WindowAppearance;
use serde_json::json;
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
    pub appearance: Mutex<WindowAppearance>,
}

fn create_main_window(app: &tauri::AppHandle) -> tauri::Result<WebviewWindow> {
    #[cfg(dev)]
    let url = WebviewUrl::External(
        "http://localhost:5173"
            .parse()
            .expect("invalid dev server url"),
    );
    #[cfg(not(dev))]
    let url = WebviewUrl::App("index.html".into());

    let capabilities = appearance::resolve_capabilities();
    // 透明通道只能在建窗时决定（运行时无法切换窗口的透明属性），所以 Windows 上**始终**用
    // 透明窗口创建：真正的「是否透明」由渲染层的 is-opaque 画布类决定，切换半透明 / 材质
    // 因此立即生效、不需要重启。Windows 透明窗口必须 frameless；macOS 走 vibrancy
    // （不能叠加 transparent，故 macOS 保持不透明建窗）。
    let transparent = cfg!(windows) && capabilities.supports_transparent;
    // macOS 保留原生红绿灯（titleBarStyle Overlay + hidden_title，decorations=true）；
    // Windows/Linux 必须 decorations=false，彻底移除原生 caption（标题 + 关闭/最小化/最大化）。
    let decorations = cfg!(target_os = "macos");

    // 上次关闭时的窗口几何（大小 / 位置 / 最大化）。resolve 已按当前显示器校验：
    // 拔掉副屏或改分辨率不会把窗口开到屏幕外，尺寸也不会超过整个桌面范围。
    let geometry = window_geometry::resolve(app, window_geometry::load(app));

    // 窗口标题跟项目定义走（tauri.conf.json 的 productName），不在代码里再写死一份。
    let title = app.package_info().name.clone();

    let builder = WebviewWindowBuilder::new(app, "main", url)
        .title(title)
        .inner_size(geometry.width, geometry.height)
        .min_inner_size(window_geometry::MIN_WIDTH, window_geometry::MIN_HEIGHT)
        .resizable(true)
        .decorations(decorations)
        .transparent(transparent)
        .maximized(geometry.maximized);

    // 首次运行（还没有存档位置）居中；之后还原到上次的位置。
    let builder = match geometry.position() {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };

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
    let win = window.clone();
    window.on_window_event(move |event| {
        // 关窗前落盘窗口几何（此刻窗口还在，能报告真实的正常态尺寸 / 位置）。
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            if let Some(window) = handle.get_window("main") {
                window_geometry::save_current(&handle, &window);
            }
            return;
        }
        if !matches!(event, WindowEvent::Resized(_)) {
            return;
        }
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
            // 旧版把窗口外观 / 几何放在 userData 根目录：先迁进数据目录，再读外观建窗
            appearance::migrate_legacy_config(app.handle());
            let current = appearance::load(app.handle());
            app.manage(AppState {
                appearance: Mutex::new(current.clone()),
            });
            app.manage(WebviewState {
                map: Arc::new(Mutex::new(HashMap::new())),
            });
            app.manage(Arc::new(treease::TreeaseState::default()));

            let window = create_main_window(app.handle()).map_err(
                |error| -> Box<dyn std::error::Error> {
                    std::io::Error::other(format!("create_main_window: {error}")).into()
                },
            )?;
            if let Some(main_window) = app.handle().get_window("main") {
                appearance::apply_effects(&main_window, &current);
            }
            hook_window_events(app.handle(), &window);
            let _ = window.set_focus();
            // 应用壳：注册工具域的缓存跳过路径（运行中沙箱 profile 不参与清理）
            app_domain::register_tool_skip_providers();
            // 拦截器：代理 / WS 桥 / 证书在后台线程初始化（不阻塞首帧）
            interceptor::setup(app.handle());
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
            // 首次退出请求：兜底落盘窗口几何（系统关机 / 外部关闭等不走 CloseRequested 的路径）
            if let Some(window) = handle.get_window("main") {
                window_geometry::save_current(handle, &window);
            }
            api.prevent_exit();
            let handle = handle.clone();
            let finished = finished.clone();
            std::thread::spawn(move || {
                // 拦截器代理 / WS 桥收尾
                interceptor::dispose();
                finished.store(true, Ordering::SeqCst);
                handle.exit(code.unwrap_or(0));
            });
        }
    });
}
