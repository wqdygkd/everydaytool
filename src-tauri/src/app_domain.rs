// 应用壳域：数据根目录的查看 / 更改 / 打开、磁盘用量、缓存清理、DevTools（Rust 原生实现）。
// 数据根目录解析与外观模块共用 appearance::resolve_data_dir()（读 <userData>/data-root.json 覆盖）。
use crate::appearance;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// Chromium 系浏览器在用户数据目录内固定的缓存目录名（沙箱 profile 内同样适用）
const CHROMIUM_CACHE_DIR_NAMES: [&str; 10] = [
    "Cache",
    "Code Cache",
    "GPUCache",
    "GraphicsCache",
    "DawnCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GrShaderCache",
    "ShaderCache",
    "Media Cache",
];

const MAX_WALK_DEPTH: usize = 16;
const SCAN_CACHE_TTL: Duration = Duration::from_secs(10);
const MAX_TOP_ENTRIES: usize = 30;

// —— 工具域注册「清理时需整体跳过的路径」提供者（如运行中沙箱的 userData）——
type SkipProvider = fn() -> Vec<PathBuf>;
static SKIP_PROVIDERS: LazyLock<Mutex<Vec<SkipProvider>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

pub fn register_cache_skip_provider(provider: SkipProvider) {
    SKIP_PROVIDERS.lock().unwrap().push(provider);
}

fn collect_skip_paths() -> Vec<PathBuf> {
    let providers = SKIP_PROVIDERS.lock().unwrap().clone();
    let mut paths = Vec::new();
    for provider in providers {
        paths.extend(provider());
    }
    paths
}

fn is_within_skipped(target: &Path, skip_paths: &[PathBuf]) -> bool {
    skip_paths.iter().any(|skip| target.starts_with(skip))
}

// —— 扫描结果短缓存 ——

struct ScanCache {
    at: Instant,
    result: Value,
}

static SCAN_CACHE: LazyLock<Mutex<Option<ScanCache>>> = LazyLock::new(|| Mutex::new(None));
static SCAN_IN_FLIGHT: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub fn invalidate_scan_cache() {
    *SCAN_CACHE.lock().unwrap() = None;
}

// —— 数据目录 ——

fn default_data_directory() -> PathBuf {
    appearance::default_data_dir()
}

fn data_directory_info() -> Value {
    let data_directory = appearance::resolve_data_dir();
    let default_directory = default_data_directory();
    let is_custom =
        normalize_for_compare(&data_directory) != normalize_for_compare(&default_directory);
    let pending = appearance::read_pending_data_dir();
    json!({
        "dataDirectory": data_directory.to_string_lossy(),
        "defaultDataDirectory": default_directory.to_string_lossy(),
        "isCustom": is_custom,
        // 已请求但需重启后迁移生效的目标目录；null 表示没有待切换
        "pendingDataDirectory": pending.map(|dir| dir.to_string_lossy().to_string()),
    })
}

/// Windows 的 canonicalize 会带 `\\?\`（verbatim）前缀；比较与落盘前统一剥掉，
/// 否则「同一目录」会被判成变更、系统目录前缀匹配也会失效。
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy().to_string();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

fn normalize_for_compare(path: &Path) -> String {
    let text = strip_verbatim(path).to_string_lossy().replace('/', "\\");
    let trimmed = text.trim_end_matches('\\');
    trimmed.to_lowercase()
}

/// 数据目录边界校验：可承载递归删除 / 写文件，必须挡住磁盘根与系统目录
fn is_safe_data_directory(candidate: &str) -> Result<(), String> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return Err("数据目录不能为空".into());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err("数据目录必须是绝对路径".into());
    }
    if trimmed.len() > 4096 {
        return Err("数据目录路径过长".into());
    }
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let resolved = strip_verbatim(&resolved);
    if resolved.parent().is_none() {
        return Err("数据目录不能是磁盘根目录".into());
    }

    let mut forbidden: Vec<PathBuf> = Vec::new();
    if let Some(system_root) = std::env::var_os("SYSTEMROOT") {
        forbidden.push(PathBuf::from(system_root));
    }
    if let Some(system_drive) = std::env::var_os("SYSTEMDRIVE") {
        forbidden.push(PathBuf::from(&system_drive).join("Program Files"));
        forbidden.push(PathBuf::from(&system_drive).join("Program Files (x86)"));
    }
    for item in [
        "/etc", "/usr", "/bin", "/sbin", "/System", "/Library", "/private",
    ] {
        forbidden.push(PathBuf::from(item));
    }

    let resolved_cmp = normalize_for_compare(&resolved);
    for blocked in forbidden {
        let blocked_cmp = normalize_for_compare(&blocked);
        if resolved_cmp == blocked_cmp || resolved_cmp.starts_with(&format!("{blocked_cmp}\\")) {
            return Err("数据目录不能位于系统目录".into());
        }
    }
    Ok(())
}

