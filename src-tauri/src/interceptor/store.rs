// interceptor 域：名单 / 规则 JSON 存储（含 v2–v5 结构迁移，对齐 Node 版 config-store.ts / rules-store.ts）。
use super::origin::{normalize_target_host_input, origin_of, parse_target_origin};
use crate::appearance::resolve_data_dir;
use serde_json::{json, Value};
use std::path::PathBuf;

fn data_dir() -> PathBuf {
    resolve_data_dir().join("interceptor")
}

fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

fn rules_path() -> PathBuf {
    data_dir().join("rules.json")
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

// ---- 配置（代理端口 + 处理名单）----

fn parse_port(value: Option<&Value>) -> Option<i64> {
    let port = value.and_then(Value::as_i64)?;
    // 端口范围校验由调用方（常量 MIN/MAX）限定；这里只要求正整数
    (port > 0).then_some(port)
}

/// 一条已存记录 → origin（v5 直接读，老结构按主机 + 默认 scheme 重建），不合法返回 None
fn target_origin_from_record(candidate: &Value) -> Option<String> {
    let record = candidate.as_object()?;
    if let Some(origin) = record.get("origin").and_then(Value::as_str) {
        return parse_target_origin(origin);
    }
    // v2 / v3 / v4 老结构取主机与端口；正则条目无法在 origin 级表达，丢弃
    let source = record.get("source").and_then(Value::as_object);
    let raw_host = source
        .and_then(|s| s.get("value"))
        .and_then(Value::as_str)
        .filter(|_| {
            source
                .and_then(|s| s.get("operator"))
                .and_then(Value::as_str)
                != Some("matches")
        })
        .map(|host| host.to_string())
        .or_else(|| {
            if record.get("matchType").and_then(Value::as_str) == Some("regex") {
                return None;
            }
            record
                .get("host")
                .and_then(Value::as_str)
                .map(|host| host.to_string())
        })
        .map(|host| host.trim().to_string())
        .filter(|host| !host.is_empty())?;
    let parsed = normalize_target_host_input(&raw_host)?;
    let port = record
        .get("port")
        .and_then(Value::as_i64)
        .filter(|p| *p > 0 && *p <= 65535);
    let scheme =
        if parsed.host == "localhost" || parsed.host == "::1" || parsed.host.starts_with("127.") {
            "http"
        } else {
            "https"
        };
    Some(origin_of(scheme, &parsed.host, port.or(parsed.port)))
}

fn migrate_targets(raw: Option<&Value>) -> (Vec<Value>, bool) {
    let Some(list) = raw.and_then(Value::as_array) else {
        return (Vec::new(), raw.is_some());
    };
    let mut targets = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut migrated = false;

    for item in list {
        let Some(record) = item.as_object() else {
            migrated = true;
            continue;
        };
        let candidate = Value::Object(record.clone());
        let Some(origin) = target_origin_from_record(&candidate) else {
            migrated = true;
            continue;
        };
        let origin_changed = record.get("origin").and_then(Value::as_str) != Some(origin.as_str());
        if origin_changed {
            migrated = true;
        }
        if !seen.insert(origin.clone()) {
            // 迁移撞车（多条目归一成同一 origin）：合并成一条
            migrated = true;
            continue;
        }
        if record.get("enabled").is_none() || record.get("createdAt").is_none() {
            migrated = true;
        }
        if record.contains_key("includeSubdomains")
            || record.contains_key("matchReferrer")
            || record.contains_key("disabledHosts")
        {
            migrated = true;
        }
        if record.get("noCache").and_then(Value::as_bool).is_none() {
            migrated = true;
        }
        let id = match record.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => {
                migrated = true;
                uuid::Uuid::new_v4().to_string()
            }
        };
        targets.push(json!({
            "id": id,
            "origin": origin,
            "enabled": record.get("enabled").and_then(Value::as_bool) != Some(false),
            "noCache": record.get("noCache").and_then(Value::as_bool) != Some(false),
            "createdAt": record.get("createdAt").and_then(Value::as_str)
                .unwrap_or(&crate::iso_time::now_iso()),
        }));
    }
    (targets, migrated)
}

