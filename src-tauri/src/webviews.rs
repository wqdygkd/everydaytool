// Tauri 子 Webview 管理（env-browser / treease-editor）。
// 每个 webview 使用独立 WebView2 数据目录，
// 位置由渲染层按宿主 div 的 getBoundingClientRect 同步；导航 / 标题 / 新窗口事件经
// edt:webview 事件回推给渲染层。
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl,
    Window,
};

pub type WebviewMap = Arc<Mutex<HashMap<String, Webview<tauri::Wry>>>>;

fn file_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "地址格式不正确".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("仅支持 http(s) 地址".into());
    }
    Ok(url)
}

fn sanitize_id(id: &str) -> Result<String, String> {
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() || safe.len() > 64 {
        return Err("webview id 非法".into());
    }
    Ok(safe)
}

fn profile_dir(profile: &str) -> Result<PathBuf, String> {
    let safe = sanitize_id(profile)?;
    // 子 Webview profile 与主 WebView2 数据目录同根（即数据根目录下）：
    // <数据根目录>/webview-profiles/<profile>，跟随设置页的数据目录。
    let webview_dir = crate::appearance::webview_data_dir();
    let root = webview_dir.parent().unwrap_or(&webview_dir);
    let dir = root.join("webview-profiles").join(safe);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 WebView 数据目录失败：{e}"))?;
    Ok(dir)
}

fn emit_webview(app: &AppHandle, id: &str, payload: Value) {
    let _ = app.emit(
        "edt:webview",
        json!({
            "id": id,
            "kind": payload.get("kind").cloned().unwrap_or(Value::Null),
            "url": payload.get("url").cloned().unwrap_or(Value::Null),
            "title": payload.get("title").cloned().unwrap_or(Value::Null),
        }),
    );
}

#[tauri::command]
pub async fn edt_webview(
    app: AppHandle,
    webviews: tauri::State<'_, crate::WebviewState>,
    op: String,
    args: Value,
) -> Result<Value, String> {
    match op.as_str() {
        "create" => create_webview(app, webviews.map.clone(), args).await,
        "close" => {
            let id = sanitize_id(args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?)?;
            let webview = webviews
                .map
                .lock()
                .map_err(|_| "webview map lock")?
                .remove(&id);
            if let Some(webview) = webview {
                let _ = webview.close();
            }
            Ok(Value::Null)
        }
        "bounds" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            let webview = get_webview(&webviews.map, id)?;
            let x = number(&args, "x");
            let y = number(&args, "y");
            let width = number(&args, "width").max(0.0);
            let height = number(&args, "height").max(0.0);
            if width < 2.0 || height < 2.0 {
                let _ = webview.hide();
                return Ok(json!({ "visible": false }));
            }
            webview
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
            webview
                .set_size(LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            let _ = webview.show();
            Ok(json!({ "visible": true }))
        }
        "visible" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            let webview = get_webview(&webviews.map, id)?;
            if args
                .get("visible")
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
            {
                let _ = webview.show();
            } else {
                let _ = webview.hide();
            }
            Ok(Value::Null)
        }
        "navigate" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            let url = file_url(args.get("url").and_then(|v| v.as_str()).ok_or("缺少 url")?)?;
            let webview = get_webview(&webviews.map, id)?;
            webview.navigate(url).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "reload" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            get_webview(&webviews.map, id)?
                .reload()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "back" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            get_webview(&webviews.map, id)?
                .eval("history.back()")
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "forward" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            get_webview(&webviews.map, id)?
                .eval("history.forward()")
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "eval" => {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("缺少 id")?
                .to_string();
            let script = args
                .get("script")
                .and_then(|v| v.as_str())
                .ok_or("缺少 script")?
                .to_string();
            let webview = get_webview(&webviews.map, &id)?;
            let raw = eval_script(webview, &script)?;
            Ok(jparse(raw))
        }
        "url" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            let url = get_webview(&webviews.map, id)?
                .url()
                .map_err(|e| e.to_string())?;
            Ok(json!(url.to_string()))
        }
        "devtools" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
            let webview = get_webview(&webviews.map, id)?;
            let open = args
                .get("open")
                .and_then(|v| v.as_bool())
                .unwrap_or_else(|| !webview.is_devtools_open());
            if open {
                webview.open_devtools();
            } else {
                webview.close_devtools();
            }
            Ok(json!({ "open": open }))
        }
        other => Err(format!("未知 webview 操作：{other}")),
    }
}

pub(crate) fn get_webview(map: &WebviewMap, id: &str) -> Result<Webview<tauri::Wry>, String> {
    let guard = map.lock().map_err(|_| "webview map lock")?;
    guard
        .get(id)
        .cloned()
        .ok_or_else(|| format!("webview 不存在：{id}"))
}