fn mark_data_directory_configured() -> Result<(), String> {
    let path = appearance::default_user_data_dir().join("setup-state.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, "{\n  \"dataDirectoryConfigured\": true\n}\n")
        .map_err(|error| format!("写入初始化状态失败：{error}"))
}

// —— 用量扫描 ——

struct TreeUsage {
    bytes: u64,
    cache_dirs: Vec<(PathBuf, u64)>,
}

fn measure_file(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// 递归测量目录；is_cache_root 为 true 时整个子树视为单一缓存目录
fn measure_tree(dir: &Path, is_cache_root: bool, depth: usize) -> TreeUsage {
    if depth > MAX_WALK_DEPTH {
        return TreeUsage {
            bytes: 0,
            cache_dirs: Vec::new(),
        };
    }
    let mut usage = TreeUsage {
        bytes: 0,
        cache_dirs: Vec::new(),
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return usage;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            let is_cache = !is_cache_root
                && CHROMIUM_CACHE_DIR_NAMES.contains(&entry.file_name().to_string_lossy().as_ref());
            let child = measure_tree(&path, is_cache, depth + 1);
            usage.bytes += child.bytes;
            usage.cache_dirs.extend(child.cache_dirs);
        } else {
            usage.bytes += measure_file(&path);
        }
    }
    if is_cache_root {
        usage.cache_dirs = vec![(dir.to_path_buf(), usage.bytes)];
    }
    usage
}

/// 扫描数据根目录：总占用、缓存合计、顶层条目分解（短缓存）
pub fn scan_data_root(force: bool) -> Value {
    if !force {
        if let Some(cache) = SCAN_CACHE.lock().unwrap().as_ref() {
            if cache.at.elapsed() < SCAN_CACHE_TTL {
                return cache.result.clone();
            }
        }
    }
    // 同一时刻只跑一次全量扫描
    let _guard = SCAN_IN_FLIGHT.lock().unwrap();

    let data_directory = appearance::resolve_data_dir();
    let mut total_bytes: u64 = 0;
    let mut cache_dirs: Vec<(PathBuf, u64)> = Vec::new();
    let mut entries: Vec<(String, u64, bool)> = Vec::new();

    if let Ok(list) = std::fs::read_dir(&data_directory) {
        for entry in list.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            if file_type.is_dir() {
                let is_cache = CHROMIUM_CACHE_DIR_NAMES.contains(&name.as_str());
                let child = measure_tree(&path, is_cache, 0);
                total_bytes += child.bytes;
                cache_dirs.extend(child.cache_dirs);
                entries.push((name, child.bytes, true));
            } else {
                let bytes = measure_file(&path);
                total_bytes += bytes;
                entries.push((name, bytes, false));
            }
        }
    }

    entries.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    // 顶层条目裁剪：只保留最大的 N 项，其余汇总为「其它」
    let summarized: Vec<Value> = if entries.len() <= MAX_TOP_ENTRIES {
        entries
            .iter()
            .map(|(name, bytes, is_dir)| json!({ "name": name, "bytes": bytes, "isDirectory": is_dir }))
            .collect()
    } else {
        let mut out: Vec<Value> = entries[..MAX_TOP_ENTRIES]
            .iter()
            .map(|(name, bytes, is_dir)| json!({ "name": name, "bytes": bytes, "isDirectory": is_dir }))
            .collect();
        let rest = &entries[MAX_TOP_ENTRIES..];
        let rest_bytes: u64 = rest.iter().map(|(_, bytes, _)| *bytes).sum();
        out.push(json!({
            "name": format!("其它（{} 项）", rest.len()),
            "bytes": rest_bytes,
            "isDirectory": true,
        }));
        out
    };

    let cache_bytes: u64 = cache_dirs.iter().map(|(_, bytes)| *bytes).sum();
    let result = json!({
        "totalBytes": total_bytes,
        "cacheBytes": cache_bytes,
        "entries": summarized,
        "cacheDirs": cache_dirs
            .iter()
            .map(|(path, bytes)| json!({ "path": path.to_string_lossy(), "bytes": bytes }))
            .collect::<Vec<_>>(),
    });
    *SCAN_CACHE.lock().unwrap() = Some(ScanCache {
        at: Instant::now(),
        result: result.clone(),
    });
    result
}

/// 清理数据根目录下的 Chromium 缓存目录
fn clear_data_root_caches() -> Value {
    let skip_paths = collect_skip_paths();
    let scan = scan_data_root(false);
    let mut freed_bytes: u64 = 0;
    let mut cleaned_dirs = 0u32;
    let mut skipped_dirs = 0u32;

    if let Some(dirs) = scan.get("cacheDirs").and_then(Value::as_array) {
        for dir in dirs {
            let path = dir.get("path").and_then(Value::as_str).unwrap_or_default();
            let bytes = dir.get("bytes").and_then(Value::as_u64).unwrap_or(0);
            if path.is_empty() {
                continue;
            }
            let target = PathBuf::from(path);
            if is_within_skipped(&target, &skip_paths) {
                skipped_dirs += 1;
                continue;
            }
            // Windows 上被运行中进程占用的目录会删除失败：跳过，不影响其余缓存
            match std::fs::remove_dir_all(&target) {
                Ok(()) => {
                    cleaned_dirs += 1;
                    freed_bytes += bytes;
                }
                Err(_) => skipped_dirs += 1,
            }
        }
    }

    invalidate_scan_cache();
    json!({
        "freedBytes": freed_bytes,
        "cleanedDirs": cleaned_dirs,
        "skippedDirs": skipped_dirs,
    })
}

