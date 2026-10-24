// offline-pack 域：下载历史（JSON 原子写，上限 200 条）。
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub kind: String,
    pub filename: String,
    pub saved_path: String,
    pub size: u64,
    pub created_at: String,
}

const MAX_HISTORY: usize = 200;

fn history_path() -> PathBuf {
    crate::appearance::resolve_data_dir()
        .join("offline-pack")
        .join("history.json")
}

fn load() -> Vec<HistoryItem> {
    std::fs::read_to_string(history_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(items: &[HistoryItem]) -> Result<(), String> {
    let path = history_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, format!("{body}\n")).map_err(|e| format!("写入历史失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存历史失败：{e}"))
}

pub fn add_history(kind: &str, filename: &str, saved_path: &str) -> Result<(), String> {
    let size = std::fs::metadata(saved_path).map(|m| m.len()).unwrap_or(0);
    let item = HistoryItem {
        id: uuid::Uuid::new_v4().to_string(),
        kind: kind.to_string(),
        filename: filename.to_string(),
        saved_path: saved_path.to_string(),
        size,
        created_at: crate::iso_time::now_iso(),
    };
    let mut items = load();
    items.insert(0, item);
    items.truncate(MAX_HISTORY);
    save(&items)
}

pub fn list() -> Result<Value, String> {
    serde_json::to_value(load()).map_err(|e| e.to_string())
}

pub fn delete(id: &str, delete_file: bool) -> Result<Value, String> {
    let items = load();
    if let Some(target) = items.iter().find(|item| item.id == id) {
        if delete_file {
            let path = std::path::Path::new(&target.saved_path);
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(path);
            } else if path.exists() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    let mut items = items;
    items.retain(|item| item.id != id);
    save(&items)?;
    serde_json::to_value(items).map_err(|e| e.to_string())
}

pub fn clear(delete_files: bool) -> Result<Value, String> {
    let items = load();
    if delete_files {
        for item in &items {
            let path = std::path::Path::new(&item.saved_path);
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(path);
            } else if path.exists() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    save(&[])?;
    Ok(Value::Null)
}
