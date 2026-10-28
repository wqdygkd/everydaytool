// 窗口外观（半透明 / 系统材质）：持久化 + 平台能力判定 + 应用到真实窗口。
// 数据契约：
//   - 配置文件：<数据目录>/window-appearance.json（数据目录 = resolve_data_dir()，设置页可改）
//   - 字段：enabled / material / vibrancy / testWallpaper
//   - 平台裁剪规则：sanitizeWindowAppearance（shared/appearance.ts 的 Rust 等价实现）
//   - 引导文件（data-root.json / setup-state.json）仍固定在 userData：它们决定数据目录在哪。
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;
use tauri::utils::config::WindowEffectsConfig;
use tauri::utils::WindowEffect;
use tauri::{AppHandle, Manager};

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

/// Windows 11 22H2 起才有系统材质（mica / acrylic）；只在 Windows 分支用，故按平台门控，
/// 否则 macOS / Linux 上会以「未使用的常量」告警。
#[cfg(windows)]
const WIN32_MATERIAL_MIN_BUILD: u32 = 22_120;

/// userData 目录名：安装版用应用名本身，开发态（`pnpm dev`，即 debug 构建）加 `-dev` 后缀。
///
/// **安装版与开发版并存**：两者共用同一个 userData 会让引导配置（data-root.json /
/// setup-state.json）互相覆盖，一改数据目录另一边就跟着走；分开之后两种形态各自记账，
/// 可以同时运行、各自的「数据目录」选择互不干扰。数据目录本身仍按形态分开
/// （dev 默认仓库 `data/`，安装版默认 `<userData>/data`）。
pub fn user_data_dir_name() -> &'static str {
    if cfg!(dev) {
        "everydaytool-dev"
    } else {
        "everydaytool"
    }
}

/// 用户数据目录：不依赖 Tauri 的 identifier 目录，直接用平台环境变量。
/// `EDT_USER_DATA` 可显式覆盖（测试 / 便携 / 多实例隔离）。
pub fn default_user_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("EDT_USER_DATA") {
        return PathBuf::from(dir);
    }

    #[cfg(windows)]
    {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        appdata.join(user_data_dir_name())
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        home.join("Library")
            .join("Application Support")
            .join(user_data_dir_name())
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .unwrap_or_else(|| PathBuf::from("."));
        base.join(user_data_dir_name())
    }
}

/// 数据根目录的用户覆盖（<userData>/data-root.json，设置页写入）。
/// 与 Node 侧 server/utils/data-root.ts 读同一份文件；解析失败按无覆盖处理。
fn data_root_override() -> Option<PathBuf> {
    let file = default_user_data_dir().join("data-root.json");
    let raw = fs::read_to_string(file).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let dir = value.get("dataDirectory")?.as_str()?.trim();
    if dir.is_empty() {
        None
    } else {
        Some(PathBuf::from(dir))
    }
}

/// 默认数据根目录（未做用户覆盖时）：
/// dev 用项目 `data/`，安装版用 `<userData>/data`。
pub fn default_data_dir() -> PathBuf {
    if cfg!(dev) {
        let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        return project_root.join("data");
    }
    default_user_data_dir().join("data")
}

/// 数据根目录：与 Node 侧 getDataDirectory() 保持同一解析顺序——
/// 覆盖优先；dev 用项目 data/，打包用 <userData>/data。
pub fn resolve_data_dir() -> PathBuf {
    if let Some(dir) = data_root_override() {
        return dir;
    }
    if cfg!(dev) {
        let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        return project_root.join("data");
    }
    default_user_data_dir().join("data")
}

// ── 数据目录切换（pending → 下次启动整体迁移） ────────────────────────────────

/// 待切换标记：`<userData>/data-root.pending.json`。
/// 设置页只写这一份，**不立即切换**——运行中的工具已经握着旧目录里的文件句柄，
/// 中途换目录只能搬一半；因此统一下次启动、任何句柄打开之前整体迁移。
fn pending_data_dir_file() -> PathBuf {
    default_user_data_dir().join("data-root.pending.json")
}

/// 已请求但尚未生效的目标目录（无 pending / 解析失败按无处理）。
pub fn read_pending_data_dir() -> Option<PathBuf> {
    let raw = fs::read_to_string(pending_data_dir_file()).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let dir = value.get("dataDirectory")?.as_str()?.trim();
    if dir.is_empty() {
        None
    } else {
        Some(PathBuf::from(dir))
    }
}

/// 记录待切换目标目录（只落盘，不切换）。
pub fn write_pending_data_dir(dir: &Path) -> Result<(), String> {
    let file = pending_data_dir_file();
    let body = serde_json::json!({ "dataDirectory": dir.to_string_lossy() });
    write_json_atomic(&file, &format!("{body}\n"))
}