/// 读取配置；首次访问把迁移后的结构落盘（旧 token 字段丢弃）
pub fn load_config() -> Result<(Option<i64>, Vec<Value>), String> {
    let raw = read_json(&config_path(), json!({}));
    let (targets, migrated) = migrate_targets(raw.get("targets"));
    let proxy_port = parse_port(raw.get("proxyPort"));
    let needs_rewrite = !raw.as_object().is_some_and(|m| m.contains_key("proxyPort"))
        || migrated
        || raw.as_object().is_some_and(|m| m.contains_key("token"));
    if needs_rewrite {
        save_config(proxy_port, &targets)?;
    }
    Ok((proxy_port, targets))
}

pub fn save_config(proxy_port: Option<i64>, targets: &[Value]) -> Result<(), String> {
    write_json(
        &config_path(),
        &json!({ "proxyPort": proxy_port, "targets": targets }),
    )
}

pub fn persist(proxy_port: Option<i64>, targets: &[Value]) -> Result<(), String> {
    save_config(proxy_port, targets)
}

/// 数据目录切换后重置（本模块按命令读取文件，无长驻缓存；保留接口与其它域一致）
pub fn reset_caches() {}

// ---- 规则 ----

pub fn load_rules() -> Vec<Value> {
    let raw = read_json(&rules_path(), json!({}));
    raw.get("rules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

pub fn upsert_rule(rule: Value) -> Result<Vec<Value>, String> {
    let mut rules = load_rules();
    let id = rule.get("id").and_then(Value::as_str).unwrap_or_default();
    let index = rules
        .iter()
        .position(|item| item.get("id").and_then(Value::as_str) == Some(id));
    match index {
        Some(index) => rules[index] = rule,
        None => rules.push(rule),
    }
    save_rules(&rules)?;
    Ok(rules)
}

pub fn delete_rule(rule_id: &str) -> Result<Vec<Value>, String> {
    let mut rules = load_rules();
    rules.retain(|rule| rule.get("id").and_then(Value::as_str) != Some(rule_id));
    save_rules(&rules)?;
    Ok(rules)
}

pub fn save_rules(rules: &[Value]) -> Result<(), String> {
    write_json(&rules_path(), &json!({ "rules": rules }))
}

/// 旧版独立脚本（scripts.json）一次性迁移为 script 规则；迁移后旧文件清空（幂等）
pub fn migrate_legacy_scripts() -> Result<usize, String> {
    let legacy_path = data_dir().join("scripts.json");
    let raw = read_json(&legacy_path, json!({}));
    let Some(legacy) = raw.get("scripts").and_then(Value::as_array) else {
        return Ok(0);
    };
    if legacy.is_empty() {
        return Ok(0);
    }
    let mut rules = load_rules();
    let mut migrated = 0;
    for script in legacy {
        let Some(id) = script.get("id").and_then(Value::as_str) else {
            continue;
        };
        if rules
            .iter()
            .any(|rule| rule.get("id").and_then(Value::as_str) == Some(id))
        {
            continue;
        }
        let pattern = script
            .get("matches")
            .and_then(Value::as_array)
            .and_then(|matches| {
                matches
                    .iter()
                    .find(|m| m.as_str().map(|s| s != "*://*/*").unwrap_or(false))
                    .and_then(Value::as_str)
            });
        let source = match pattern {
            Some(pattern) => json!({ "key": "url", "operator": "wildcard", "value": pattern }),
            None => json!({ "key": "url", "operator": "contains", "value": "" }),
        };
        rules.push(json!({
            "id": id,
            "name": script.get("name").and_then(Value::as_str).unwrap_or("未命名脚本"),
            "enabled": script.get("enabled").and_then(Value::as_bool) != Some(false),
            "type": "script",
            "source": source,
            "script": {
                "code": script.get("code").cloned().unwrap_or(json!("")),
                "world": script.get("world").cloned().unwrap_or(json!("MAIN")),
                "runAt": script.get("runAt").cloned().unwrap_or(json!("document_start")),
            },
            "updatedAt": script.get("updatedAt").cloned().unwrap_or(json!(crate::iso_time::now_iso())),
        }));
        migrated += 1;
    }
    if migrated > 0 {
        save_rules(&rules)?;
    }
    write_json(&legacy_path, &json!({ "scripts": [] }))?;
    Ok(migrated)
}
