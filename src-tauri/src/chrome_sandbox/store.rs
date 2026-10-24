// chrome-sandbox 域：沙箱 / 指纹 / 配置的 JSON 存储（原子写，按命令读盘）。
use crate::appearance::{default_user_data_dir, resolve_data_dir};
use crate::iso_time::now_iso;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disable_safety_checks: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disable_cors: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_args: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SandboxMetadata {
    pub inherit_extensions: Option<bool>,
    pub launch_options: Option<LaunchOptions>,
    pub developer_mode_enabled: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sandbox {
    pub id: String,
    pub name: String,
    pub category: Option<String>,
    pub color: Option<String>,
    pub user_data_path: String,
    pub chrome_pid: Option<i64>,
    pub status: String,
    pub fingerprint_id: Option<String>,
    pub created_at: Option<String>,
    pub last_used_at: Option<String>,
    pub last_active_at: Option<String>,
    pub metadata: Option<SandboxMetadata>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub id: String,
    pub navigator: FingerprintNavigator,
    pub canvas: FingerprintCanvas,
    pub webgl: FingerprintWebgl,
    pub screen: FingerprintScreen,
    pub audio: FingerprintAudio,
    pub timezone: FingerprintTimezone,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintNavigator {
    pub user_agent: String,
    pub platform: String,
    pub language: String,
    pub hardware_concurrency: i64,
    pub device_memory: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintCanvas {
    pub noise_level: String,
    pub noise_seed: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintWebgl {
    pub vendor: String,
    pub renderer: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintScreen {
    pub width: i64,
    pub height: i64,
    pub color_depth: i64,
    pub device_pixel_ratio: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintAudio {
    pub noise_enabled: bool,
    pub noise_level: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintTimezone {
    pub offset: i64,
    pub name: String,
}

fn data_file(name: &str) -> PathBuf {
    resolve_data_dir().join("chrome-sandbox").join(name)
}

fn read_json_file(path: &PathBuf, fallback: Value) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(fallback)
}

fn write_json_file(path: &PathBuf, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, format!("{body}\n")).map_err(|e| format!("写入失败：{e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("保存失败：{e}"))
}

// ---- 沙箱列表 ----

pub fn load_sandboxes() -> Vec<Sandbox> {
    serde_json::from_value(read_json_file(&data_file("sandboxes.json"), json!([])))
        .unwrap_or_default()
}

pub fn save_sandboxes(items: &[Sandbox]) -> Result<(), String> {
    write_json_file(
        &data_file("sandboxes.json"),
        &serde_json::to_value(items).unwrap(),
    )
}

pub fn find_sandbox(id: &str) -> Option<Sandbox> {
    load_sandboxes().into_iter().find(|s| s.id == id)
}

pub fn update_sandbox_fields(id: &str, patch: &Value) -> Option<Sandbox> {
    let mut items = load_sandboxes();
    let index = items.iter().position(|s| s.id == id)?;
    let mut value = serde_json::to_value(&items[index]).ok()?;
    if let Some(map) = value.as_object_mut() {
        for (key, new) in patch.as_object()? {
            map.insert(key.clone(), new.clone());
        }
    }
    items[index] = serde_json::from_value(value).ok()?;
    let updated = items[index].clone();
    save_sandboxes(&items).ok()?;
    Some(updated)
}

// ---- 指纹列表 ----

pub fn load_fingerprints() -> Vec<Fingerprint> {
    serde_json::from_value(read_json_file(&data_file("fingerprints.json"), json!([])))
        .unwrap_or_default()
}

pub fn save_fingerprints(items: &[Fingerprint]) -> Result<(), String> {
    write_json_file(
        &data_file("fingerprints.json"),
        &serde_json::to_value(items).unwrap(),
    )
}

pub fn find_fingerprint(id: &str) -> Option<Fingerprint> {
    load_fingerprints().into_iter().find(|f| f.id == id)
}

/// 分组浅合并：只覆盖 patch 里显式出现的叶子字段（对齐 Node 版 update 语义）
pub fn upsert_fingerprint_patch(id: &str, patch: &Value) -> Option<Fingerprint> {
    let mut items = load_fingerprints();
    let index = items.iter().position(|f| f.id == id)?;
    let mut value = serde_json::to_value(&items[index]).ok()?;
    for section in [
        "navigator",
        "canvas",
        "webgl",
        "screen",
        "audio",
        "timezone",
    ] {
        if let Some(new_section) = patch.get(section).and_then(Value::as_object) {
            if let Some(target) = value.get_mut(section).and_then(Value::as_object_mut) {
                for (key, new) in new_section {
                    target.insert(key.clone(), new.clone());
                }
            }
        }
    }
    items[index] = serde_json::from_value(value).ok()?;
    items[index].updated_at = Some(now_iso());
    let updated = items[index].clone();
    save_fingerprints(&items).ok()?;
    Some(updated)
}

pub fn push_fingerprint(fingerprint: &Fingerprint) -> Result<(), String> {
    let mut items = load_fingerprints();
    items.push(fingerprint.clone());
    save_fingerprints(&items)
}

pub fn delete_fingerprint(id: &str) {
    let mut items = load_fingerprints();
    items.retain(|f| f.id != id);
    let _ = save_fingerprints(&items);
}

// ---- 配置 ----

pub fn config_defaults() -> Value {
    json!({
        "chromePath": "",
        "defaultProfile": "",
        "dataDirectory": "",
        "autoRestoreOnStartup": false,
        "preserveDataOnClose": true,
    })
}

/// 合并默认值 + 用户改过的键；dataDirectory 永远以数据根目录实时值为准
pub fn config_all() -> Value {
    let stored = read_json_file(&data_file("config.json"), json!({}));
    let mut merged = config_defaults();
    if let (Some(target), Some(source)) = (merged.as_object_mut(), stored.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    merged["dataDirectory"] = json!(resolve_data_dir().to_string_lossy());
    merged
}

pub fn config_update(patch: &Value) -> Result<Value, String> {
    let mut stored = read_json_file(&data_file("config.json"), json!({}));
    if let (Some(target), Some(source)) = (stored.as_object_mut(), patch.as_object()) {
        for (key, value) in source {
            // 数据目录变更统一走平台级 edt-app:data-directory:update，这里忽略该键
            if key == "dataDirectory" {
                continue;
            }
            target.insert(key.clone(), value.clone());
        }
    }
    write_json_file(&data_file("config.json"), &stored)?;
    Ok(config_all())
}

pub fn config_get_string(key: &str) -> Option<String> {
    config_all()
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

// ---- setup 状态（对应 Node 侧 config-setup.ts / data-root.ts） ----

fn setup_state_path() -> PathBuf {
    default_user_data_dir().join("setup-state.json")
}

fn bootstrap_config_path() -> PathBuf {
    default_user_data_dir().join("data-root.json")
}

pub fn is_data_directory_configured() -> bool {
    let state = read_json_file(&setup_state_path(), json!({}));
    if state
        .get("dataDirectoryConfigured")
        .and_then(Value::as_bool)
        == Some(true)
    {
        return true;
    }
    bootstrap_config_path().exists()
}

pub fn mark_data_directory_configured() {
    let _ = write_json_file(
        &setup_state_path(),
        &json!({ "dataDirectoryConfigured": true }),
    );
}

/// config:get 的返回：附带给导流页用的 setup 状态
pub fn with_setup_state(config: Value, extra: Option<Value>) -> Value {
    let mut configured = is_data_directory_configured();
    if !configured && !load_sandboxes().is_empty() {
        mark_data_directory_configured();
        configured = true;
    }
    let mut result = config;
    result["dataDirectory"] = if configured {
        result["dataDirectory"].clone()
    } else {
        json!("")
    };
    result["dataDirectoryConfigured"] = json!(configured);
    if let Some(extra) = extra {
        if let (Some(target), Some(source)) = (result.as_object_mut(), extra.as_object()) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    result
}