/// 清掉待切换标记（用户改回当前目录 / 迁移完成）。
pub fn clear_pending_data_dir() {
    let _ = fs::remove_file(pending_data_dir_file());
}

/// 写入 / 清除数据目录覆盖（`<userData>/data-root.json` + `data-root.path` 镜像）。
/// 这两个文件决定「数据目录在哪」，必须留在 userData（放进数据目录会形成循环依赖）。
pub fn save_data_dir_override(target: Option<&Path>) -> Result<(), String> {
    let user_data = default_user_data_dir();
    let bootstrap = user_data.join("data-root.json");
    let mirror = user_data.join("data-root.path");
    let _ = fs::create_dir_all(&user_data);

    match target {
        Some(dir) => {
            let body = serde_json::json!({ "dataDirectory": dir.to_string_lossy() });
            write_json_atomic(&bootstrap, &format!("{body}\n"))
                .map_err(|error| format!("写入数据目录配置失败：{error}"))?;
            fs::write(&mirror, dir.to_string_lossy().as_bytes())
                .map_err(|error| format!("写入数据目录镜像失败：{error}"))?;
        }
        None => {
            let _ = fs::remove_file(&bootstrap);
            let _ = fs::remove_file(&mirror);
        }
    }
    Ok(())
}

/// **启动期第一件事**：存在 pending 时先把当前数据目录整体迁移到目标目录，
/// 全部复制成功后才切换并删除源目录；失败则继续使用旧目录（pending 保留，下次重试）。
///
/// 必须在任何 `resolve_data_dir()` 使用者之前调用：webview 数据目录、日志目录、
/// 应用级配置与应用建窗都依赖它，晚一步就会一半读旧目录、一半读新目录。
pub fn apply_pending_data_migration() {
    let Some(pending) = read_pending_data_dir() else {
        return;
    };
    let current = resolve_data_dir();
    if current == pending {
        clear_pending_data_dir();
        return;
    }

    match crate::data_migration::migrate_data_directory(&current, &pending) {
        Ok(outcome) => {
            let target = if pending == default_data_dir() {
                None
            } else {
                Some(pending.as_path())
            };
            if let Err(error) = save_data_dir_override(target) {
                log::warn!("[data] 迁移完成但写入数据目录配置失败：{error}");
                return;
            }
            clear_pending_data_dir();
            invalidate_config_paths();
            log::info!(
                "[data] 数据目录切换完成：{}（迁移 {} 项，源目录 {}）",
                pending.display(),
                outcome.moved.len(),
                current.display()
            );
        }
        Err(error) => log::warn!("[data] 待切换的数据目录迁移失败，继续使用当前目录：{error}"),
    }
}

/// 主窗口 WebView2 数据目录：跟随数据根目录（设置页改目录后，下次启动生效）。
/// - `EDT_WEBVIEW_DATA_DIR` 显式覆盖（测试 / 多实例隔离）
/// - 默认 `<数据根目录>/webview2`
pub fn webview_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("EDT_WEBVIEW_DATA_DIR") {
        return PathBuf::from(dir);
    }
    resolve_data_dir().join("webview2")
}

/// 测试 / 便携模式可通过 EDT_USER_DATA 覆盖；默认与桌面 userData 一致。
pub fn resolve_user_data_dir(_app: &AppHandle) -> PathBuf {
    default_user_data_dir()
}

pub(crate) fn is_writable_dir(dir: &Path) -> bool {
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

/// 最终回退目录：数据目录与 userData 都不可写时（受限环境 / 历史 ACL）用它兜底，
/// 保证外观设置既能生效也能持久化。
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

fn modified_at(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

/// 应用级配置（窗口外观 / 窗口几何）所在目录：数据根目录。
/// 跟着「数据目录」走——设置页里那一处就是用户眼中的应用配置区；
/// 而 data-root.json / setup-state.json 这类决定数据目录在哪的引导文件必须留在 userData。
pub(crate) fn config_dir() -> PathBuf {
    resolve_data_dir()
}

/// 日志目录解析（tauri-plugin-log 的 Folder 目标用）：数据根 `logs` 优先——
/// dev 时在仓库 data/ 内、打包时随数据目录走（设置页「打开数据目录」即可达）；
/// 回退 %LOCALAPPDATA%\<identifier>\logs（tauri LogDir 的标准语义）。
/// 候选全部不可写时返回 None，调用方只保留 stdout 目标——日志初始化失败不能带走应用。
pub fn resolve_log_dir() -> Option<PathBuf> {
    let mut candidates = vec![resolve_data_dir().join("logs")];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("com.edt.everydaytool")
                .join("logs"),
        );
    }
    candidates.into_iter().find(|dir| is_writable_dir(dir))
}

