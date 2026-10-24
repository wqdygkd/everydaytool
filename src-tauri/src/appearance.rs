// 窗口外观（半透明 / 系统材质）：持久化 + 平台能力判定 + 应用到真实窗口。
// 数据契约：
//   - 配置文件：<userData>/window-appearance.json（userData = %APPDATA%/everydaytool 等）
//   - 字段：enabled / material / vibrancy / testWallpaper
//   - 平台裁剪规则：sanitizeWindowAppearance（shared/appearance.ts 的 Rust 等价实现）
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::SystemTime;
use tauri::utils::config::WindowEffectsConfig;
use tauri::utils::WindowEffect;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowAppearance {
    pub enabled: bool,
    pub material: String,
    pub vibrancy: String,
    pub test_wallpaper: bool,
}

impl Default for WindowAppearance {
    fn default() -> Self {
        Self {
            enabled: false,
            material: "none".into(),
            vibrancy: "none".into(),
            test_wallpaper: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowAppearanceCapabilities {
    pub supports_transparent: bool,
    pub supports_material: bool,
    pub materials: Vec<String>,
    pub vibrancies: Vec<String>,
    pub default_material: String,
    pub default_vibrancy: String,
}

const WIN32_MATERIAL_MIN_BUILD: u32 = 22_120;

/// 用户数据目录：不依赖 Tauri 的 identifier 目录，直接用平台环境变量，
/// dev / 便携 / 安装版得到同一路径。
pub fn default_user_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("EDT_USER_DATA") {
        return PathBuf::from(dir);
    }

    #[cfg(windows)]
    {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        appdata.join("everydaytool")
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        home.join("Library")
            .join("Application Support")
            .join("everydaytool")
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("everydaytool")
    }
}

/// 主窗口 WebView2 数据目录：
/// - `EDT_WEBVIEW_DATA_DIR` 显式覆盖（测试 / 多实例隔离）
/// - dev：项目内 `data/webview2`（避免沙箱 / 受限环境下 userData 不可写）
/// - 打包：`<userData>/webview2`
pub fn webview_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("EDT_WEBVIEW_DATA_DIR") {
        return PathBuf::from(dir);
    }
    if cfg!(dev) {
        let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        return project_root.join("data").join("webview2");
    }
    default_user_data_dir().join("webview2")
}

/// 测试 / 便携模式可通过 EDT_USER_DATA 覆盖；默认与桌面 userData 一致。
pub fn resolve_user_data_dir(_app: &AppHandle) -> PathBuf {
    default_user_data_dir()
}

fn is_writable_dir(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".edt-write-test");
    match fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// userData 在受限环境（沙箱 / 历史 ACL）下可能只读。此时回退到可写目录，
/// 保证外观设置既能生效也能持久化；load / save 始终解析到同一个路径。
fn fallback_config_dir(app: &AppHandle) -> PathBuf {
    if cfg!(dev) {
        let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        return project_root.join("data");
    }
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn primary_config_path(app: &AppHandle) -> PathBuf {
    resolve_user_data_dir(app).join("window-appearance.json")
}

fn fallback_config_path(app: &AppHandle) -> PathBuf {
    fallback_config_dir(app).join("window-appearance.json")
}

fn modified_at(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

/// 读取时同时考虑 userData 与回退目录，取较新的那份：
/// - 正常环境：只有 userData 一份，行为不变；
/// - userData 只读：首次仍能读到旧配置，之后优先读回退目录里的新值。
fn load_path(app: &AppHandle) -> PathBuf {
    let primary = primary_config_path(app);
    let fallback = fallback_config_path(app);
    match (modified_at(&primary), modified_at(&fallback)) {
        (Some(primary_time), Some(fallback_time)) => {
            if fallback_time > primary_time {
                fallback
            } else {
                primary
            }
        }
        (Some(_), None) => primary,
        (None, Some(_)) => fallback,
        _ => primary,
    }
}

fn save_path(app: &AppHandle) -> PathBuf {
    static SAVE_PATH: OnceLock<PathBuf> = OnceLock::new();
    SAVE_PATH
        .get_or_init(|| {
            let primary_dir = resolve_user_data_dir(app);
            if is_writable_dir(&primary_dir) {
                return primary_dir.join("window-appearance.json");
            }
            let fallback = fallback_config_dir(app);
            let _ = fs::create_dir_all(&fallback);
            eprintln!(
                "[appearance] userData 不可写，外观配置改存：{}",
                fallback.display()
            );
            fallback.join("window-appearance.json")
        })
        .clone()
}

#[cfg(windows)]
fn windows_build_number() -> Option<u32> {
    Some(windows_version::OsVersion::current().build)
}

pub fn resolve_capabilities() -> WindowAppearanceCapabilities {
    #[cfg(target_os = "macos")]
    {
        return WindowAppearanceCapabilities {
            supports_transparent: true,
            supports_material: false,
            materials: vec![],
            vibrancies: vec![
                "sidebar".into(),
                "hud".into(),
                "under-window".into(),
                "fullscreen-ui".into(),
            ],
            default_material: "none".into(),
            default_vibrancy: "sidebar".into(),
        };
    }

    #[cfg(windows)]
    {
        let supported = windows_build_number()
            .map(|build| build >= WIN32_MATERIAL_MIN_BUILD)
            .unwrap_or(false);
        WindowAppearanceCapabilities {
            supports_transparent: true,
            supports_material: supported,
            materials: if supported {
                vec!["mica".into(), "acrylic".into(), "tabbed".into()]
            } else {
                vec![]
            },
            vibrancies: vec![],
            default_material: if supported {
                "acrylic".into()
            } else {
                "none".into()
            },
            default_vibrancy: "none".into(),
        }
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        WindowAppearanceCapabilities {
            supports_transparent: false,
            supports_material: false,
            materials: vec![],
            vibrancies: vec![],
            default_material: "none".into(),
            default_vibrancy: "none".into(),
        }
    }
}

/// 只接受已知值，其余字段回落默认值（配置文件可能被手改坏）
fn normalize_stored(value: serde_json::Value) -> WindowAppearance {
    let materials = ["none", "mica", "acrylic", "tabbed"];
    let vibrancies = ["none", "sidebar", "hud", "under-window", "fullscreen-ui"];
    let material = value
        .get("material")
        .and_then(|v| v.as_str())
        .filter(|v| materials.contains(v))
        .unwrap_or("none");
    let vibrancy = value
        .get("vibrancy")
        .and_then(|v| v.as_str())
        .filter(|v| vibrancies.contains(v))
        .unwrap_or("none");
    WindowAppearance {
        enabled: value
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        material: material.into(),
        vibrancy: vibrancy.into(),
        test_wallpaper: value
            .get("testWallpaper")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

pub fn load(app: &AppHandle) -> WindowAppearance {
    let first = load_path(app);
    let primary = primary_config_path(app);
    let fallback = fallback_config_path(app);
    let second = if first == primary { fallback } else { primary };
    for path in [first, second] {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(value) => return normalize_stored(value),
            Err(_) => continue,
        }
    }
    WindowAppearance::default()
}

pub fn save(app: &AppHandle, appearance: &WindowAppearance) -> Result<(), String> {
    let path = save_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(appearance).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, format!("{body}\n")).map_err(|e| e.to_string())?;
    // 先写临时文件再替换，避免进程中断留下半截 JSON。
    // Windows 不允许 rename 覆盖已存在文件，此时退回 remove + rename。
    if fs::rename(&tmp, &path).is_err() {
        let _ = fs::remove_file(&path);
        if let Err(error) = fs::rename(&tmp, &path) {
            let _ = fs::remove_file(&tmp);
            return Err(error.to_string());
        }
    }
    Ok(())
}

pub fn sanitize(
    appearance: &WindowAppearance,
    capabilities: &WindowAppearanceCapabilities,
) -> WindowAppearance {
    let test_wallpaper = appearance.test_wallpaper;
    if !appearance.enabled || !capabilities.supports_transparent {
        return WindowAppearance {
            enabled: false,
            material: "none".into(),
            vibrancy: "none".into(),
            test_wallpaper,
        };
    }
    let material = if capabilities
        .materials
        .iter()
        .any(|m| m == &appearance.material)
    {
        appearance.material.clone()
    } else {
        "none".into()
    };
    let vibrancy = if capabilities
        .vibrancies
        .iter()
        .any(|v| v == &appearance.vibrancy)
    {
        appearance.vibrancy.clone()
    } else {
        "none".into()
    };
    WindowAppearance {
        enabled: true,
        material,
        vibrancy,
        test_wallpaper,
    }
}

fn effect_for(appearance: &WindowAppearance) -> Option<WindowEffect> {
    if !appearance.enabled {
        return None;
    }
    match appearance.vibrancy.as_str() {
        "sidebar" => return Some(WindowEffect::Sidebar),
        "hud" => return Some(WindowEffect::HudWindow),
        "under-window" => return Some(WindowEffect::UnderWindowBackground),
        "fullscreen-ui" => return Some(WindowEffect::FullScreenUI),
        _ => {}
    }
    match appearance.material.as_str() {
        "mica" => Some(WindowEffect::Mica),
        "acrylic" => Some(WindowEffect::Acrylic),
        "tabbed" => Some(WindowEffect::Tabbed),
        _ => None,
    }
}

pub fn apply_effects(window: &WebviewWindow, appearance: &WindowAppearance) {
    match effect_for(appearance) {
        Some(effect) => {
            let config = WindowEffectsConfig {
                effects: vec![effect],
                state: None,
                radius: None,
                color: None,
                interactive: false,
            };
            let _ = window.set_effects(config);
        }
        None => {
            let _ = window.set_effects(None::<WindowEffectsConfig>);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(supports_material: bool) -> WindowAppearanceCapabilities {
        WindowAppearanceCapabilities {
            supports_transparent: true,
            supports_material,
            materials: if supports_material {
                vec!["mica".into(), "acrylic".into(), "tabbed".into()]
            } else {
                vec![]
            },
            vibrancies: vec![],
            default_material: "none".into(),
            default_vibrancy: "none".into(),
        }
    }

    #[test]
    fn disabled_forces_opaque_but_keeps_wallpaper() {
        let appearance = WindowAppearance {
            enabled: false,
            material: "mica".into(),
            vibrancy: "sidebar".into(),
            test_wallpaper: true,
        };
        let safe = sanitize(&appearance, &caps(true));
        assert!(!safe.enabled);
        assert_eq!(safe.material, "none");
        assert_eq!(safe.vibrancy, "none");
        assert!(safe.test_wallpaper);
    }

    #[test]
    fn unsupported_material_falls_back_to_none() {
        let appearance = WindowAppearance {
            enabled: true,
            material: "mica".into(),
            vibrancy: "none".into(),
            test_wallpaper: false,
        };
        let safe = sanitize(&appearance, &caps(false));
        assert!(safe.enabled);
        assert_eq!(safe.material, "none");
    }

    #[test]
    fn known_material_is_preserved() {
        let appearance = WindowAppearance {
            enabled: true,
            material: "acrylic".into(),
            vibrancy: "none".into(),
            test_wallpaper: false,
        };
        let safe = sanitize(&appearance, &caps(true));
        assert_eq!(safe.material, "acrylic");
    }

    #[test]
    fn stored_values_are_normalized() {
        let normalized = normalize_stored(serde_json::json!({
            "enabled": true,
            "material": "unknown",
            "vibrancy": "hud",
            "testWallpaper": true
        }));
        assert!(normalized.enabled);
        assert_eq!(normalized.material, "none");
        assert_eq!(normalized.vibrancy, "hud");
        assert!(normalized.test_wallpaper);
    }
}
