// workbuddy2api-panel 域：run/config.json 的初始化与 START 前强制项。
//
// 上游 workbuddy2api-panel 的 config.json 里 listen / api_key / update 三项由本工具接管：
// - listen 一律强制 `127.0.0.1:<port>`（不允许对外监听）；
// - update.auto_enabled 一律关掉（版本由本工具托管，上游自更新会绕过 manifest）；
// - api_key 为空 / 占位值时生成随机密钥（对齐上游「无 config 时 crypto/rand」）。
use super::{paths, store, DEFAULT_PORT};
use serde_json::{json, Map, Value};

const PLACEHOLDER_API_KEYS: [&str; 5] = ["", "test_key", "your-api-key", "changeme", "api_key"];

fn generate_api_key() -> String {
    // 24 字节随机 → base64url（与 Node randomBytes(24).toString('base64url') 同长度）
    let bytes: Vec<u8> = (0..24).map(|_| rand::random::<u8>()).collect();
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

fn ensure_real_api_key(config: &mut Map<String, Value>) {
    let current = config
        .get("api_key")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    if PLACEHOLDER_API_KEYS.contains(&current.as_str()) {
        config.insert("api_key".into(), json!(generate_api_key()));
    }
}

/// `":7863"` / `"127.0.0.1:7863"` / `"7863"` → 端口；非法回落 fallback。
pub fn parse_listen_port(listen: Option<&Value>, fallback: u16) -> u16 {
    let Some(text) = listen.and_then(Value::as_str) else {
        return fallback;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return fallback;
    }
    let digits = trimmed.rsplit(':').next().unwrap_or(trimmed).trim();
    digits
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .unwrap_or(fallback)
}

pub fn read_config_json() -> Option<Map<String, Value>> {
    let raw = std::fs::read_to_string(paths::config_path()).ok()?;
    serde_json::from_str::<Value>(&raw).ok()?.as_object().cloned()
}

pub fn resolve_configured_port(config: Option<&Map<String, Value>>) -> u16 {
    let settings = store::read_app_settings();
    match config {
        Some(config) => parse_listen_port(config.get("listen"), settings.port),
        None => settings.port.max(1),
    }
}

fn write_config(config: &Map<String, Value>) -> Result<(), String> {
    let body = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    crate::appearance::write_json_atomic(&paths::config_path(), &format!("{body}\n"))
}

fn find_example_config(current_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let direct = current_dir.join("config.example.json");
    if direct.is_file() {
        return Some(direct);
    }
    let legacy = current_dir.join("config.example");
    if legacy.is_file() {
        return Some(legacy);
    }
    let entries = std::fs::read_dir(current_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let nested = path.join("config.example.json");
        if nested.is_file() {
            return Some(nested);
        }
    }
    None
}

/// 无 run/config.json 时从 example 初始化（无 example 则写一份最小配置）。
pub fn ensure_run_config_initialized() -> Result<bool, String> {
    let config_path = paths::config_path();
    if config_path.is_file() {
        return Ok(false);
    }
    paths::ensure_dirs()?;

    let mut config = match find_example_config(&paths::current_dir()) {
        Some(example) => {
            let raw = std::fs::read_to_string(&example)
                .map_err(|error| format!("读取 {} 失败：{error}", example.display()))?;
            serde_json::from_str::<Value>(&raw)
                .ok()
                .and_then(|value| value.as_object().cloned())
                .unwrap_or_default()
        }
        None => Map::new(),
    };

    let port = parse_listen_port(config.get("listen"), DEFAULT_PORT);
    config.insert("listen".into(), json!(format!("127.0.0.1:{port}")));
    config
        .entry("auth_dir".to_string())
        .or_insert_with(|| json!("./auths"));
    config
        .entry("state_file".to_string())
        .or_insert_with(|| json!("./data/state.json"));

    let mut update = config
        .get("update")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    update.insert("auto_enabled".into(), json!(false));
    config.insert("update".into(), Value::Object(update));

    ensure_real_api_key(&mut config);
    write_config(&config)?;
    store::write_app_settings(&super::AppSettings { port })?;
    Ok(true)
}

/// START 前强制：listen=127.0.0.1:<port>、update.auto_enabled=false、真实 api_key。
pub fn enforce_start_config() -> Result<(u16, std::path::PathBuf), String> {
    std::fs::create_dir_all(paths::run_dir()).map_err(|error| error.to_string())?;
    let mut config = match read_config_json() {
        Some(config) => config,
        None => {
            ensure_run_config_initialized()?;
            read_config_json().ok_or("缺少 config.json，请先安装")?
        }
    };

    let port = resolve_configured_port(Some(&config));
    config.insert("listen".into(), json!(format!("127.0.0.1:{port}")));

    let mut update = config
        .get("update")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    update.insert("auto_enabled".into(), json!(false));
    config.insert("update".into(), Value::Object(update));

    // 早期安装可能已写入 example 的 test_key：每次 START 顺手换成随机密钥
    ensure_real_api_key(&mut config);

    write_config(&config)?;
    store::write_app_settings(&super::AppSettings { port })?;
    Ok((port, paths::config_path()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_listen_port_forms() {
        assert_eq!(parse_listen_port(Some(&json!(":8080")), 7863), 8080);
        assert_eq!(parse_listen_port(Some(&json!("127.0.0.1:9001")), 7863), 9001);
        assert_eq!(parse_listen_port(Some(&json!("7000")), 7863), 7000);
        assert_eq!(parse_listen_port(Some(&json!("")), 7863), 7863);
        assert_eq!(parse_listen_port(None, 7863), 7863);
        assert_eq!(parse_listen_port(Some(&json!("abc")), 7863), 7863);
    }
}
