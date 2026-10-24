// chrome-sandbox 域：Chrome 进程管理（启动 / 查询 / 关闭 / 聚焦窗口）。
use super::paths;
use super::store;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const QUERY_CACHE_MS: u64 = 8000;
const GRACEFUL_TIMEOUT_MS: u64 = 10_000;

struct TrackedProcess {
    pid: u32,
    user_data_dir: String,
}

type QueryCacheMap = HashMap<String, (Vec<u32>, Instant)>;

static TRACKED: LazyLock<Mutex<HashMap<String, TrackedProcess>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static QUERY_CACHE: LazyLock<Mutex<QueryCacheMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn log(message: &str) {
    eprintln!("[chrome-sandbox] {message}");
}

/// 广播事件到前端（与 Node 侧 broadcastToWindows 同一通道）
pub fn emit_event(app: &tauri::AppHandle, channel: &str, payload: Value) {
    let _ = app.emit(
        "edt:event",
        json!({
            "channel": channel,
            "payload": payload,
        }),
    );
}

fn parse_query_output(output: &str) -> Vec<u32> {
    let Ok(parsed) = serde_json::from_str::<Value>(output) else {
        return Vec::new();
    };
    match parsed.get("pids") {
        Some(Value::Array(pids)) => pids
            .iter()
            .filter_map(Value::as_i64)
            .filter(|pid| *pid > 0)
            .map(|pid| pid as u32)
            .collect(),
        Some(single) => single
            .as_i64()
            .filter(|pid| *pid > 0)
            .map(|pid| vec![pid as u32])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn query_windows_pids(app: &tauri::AppHandle, user_data_dir: &str) -> Vec<u32> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(paths::process_query_script(app))
        .args(["-UserDataDir", user_data_dir])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        log(&format!(
            "Chrome 进程查询失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
        return Vec::new();
    }
    parse_query_output(String::from_utf8_lossy(&output.stdout).trim())
}

fn query_unix_pids(user_data_dir: &str) -> Vec<u32> {
    let Ok(output) = Command::new("pgrep").arg("-f").arg(user_data_dir).output() else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .filter_map(|pid| pid.parse::<u32>().ok())
        .collect()
}

/// 查询某 userData 目录对应的 Chrome 进程树（8 秒缓存，对齐 Node 侧）
pub fn query_pids(app: &tauri::AppHandle, user_data_dir: &str) -> Vec<u32> {
    if user_data_dir.is_empty() {
        return Vec::new();
    }
    if let Some((cached, at)) = QUERY_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(user_data_dir).cloned())
    {
        if (at.elapsed().as_millis() as u64) < QUERY_CACHE_MS {
            return cached;
        }
    }
    let pids = if cfg!(target_os = "windows") {
        query_windows_pids(app, user_data_dir)
    } else {
        query_unix_pids(user_data_dir)
    };
    if let Ok(mut cache) = QUERY_CACHE.lock() {
        cache.insert(user_data_dir.to_string(), (pids.clone(), Instant::now()));
    }
    pids
}

fn invalidate_query_cache(user_data_dir: &str) {
    if let Ok(mut cache) = QUERY_CACHE.lock() {
        cache.remove(user_data_dir);
    }
}

pub fn is_running(
    app: &tauri::AppHandle,
    sandbox_id: &str,
    user_data_dir: &str,
    allow_query: bool,
) -> bool {
    if let Ok(tracked) = TRACKED.lock() {
        if tracked.contains_key(sandbox_id) {
            return true;
        }
    }
    if !allow_query {
        return false;
    }
    !query_pids(app, user_data_dir).is_empty()
}

pub fn find_running_pid(
    app: &tauri::AppHandle,
    sandbox_id: &str,
    user_data_dir: &str,
) -> Option<u32> {
    if let Ok(tracked) = TRACKED.lock() {
        if let Some(entry) = tracked.get(sandbox_id) {
            return Some(entry.pid);
        }
    }
    query_pids(app, user_data_dir).first().copied()
}

fn pid_alive(pid: u32) -> bool {
    if cfg!(target_os = "windows") {
        // tasklist 过滤该 PID；输出仍含 PID 即存活
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|out| {
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .any(|line| line.starts_with(&pid.to_string()))
            })
            .unwrap_or(false)
    } else {
        // kill -0 探活：成功或 EPERM 都表示进程存在
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn kill_pid_tree(pid: u32, force: bool) {
    if cfg!(target_os = "windows") {
        let mut args = vec!["/pid".to_string(), pid.to_string(), "/T".to_string()];
        if force {
            args.push("/F".to_string());
        }
        let _ = Command::new("taskkill")
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        let _ = Command::new("kill")
            .arg(if force { "-9" } else { "-TERM" })
            .arg(pid.to_string())
            .status();
    }
}

pub fn kill_process(app: &tauri::AppHandle, sandbox_id: &str, user_data_dir: &str) -> bool {
    let tracked_pid = TRACKED
        .lock()
        .ok()
        .and_then(|tracked| tracked.get(sandbox_id).map(|entry| entry.pid));
    let mut pids: Vec<u32> = Vec::new();
    if let Some(pid) = tracked_pid {
        pids.push(pid);
    }
    for pid in query_pids(app, user_data_dir) {
        if !pids.contains(&pid) {
            pids.push(pid);
        }
    }

    if pids.is_empty() {
        if let Ok(mut tracked) = TRACKED.lock() {
            tracked.remove(sandbox_id);
        }
        return false;
    }

    for pid in &pids {
        kill_pid_tree(*pid, false);
    }
    let deadline = Instant::now() + Duration::from_millis(GRACEFUL_TIMEOUT_MS);
    while Instant::now() < deadline {
        if !pids.iter().any(|pid| pid_alive(*pid)) {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    for pid in &pids {
        if pid_alive(*pid) {
            log(&format!("Chrome 优雅关闭超时，强制结束 pid={pid}"));
            kill_pid_tree(*pid, true);
        }
    }

    if let Ok(mut tracked) = TRACKED.lock() {
        tracked.remove(sandbox_id);
    }
    invalidate_query_cache(user_data_dir);
    true
}

/// 启动 Chrome 并登记跟踪；返回主进程 pid。子进程退出后自动更新状态并广播事件。
#[allow(clippy::too_many_arguments)]
pub fn launch_chrome(
    app: &tauri::AppHandle,
    sandbox_id: &str,
    user_data_dir: &str,
    profile_directory: &str,
    extension_path: Option<&str>,
    debug_port: Option<u16>,
    disable_safety_checks: bool,
    disable_cors: bool,
    custom_args: &str,
    window_position: (i32, i32),
    window_size: (i32, i32),
) -> Result<u32, String> {
    let chrome_path = super::detect_chrome_path(app)?;
    let mut args: Vec<String> = vec![
        format!("--user-data-dir={user_data_dir}"),
        format!("--profile-directory={profile_directory}"),
        "--restore-last-session".into(),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--disable-default-apps".into(),
        format!("--window-size={},{}", window_size.0, window_size.1),
    ];
    if let Some(port) = debug_port {
        args.push(format!("--remote-debugging-port={port}"));
        args.push("--start-minimized".into());
        args.push("--window-position=-32000,-32000".into());
    } else {
        args.push(format!(
            "--window-position={},{}",
            window_position.0, window_position.1
        ));
    }
    if let Some(path) = extension_path {
        args.push(format!("--load-extension={path}"));
    }
    if disable_safety_checks {
        args.push("--disable-web-security".into());
        args.push("--ignore-certificate-errors".into());
        args.push("--disable-features=IsolateOrigins,site-per-process".into());
    }
    if disable_cors {
        args.push("--disable-web-security".into());
    }
    for arg in custom_args.split(' ') {
        let arg = arg.trim();
        if !arg.is_empty() {
            args.push(arg.to_string());
        }
    }

    log(&format!("启动 Chrome：{chrome_path} {:?}", args));
    let mut child = Command::new(&chrome_path)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Chrome 启动失败：{e}"))?;
    let pid = child.id();
    if let Ok(mut tracked) = TRACKED.lock() {
        tracked.insert(
            sandbox_id.to_string(),
            TrackedProcess {
                pid,
                user_data_dir: user_data_dir.to_string(),
            },
        );
    }

    // 退出监视线程：等主进程退出 → 确认无残余进程 → 更新状态 + 广播
    let watcher_app = app.clone();
    let watcher_id = sandbox_id.to_string();
    std::thread::spawn(move || {
        let _ = child.wait();
        log(&format!("Chrome 主进程退出：{watcher_id}"));
        let watcher_dir = TRACKED
            .lock()
            .ok()
            .and_then(|tracked| tracked.get(&watcher_id).map(|e| e.user_data_dir.clone()));
        if let Some(dir) = watcher_dir.clone() {
            if !query_pids(&watcher_app, &dir).is_empty() {
                log(&format!("Chrome 子进程仍在运行：{watcher_id}"));
                if let Ok(mut tracked) = TRACKED.lock() {
                    // 主进程没了但浏览器进程树还在：保留登记，状态由 refresh 校正
                    tracked.remove(&watcher_id);
                }
                return;
            }
        }
        if let Ok(mut tracked) = TRACKED.lock() {
            tracked.remove(&watcher_id);
        }
        invalidate_query_cache(&watcher_dir.clone().unwrap_or_default());
        emit_event(
            &watcher_app,
            "sandbox:process-exited",
            json!({ "sandboxId": watcher_id }),
        );
        let _ = store::update_sandbox_fields(
            &watcher_id,
            &json!({ "status": "stopped", "chromePid": null }),
        );
    });

    Ok(pid)
}

/// 把运行中沙箱的 Chrome 窗口带到前台（PowerShell + Win32 API）
pub fn focus_chrome_window(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if !cfg!(target_os = "windows") {
        return false;
    }
    let script = format!(
        r#"
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {{
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  }}
"@
$p = Get-Process -Id {pid} -ErrorAction SilentlyContinue | Select-Object -First 1
if ($p -and $p.MainWindowHandle -ne 0) {{
  [Win32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
}}
"#
    );
    Command::new("powershell")
        .args(["-NoProfile", "-Command"])
        .arg(script)
        .output()
        .map(|_| true)
        .unwrap_or_else(|error| {
            log(&format!("聚焦 Chrome 窗口失败：{error}"));
            false
        })
}
