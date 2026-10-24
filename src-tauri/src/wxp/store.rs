// wxp-enhancer 域：设置 / 数据缓存 JSON 存储与收藏归一。
use crate::appearance::resolve_data_dir;
use serde_json::{json, Value};
use std::path::PathBuf;

pub fn default_settings() -> Value {
    json!({
        "executablePath": "",
        "debugPort": 9553,
        "cacheLogin": true,
        "showStatusBadge": true,
        "extraArgs": "",
    })
}

fn config_path() -> PathBuf {
    resolve_data_dir().join("wxp-enhancer").join("config.json")
}

fn cache_path() -> PathBuf {
    resolve_data_dir()
        .join("wxp-enhancer")
        .join("data-cache.json")
}

fn read_json(path: &PathBuf, fallback: Value) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(fallback)
}

fn write_json(path: &PathBuf, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, format!("{body}\n")).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("保存失败：{e}"))
}

/// 配置文件形状：{ settings, clearLoginCachePending }
pub fn config_all() -> Value {
    let stored = read_json(&config_path(), json!({}));
    let merged = {
        let mut settings = default_settings();
        if let (Some(target), Some(source)) = (
            settings.as_object_mut(),
            stored.get("settings").and_then(Value::as_object),
        ) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
        json!({
            "settings": settings,
            "clearLoginCachePending": stored.get("clearLoginCachePending").and_then(Value::as_bool) == Some(true),
        })
    };
    merged
}

pub fn settings() -> Value {
    config_all()["settings"].clone()
}

pub fn save_settings(patch: &Value) -> Result<Value, String> {
    let mut stored = read_json(&config_path(), json!({}));
    if let (Some(target), Some(source)) = (
        stored
            .as_object_mut()
            .map(|map| map.entry("settings").or_insert_with(|| json!({})))
            .and_then(|settings| settings.as_object_mut()),
        patch.as_object(),
    ) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    write_json(&config_path(), &stored)?;
    Ok(settings())
}

pub fn login_cache_clear_pending() -> bool {
    config_all()
        .get("clearLoginCachePending")
        .and_then(Value::as_bool)
        == Some(true)
}

pub fn set_login_cache_clear_pending(pending: bool) -> Result<(), String> {
    let mut stored = read_json(&config_path(), json!({}));
    stored["clearLoginCachePending"] = json!(pending);
    write_json(&config_path(), &stored)
}

pub fn data_cache() -> Value {
    read_json(&cache_path(), Value::Null)
}

pub fn set_data_cache(cache: &Value) -> Result<(), String> {
    write_json(&cache_path(), cache)
}

// ---- 收藏归一（对齐 shared/wxp-favorite.ts）----

fn text_of(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        value => value.to_string().trim_matches('"').trim().to_string(),
    }
}

/// 对象原样规范化；旧版 `|` 拼接字符串拆成对象；对不上的条目丢掉
pub fn normalize_favorites(raw: &Value) -> Vec<Value> {
    let Some(list) = raw.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in list {
        if let Some(record) = item.as_object() {
            let simple_name = record.get("simpleName").map(text_of).unwrap_or_default();
            if simple_name.is_empty() {
                continue;
            }
            out.push(json!({
                "sceneformal": record.get("sceneformal").map(text_of).unwrap_or_default(),
                "simpleName": simple_name,
                "accessPoint": record.get("accessPoint").map(text_of).unwrap_or_default(),
                "targetPoint": record.get("targetPoint").map(text_of).unwrap_or_default(),
                "hospital": record.get("hospital").map(text_of).unwrap_or_default(),
                "tenantId": record.get("tenantId").map(text_of).unwrap_or_default(),
                "code": record.get("code").map(text_of).unwrap_or_default(),
            }));
        } else if let Some(text) = item.as_str() {
            if !text.contains('|') {
                continue;
            }
            let parts: Vec<&str> = text.split('|').collect();
            let simple_name = parts.get(1).map(|s| s.trim()).unwrap_or_default();
            if simple_name.is_empty() {
                continue;
            }
            out.push(json!({
                "sceneformal": parts.first().copied().unwrap_or_default().trim(),
                "simpleName": simple_name,
                "accessPoint": parts.get(2).copied().unwrap_or_default().trim(),
                "targetPoint": parts[3..].join("|"),
                "hospital": "",
                "tenantId": "",
                "code": "",
            }));
        }
    }
    out
}

fn favorite_field(fav: &Value, key: &str) -> String {
    fav.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn same_favorite(a: &Value, b: &Value) -> bool {
    favorite_field(a, "sceneformal") == favorite_field(b, "sceneformal")
        && favorite_field(a, "simpleName") == favorite_field(b, "simpleName")
        && favorite_field(a, "accessPoint") == favorite_field(b, "accessPoint")
        && favorite_field(a, "targetPoint") == favorite_field(b, "targetPoint")
}

/// 保留页面已知医院名：页面缺 hospital 时从旧缓存补
pub fn keep_known_hospitals(page: &[Value], previous: &[Value]) -> Vec<Value> {
    page.iter()
        .map(|fav| {
            if !favorite_field(fav, "hospital").is_empty() {
                return fav.clone();
            }
            previous
                .iter()
                .find(|old| same_favorite(old, fav))
                .filter(|old| !favorite_field(old, "hospital").is_empty())
                .map(|old| {
                    let mut merged = fav.clone();
                    merged["hospital"] = old["hospital"].clone();
                    merged
                })
                .unwrap_or_else(|| fav.clone())
        })
        .collect()
}
