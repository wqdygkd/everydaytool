// workbuddy2api-panel 域：JSON 文档存储（manifest / app-settings）。
use super::{paths, AppSettings, Manifest, DEFAULT_PORT};
use crate::appearance::write_json_atomic;

fn read_json(path: &std::path::Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn read_manifest() -> Option<Manifest> {
    let value = read_json(&paths::manifest_path())?;
    // 版本与资产名是判定「已安装」的最小事实：缺任一即视为无效 manifest
    value.get("version")?.as_str()?;
    value.get("assetName")?.as_str()?;
    serde_json::from_value(value).ok()
}

pub fn write_manifest(manifest: &Manifest) -> Result<(), String> {
    let body = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    write_json_atomic(&paths::manifest_path(), &format!("{body}\n"))
}

pub fn read_app_settings() -> AppSettings {
    let port = read_json(&paths::settings_path())
        .and_then(|value| value.get("port").and_then(|port| port.as_u64()))
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_PORT);
    AppSettings { port }
}

pub fn write_app_settings(settings: &AppSettings) -> Result<(), String> {
    let body = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    write_json_atomic(&paths::settings_path(), &format!("{body}\n"))
}