fn number(args: &Value, key: &str) -> f64 {
    args.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

/// WebView2 的 ExecuteScriptAsync 不会等待 Promise；这里把表达式结果统一包装成
/// { ok, value } / 'PENDING:<key>'，由前端轮询 __edtEvalResults[key] 拿到异步结果
/// 每个调用独立 key，避免并发覆盖。
pub(crate) fn eval_script(webview: Webview<tauri::Wry>, script: &str) -> Result<String, String> {
    static EVAL_SEQ: AtomicU64 = AtomicU64::new(1);
    let key = format!("__edtEval_{}", EVAL_SEQ.fetch_add(1, Ordering::Relaxed));
    let wrapped = format!(
        "(function(){{try{{var __p=({script});if(__p&&typeof __p.then==='function'){{window.__edtEvalResults=window.__edtEvalResults||{{}};window.__edtEvalResults['{key}']=null;__p.then(function(v){{window.__edtEvalResults['{key}']={{ok:true,value:v}}}},function(e){{window.__edtEvalResults['{key}']={{ok:false,error:String(e)}}}});return 'PENDING:{key}'}}return {{ok:true,value:__p}}}}catch(e){{return {{ok:false,error:String(e)}}}}}})()"
    );
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .eval_with_callback(wrapped, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|_| "脚本执行超时".to_string())
}

fn jparse(raw: String) -> Value {
    match serde_json::from_str::<Value>(&raw) {
        Ok(value) => value,
        Err(_) => json!(raw),
    }
}

async fn create_webview(app: AppHandle, map: WebviewMap, args: Value) -> Result<Value, String> {
    let raw_id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("缺少 id")?
        .to_string();
    let id = sanitize_id(&raw_id)?;
    let url = file_url(args.get("url").and_then(|v| v.as_str()).ok_or("缺少 url")?)?;
    let profile = args
        .get("profile")
        .and_then(|v| v.as_str())
        .unwrap_or(&format!("webview-{id}"))
        .to_string();
    let user_agent = args
        .get("userAgent")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    // 关同源策略是 env-browser 的场景能力，收敛为 preset 白名单：
    // 渲染层只传 preset，其它调用点传 disableWebSecurity 一律报错（防止注入面扩大）
    if args.get("disableWebSecurity").is_some() {
        return Err(
            "disableWebSecurity 已移除：关闭同源策略仅限 env-browser，请改传 preset: 'env-browser'"
                .into(),
        );
    }
    let preset = args
        .get("preset")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // preset 白名单：除内置能力外一律视为「无预设」
    if !matches!(preset.as_str(), "" | "env-browser" | "treease" | "workbuddy") {
        return Err(format!("未知的 webview preset：{preset}"));
    }
    let insecure = preset == "env-browser";
    // workbuddy 面板只允许在本机地址内导航：面板里的外链 / OAuth 交系统浏览器
    let local_only = preset == "workbuddy";
    let x = number(&args, "x");
    let y = number(&args, "y");
    let width = number(&args, "width").max(0.0);
    let height = number(&args, "height").max(0.0);

    if map
        .lock()
        .map_err(|_| "webview map lock")?
        .contains_key(&id)
    {
        return Ok(json!({ "created": false }));
    }

    let dir = profile_dir(&profile)?;
    let label = format!("webview-{id}");
    let app_for_thread = app.clone();
    let map_for_thread = map.clone();
    let id_for_thread = id.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let window: Window = app_for_thread
            .get_window("main")
            .ok_or("主窗口不存在")?;

        let event_app = app_for_thread.clone();
        let event_id = id_for_thread.clone();
        let mut builder = WebviewBuilder::new(label, WebviewUrl::External(url))
            .focused(false)
            .devtools(true)
            .data_directory(dir)
            .on_page_load(move |_webview, payload| {
                let kind = match payload.event() {
                    PageLoadEvent::Started => "loading-start",
                    PageLoadEvent::Finished => "loading-stop",
                };
                emit_webview(
                    &event_app,
                    &event_id,
                    json!({ "kind": kind, "url": payload.url().to_string() }),
                );
            });

        if let Some(agent) = user_agent {
            builder = builder.user_agent(&agent);
        }
        if insecure {
            builder = builder.additional_browser_args(
                "--disable-web-security --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
            );
        }
        if preset == "treease" {
            // 接口拦截运行时：文档启动最早时刻注入，规则由 treease.rs 动态下发
            builder = builder.initialization_script_for_all_frames(include_str!(
                "../assets/treease-interceptor.js"
            ));
        }

        let nav_app = app_for_thread.clone();
        let nav_id = id_for_thread.clone();
        builder = builder.on_navigation(move |url| {
            // 只允许 web 导航；阻止 file: / tauri: / 自定义协议，避免远程页面跳进本地上下文。
            if !matches!(url.scheme(), "http" | "https" | "about") {
                return false;
            }
            // 面板类 webview：只在本机地址内跳转，其余按「新窗口」交渲染层开系统浏览器
            if local_only
                && !matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
            {
                emit_webview(
                    &nav_app,
                    &nav_id,
                    json!({ "kind": "new-window", "url": url.to_string() }),
                );
                return false;
            }
            emit_webview(
                &nav_app,
                &nav_id,
                json!({ "kind": "navigate", "url": url.to_string() }),
            );
            true
        });

        let new_window_app = app_for_thread.clone();
        let new_window_id = id_for_thread.clone();
        builder = builder.on_new_window(move |url, _features| {
            emit_webview(
                &new_window_app,
                &new_window_id,
                json!({ "kind": "new-window", "url": url.to_string() }),
            );
            NewWindowResponse::Deny
        });

        let title_app = app_for_thread.clone();
        let title_id = id_for_thread.clone();
        builder = builder.on_document_title_changed(move |_webview, title| {
            emit_webview(&title_app, &title_id, json!({ "kind": "title", "title": title }));
        });

        let webview = window
            .add_child(
                builder,
                LogicalPosition::new(x, y),
                LogicalSize::new(width.max(1.0), height.max(1.0)),
            )
            .map_err(|e| format!("创建 webview webview 失败：{e}"))?;

        map_for_thread
            .lock()
            .map_err(|_| "webview map lock")?
            .insert(id_for_thread.clone(), webview);
        Ok(())
    })
    .await
    .map_err(|e| format!("创建 webview 调度失败：{e}"))??;

    Ok(json!({ "created": true }))
}