/// 旧版把这两份配置放在 userData 根目录（userData 只读时还写进过回退目录），
/// 保留为读取来源并做一次性迁移；换数据目录时也按这份清单搬运。
/// 几何文件名与 `window_geometry.rs::FILE_NAME` 保持一致。
const CONFIG_FILES: [&str; 2] = ["window-appearance.json", "window-geometry.json"];

fn legacy_config_dirs(app: &AppHandle) -> [PathBuf; 2] {
    [resolve_user_data_dir(app), fallback_config_dir(app)]
}

/// 读取顺序：数据目录优先；旧位置按修改时间从新到旧兜底
/// （userData 只读的旧版环境曾把新值写到回退目录）。
pub(crate) fn config_read_paths(app: &AppHandle, file: &str) -> Vec<PathBuf> {
    let primary = config_dir().join(file);
    let mut legacy: Vec<PathBuf> = legacy_config_dirs(app)
        .into_iter()
        .map(|dir| dir.join(file))
        .filter(|path| *path != primary)
        .collect();
    legacy.sort_by_key(|path| std::cmp::Reverse(modified_at(path)));
    let mut paths = Vec::with_capacity(legacy.len() + 1);
    paths.push(primary);
    paths.extend(legacy);
    paths
}

fn write_path_cache() -> &'static Mutex<HashMap<String, PathBuf>> {
    static CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 写入路径：数据目录 → userData → 回退目录，取第一个可写的。
/// 首次决定后按文件名缓存，避免每次写盘都做一次可写探测。
pub(crate) fn config_write_path(app: &AppHandle, file: &str) -> PathBuf {
    let mut paths = write_path_cache()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if let Some(path) = paths.get(file) {
        return path.clone();
    }
    let dirs = [
        config_dir(),
        resolve_user_data_dir(app),
        fallback_config_dir(app),
    ];
    let preferred = dirs[0].join(file);
    let path = dirs
        .into_iter()
        .find(|dir| is_writable_dir(dir))
        .map(|dir| dir.join(file))
        .unwrap_or_else(|| preferred.clone());
    if path != preferred {
        log::warn!("[config] 数据目录不可写，{file} 改存：{}", path.display());
    }
    paths.insert(file.to_string(), path.clone());
    path
}

/// 换数据目录后清掉写路径缓存，否则还会继续往旧目录写。
pub fn invalidate_config_paths() {
    write_path_cache()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clear();
}

/// 一次性迁移：旧版把配置放在 userData 根目录，现在统一进数据目录。
/// 目标已存在就不覆盖（新版已经写过）；复制成功后删掉旧副本，避免下次启动又被迁回来
/// ——否则用户删掉数据目录里的配置想恢复默认，重启后旧值会自己回来。
pub fn migrate_legacy_config(app: &AppHandle) {
    let target_dir = config_dir();
    if fs::create_dir_all(&target_dir).is_err() {
        return;
    }
    for file in CONFIG_FILES {
        let target = target_dir.join(file);
        if target.exists() {
            continue;
        }
        for dir in legacy_config_dirs(app) {
            let source = dir.join(file);
            if source == target || !source.is_file() {
                continue;
            }
            match fs::copy(&source, &target) {
                Ok(_) => {
                    let _ = fs::remove_file(&source);
                    log::warn!(
                        "[config] 已把 {file} 迁入数据目录：{} -> {}",
                        source.display(),
                        target.display()
                    );
                    break;
                }
                Err(error) => log::warn!("[config] 迁移 {file} 失败：{error}"),
            }
        }
    }
}

/// 原子写 JSON：先写临时文件再替换，避免进程中断留下半截文件。
/// Windows 不允许 rename 覆盖已存在文件，此时退回 remove + rename。
pub(crate) fn write_json_atomic(path: &Path, body: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(path);
        if let Err(error) = fs::rename(&tmp, path) {
            let _ = fs::remove_file(&tmp);
            return Err(error.to_string());
        }
    }
    Ok(())
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

const APPEARANCE_FILE: &str = "window-appearance.json";

pub fn load(app: &AppHandle) -> WindowAppearance {
    for path in config_read_paths(app, APPEARANCE_FILE) {
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
    let body = serde_json::to_string_pretty(appearance).map_err(|e| e.to_string())?;
    write_json_atomic(
        &config_write_path(app, APPEARANCE_FILE),
        &format!("{body}\n"),
    )
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

pub fn apply_effects(window: &tauri::Window, appearance: &WindowAppearance) {
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
