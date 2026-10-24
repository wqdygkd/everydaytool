// wxp-enhancer 域：命令分发（Rust 原生实现，命令名与 WXP_COMMANDS 一致）。
pub mod cdp;
pub mod injection;
pub mod process;
pub mod service;
pub mod store;

use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;

pub fn handle(app: &tauri::AppHandle, command: &str, args: &[Value]) -> Result<Value, String> {
    match command {
        "wxp:get-all" => {
            let config = store::config_all();
            Ok(json!({
                "settings": config["settings"],
                "clearLoginCachePending": config["clearLoginCachePending"],
                "running": service::running_state(),
            }))
        }
        "wxp:save-settings" => {
            let patch = args.first().cloned().ok_or("缺少设置内容")?;
            service::save_settings(app, &patch)
        }
        "wxp:select-executable" => {
            let picked = app
                .dialog()
                .file()
                .set_title("选择 WXP 可执行文件")
                .add_filter("可执行文件", &["exe"])
                .add_filter("所有文件", &["*"])
                .blocking_pick_file();
            match picked {
                Some(file) => {
                    let path = file.to_string();
                    Ok(json!(process::resolve_executable_path(&path)?))
                }
                None => Ok(Value::Null),
            }
        }
        "wxp:detect-executable" => Ok(match process::detect_wxp_executable() {
            Some(path) => json!(path),
            None => Value::Null,
        }),
        "wxp:launch" => service::launch(app),
        "wxp:stop" => service::stop(app).map(|stopped| json!(stopped)),
        "wxp:reinject" => service::reinject(app).map(|count| json!(count)),
        "wxp:clear-login-cache" => service::clear_login_cache(app),
        "wxp:get-data-cache" => Ok(store::data_cache()),
        "wxp:collect-data" => {
            let running = service::running_state();
            if running.is_null() {
                return Err("WXP 未在运行，无法读取数据；请先启动 WXP".into());
            }
            let port = running
                .get("port")
                .and_then(Value::as_i64)
                .unwrap_or_default() as u16;
            service::collect_data(app, port)
        }
        other => Err(format!("未实现的 WXP 命令：{other}")),
    }
}