// —— 打开目录（Windows 走 explorer，避免 Shell API 阻塞）——

fn open_directory(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = path;
        Err("当前平台暂不支持打开目录".into())
    }
}

// —— 命令分发 ——

pub fn handle(app: &tauri::AppHandle, command: &str, args: &[Value]) -> Result<Value, String> {
    match command {
        "edt-app:data-directory:get" => Ok(data_directory_info()),

        "edt-app:data-directory:select" => {
            use tauri_plugin_dialog::DialogExt;
            let picked = app
                .dialog()
                .file()
                .set_title("选择数据目录")
                .blocking_pick_folder();
            match picked {
                Some(folder) => Ok(json!(folder.to_string())),
                None => Ok(Value::Null),
            }
        }

        // 切换数据目录只写 pending 标记，**不立即切换**：运行中的各工具已经握着旧目录里的
        // 文件句柄（webview 会话 / 资源索引 / 日志），中途换目录只能搬一半。真正生效在下次
        // 启动最开头（appearance::apply_pending_data_migration）：先把旧目录整体复制到新目录，
        // 全部成功后才删除源目录并指向新目录，因此缓存与登录态保持有效。
        "edt-app:data-directory:update" => {
            let next = args
                .first()
                .and_then(Value::as_str)
                .ok_or("缺少数据目录参数")?;
            is_safe_data_directory(next)?;

            let normalized = strip_verbatim(
                &std::fs::canonicalize(next).unwrap_or_else(|_| PathBuf::from(next)),
            );
            let previous = appearance::resolve_data_dir();
            let changed = normalize_for_compare(&normalized) != normalize_for_compare(&previous);
            if changed {
                if normalize_for_compare(&normalized)
                    .starts_with(&format!("{}\\", normalize_for_compare(&previous)))
                    || normalize_for_compare(&previous)
                        .starts_with(&format!("{}\\", normalize_for_compare(&normalized)))
                {
                    return Err("新旧数据目录不能互相嵌套".into());
                }
                if normalized.exists() {
                    let occupied = std::fs::read_dir(&normalized)
                        .map(|mut entries| entries.next().is_some())
                        .unwrap_or(false);
                    if occupied {
                        return Err("目标目录非空，请选择一个空目录（迁移不会覆盖已有文件）".into());
                    }
                }
                appearance::write_pending_data_dir(&normalized)?;
            } else {
                // 选中当前目录 = 取消待切换
                appearance::clear_pending_data_dir();
            }
            // 「已配置」标记必须落在 changed 判断之外：首次引导若选的正是默认目录
            // （dev 下即仓库 data/），changed=false，跳过它会导致弹窗每次启动重现
            // ——命令返回成功、无任何报错，但什么都没写盘。
            mark_data_directory_configured()?;
            let mut info = data_directory_info();
            // 目录要下次启动才迁移生效：渲染层据 changed 提示重启（不额外回恒等字段）
            info["changed"] = json!(changed);
            Ok(info)
        }

        "edt-app:window-bounds:get" => Ok(crate::window_geometry::state(app)),

        "edt-app:window-bounds:set" => {
            let enabled = args
                .first()
                .and_then(Value::as_bool)
                .ok_or("缺少 enabled 参数")?;
            crate::window_geometry::set_enabled(app, enabled)
        }

        "edt-app:window-bounds:reset" => crate::window_geometry::reset(app),

        "edt-app:data-directory:open" => {
            let dir = appearance::resolve_data_dir();
            open_directory(&dir.to_string_lossy())?;
            Ok(json!(true))
        }

        "edt-app:data-usage:get" => {
            let mut usage = scan_data_root(false);
            if let Some(map) = usage.as_object_mut() {
                map.remove("cacheDirs");
            }
            Ok(usage)
        }

        "edt-app:cache:clear" => {
            let result = clear_data_root_caches();
            // 应用自身（渲染层）的 HTTP 缓存一并清掉；体积不并入统计
            if let Some(webview) = app.get_webview("main") {
                let _ = webview.clear_all_browsing_data();
            }
            Ok(result)
        }

        "edt-app:devtools:open" => {
            if let Some(webview) = app.get_webview("main") {
                webview.open_devtools();
            }
            Ok(json!(true))
        }

        other => Err(format!("未实现的应用壳命令：{other}")),
    }
}

/// 工具域注册缓存跳过路径（lib.rs 在启动时调用）
pub fn register_tool_skip_providers() {
    register_cache_skip_provider(crate::chrome_sandbox::running_user_data_dirs);
}
