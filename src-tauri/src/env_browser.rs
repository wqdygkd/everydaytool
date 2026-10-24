// 环境浏览器域：环境配置 CRUD（JSON 原子写存储，Rust 原生实现）。
// 命令契约与 shared/command-groups/env-browser.ts 一致，前端零改动。
use crate::appearance::resolve_data_dir;
use crate::iso_time::now_iso;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub remark: Option<String>,
    #[serde(default = "default_auto_login")]
    pub auto_login: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

fn default_auto_login() -> bool {
    true
}

fn store_path() -> PathBuf {
    resolve_data_dir().join("env-browser").join("configs.json")
}

/// 每次命令直接读盘（KB 级文件）：数据目录在设置页被修改后自动生效，无需缓存失效
fn load_all() -> Vec<EnvConfig> {
    let path = store_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_all(items: &[EnvConfig]) -> Result<(), String> {
    let path = store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    fs::write(&tmp, format!("{body}\n")).map_err(|e| format!("写入环境配置失败：{e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存环境配置失败：{e}"))
}

fn require_string(args: &[Value], index: usize, field: &str) -> Result<String, String> {
    args.get(index)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("缺少 {field}"))
}

fn handle_get_all() -> Result<Value, String> {
    let mut items = load_all();
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    serde_json::to_value(items).map_err(|e| e.to_string())
}

fn handle_create(args: &[Value]) -> Result<Value, String> {
    let payload = args.first().cloned().ok_or("缺少环境参数")?;
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or("缺少 name")?;
    let url = payload
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or("缺少 url")?;
    let username = payload
        .get("username")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or("缺少 username")?;
    let password = payload
        .get("password")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .ok_or("缺少 password")?;
    let now = now_iso();
    let env = EnvConfig {
        id: format!("env_{}", &uuid::Uuid::new_v4().simple().to_string()[..10]),
        name,
        url,
        username,
        password,
        remark: payload
            .get("remark")
            .and_then(Value::as_str)
            .map(str::to_string),
        auto_login: payload
            .get("autoLogin")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut items = load_all();
    items.push(env.clone());
    save_all(&items)?;
    serde_json::to_value(env).map_err(|e| e.to_string())
}

fn handle_update(args: &[Value]) -> Result<Value, String> {
    let id = require_string(args, 0, "id")?;
    let patch = args.get(1).cloned().ok_or("缺少更新内容")?;
    let mut items = load_all();
    let env = items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| "环境不存在".to_string())?;
    for field in ["name", "url", "username", "password", "remark"] {
        if let Some(value) = patch.get(field) {
            let text = value.as_str().map(str::to_string);
            match field {
                "remark" => env.remark = text,
                _ => {
                    let Some(text) = text else {
                        return Err(format!("{field} 必须是字符串"));
                    };
                    match field {
                        "name" => env.name = text,
                        "url" => env.url = text,
                        "username" => env.username = text,
                        _ => env.password = text,
                    }
                }
            }
        }
    }
    if let Some(value) = patch.get("autoLogin").and_then(Value::as_bool) {
        env.auto_login = value;
    }
    env.updated_at = Some(now_iso());
    let updated = env.clone();
    save_all(&items)?;
    serde_json::to_value(updated).map_err(|e| e.to_string())
}

fn handle_delete(args: &[Value]) -> Result<Value, String> {
    let id = require_string(args, 0, "id")?;
    let mut items = load_all();
    let before = items.len();
    items.retain(|item| item.id != id);
    let removed = items.len() != before;
    if removed {
        save_all(&items)?;
    }
    Ok(Value::Bool(removed))
}

/// env_browser_command 的本地分发；命令名与 ENV_BROWSER_COMMANDS 一致
pub fn handle(command: &str, args: &[Value]) -> Result<Value, String> {
    match command {
        "env-browser:get-all" => handle_get_all(),
        "env-browser:create" => handle_create(args),
        "env-browser:update" => handle_update(args),
        "env-browser:delete" => handle_delete(args),
        other => Err(format!("未实现的环境浏览器命令：{other}")),
    }
}
