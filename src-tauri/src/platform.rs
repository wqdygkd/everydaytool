// 平台能力（由 Rust 实现，Node 业务运行时通过 stdio RPC 调用）：
// 目录/文件对话框、打开路径、打开外链、WebView 缓存清理、独立 DevTools。
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub fn handle(app: &AppHandle, op: &str, args: &Value) -> Result<Value, String> {
    match op {
        "dialog.open" => open_dialog(app, args),
        "dialog.save" => save_dialog(app, args),
        "system.openPath" => open_path(app, args),
        "system.openExternal" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("缺少 url 参数")?;
            open_external(app, url)?;
            Ok(Value::Null)
        }
        "webview.clearCache" => clear_cache(app),
        "webview.openDevTools" => {
            open_devtools(app);
            Ok(Value::Null)
        }
        other => Err(format!("未实现的平台能力：{other}")),
    }
}

fn apply_filters(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    args: &Value,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    if let Some(filters) = args.get("filters").and_then(|v| v.as_array()) {
        for filter in filters {
            let name = filter
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("文件");
            let extensions: Vec<String> = filter
                .get("extensions")
                .and_then(|v| v.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|item| item.as_str())
                        .filter(|item| *item != "*")
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            if extensions.is_empty() {
                continue;
            }
            let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(name, &refs);
        }
    }
    builder
}

fn apply_default_path(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    args: &Value,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    if let Some(default_path) = args.get("defaultPath").and_then(|v| v.as_str()) {
        if !default_path.trim().is_empty() {
            let path = PathBuf::from(default_path);
            if let Some(parent) = path.parent() {
                if parent.exists() {
                    builder = builder.set_directory(parent);
                }
            }
            if let Some(name) = path.file_name() {
                let name = name.to_string_lossy();
                if !name.is_empty() {
                    builder = builder.set_file_name(name);
                }
            }
        }
    }
    builder
}

fn open_dialog(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let mut builder = app.dialog().file();
    if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
        builder = builder.set_title(title);
    }
    builder = apply_default_path(builder, args);
    builder = apply_filters(builder, args);

    let properties: Vec<String> = args
        .get("properties")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let is_directory = properties.iter().any(|p| p == "openDirectory");
    let multi = properties.iter().any(|p| p == "multiSelections");

    let files = if is_directory {
        if multi {
            builder.blocking_pick_folders().unwrap_or_default()
        } else {
            builder.blocking_pick_folder().into_iter().collect()
        }
    } else if multi {
        builder.blocking_pick_files().unwrap_or_default()
    } else {
        builder.blocking_pick_file().into_iter().collect()
    };

    let paths: Vec<String> = files
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    Ok(json!({ "filePaths": paths }))
}

fn save_dialog(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let mut builder = app.dialog().file();
    if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
        builder = builder.set_title(title);
    }
    builder = apply_default_path(builder, args);
    builder = apply_filters(builder, args);
    let file_path = builder
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().to_string());
    match file_path {
        Some(path) => Ok(json!({ "filePath": path })),
        None => Ok(json!({ "filePath": Value::Null })),
    }
}

fn open_path(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let target = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("缺少 path 参数")?;
    match app.opener().open_path(target.to_string(), None::<&str>) {
        Ok(()) => Ok(json!("")),
        Err(error) => Ok(json!(error.to_string())),
    }
}

pub fn open_external(app: &AppHandle, raw_url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(raw_url.trim()).map_err(|_| "外链格式不正确".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("仅允许打开 http(s) 外链".into());
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn clear_cache(app: &AppHandle) -> Result<Value, String> {
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    window
        .clear_all_browsing_data()
        .map_err(|error| error.to_string())?;
    Ok(Value::Null)
}

fn open_devtools(app: &AppHandle) {
    // 已打开时再次调用只会把它拉到前台
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
}
