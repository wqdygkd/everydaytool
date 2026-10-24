// wxp-enhancer 域：进程管理（启动 / 优雅关闭 / 存活检测 / 可执行文件解析与探测）。
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const KILL_TIMEOUT_MS: u64 = 6000;

/// 清理会把 WXP 以 Node 模式启动的运行时变量（外部客户端从父进程继承）
fn sanitized_env() -> Vec<(String, String)> {
    std::env::vars()
        .filter(|(key, _)| !key.to_uppercase().ends_with("_RUN_AS_NODE"))
        .collect()
}

/// 解析用户输入的参数串：支持双引号 / 单引号 / 裸 token
pub fn parse_args(raw: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for ch in raw.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => current.push(ch),
            None => match ch {
                '"' | '\'' => quote = Some(ch),
                c if c.is_whitespace() => {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                }
                c => current.push(c),
            },
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

pub fn launch_args(args_string: &str, debug_port: u16) -> Vec<String> {
    let mut args = parse_args(args_string);
    let has_port = args
        .iter()
        .any(|arg| arg.starts_with("--remote-debugging-port"));
    if !has_port {
        args.push(format!("--remote-debugging-port={debug_port}"));
    }
    // Chromium 111+ 默认拒绝带 Origin 的调试 WebSocket；精确放行同源调试前端
    let has_origins = args
        .iter()
        .any(|arg| arg.starts_with("--remote-allow-origins"));
    if !has_origins {
        args.push(format!(
            "--remote-allow-origins=http://127.0.0.1:{debug_port}"
        ));
    }
    args
}

pub struct LaunchedProcess {
    pub child: std::process::Child,
}

/// 启动 WXP（复用其自身数据目录；回调式的退出监听由调用方线程承担）
pub fn spawn_wxp(executable: &str, args: &[String]) -> Result<LaunchedProcess, String> {
    let child = Command::new(executable)
        .args(args)
        .envs(sanitized_env())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("进程启动失败：{e}"))?;
    Ok(LaunchedProcess { child })
}

fn pid_alive(pid: u32) -> bool {
    if cfg!(target_os = "windows") {
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
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn taskkill(pid: u32, force: bool) {
    let mut args = vec!["/PID".to_string(), pid.to_string(), "/T".to_string()];
    if force {
        args.push("/F".to_string());
    }
    let _ = Command::new("taskkill")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// 优先正常关闭（WM_CLOSE 让应用落盘会话），超时后强杀
pub fn kill_process_tree(pid: u32, graceful_timeout_ms: u64) {
    if pid == 0 {
        return;
    }
    if cfg!(target_os = "windows") {
        taskkill(pid, false);
        let deadline = Instant::now() + Duration::from_millis(graceful_timeout_ms);
        while Instant::now() < deadline {
            if !pid_alive(pid) {
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        taskkill(pid, true);
        let deadline = Instant::now() + Duration::from_millis(KILL_TIMEOUT_MS);
        while Instant::now() < deadline && pid_alive(pid) {
            std::thread::sleep(Duration::from_millis(250));
        }
    } else {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
        let deadline = Instant::now() + Duration::from_millis(graceful_timeout_ms);
        while Instant::now() < deadline {
            if !pid_alive(pid) {
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
    }
}

/// 检测指定可执行文件进程是否在运行（单实例应用防呆）
pub fn is_executable_running(executable_path: &str) -> bool {
    let image_name = Path::new(executable_path.trim())
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if image_name.is_empty() {
        return false;
    }
    if cfg!(target_os = "windows") {
        Command::new("tasklist")
            .args(["/NH", "/FI", &format!("IMAGENAME eq {image_name}")])
            .output()
            .map(|out| {
                String::from_utf8_lossy(&out.stdout)
                    .to_lowercase()
                    .contains(&image_name.to_lowercase())
            })
            .unwrap_or(false)
    } else {
        Command::new("pgrep")
            .args(["-f", "--", &image_name])
            .output()
            .map(|out| !String::from_utf8_lossy(&out.stdout).trim().is_empty())
            .unwrap_or(false)
    }
}

/// 解析可执行路径：macOS .app 包解析到真实二进制；目录 / 不存在报错
pub fn resolve_executable_path(executable_path: &str) -> Result<String, String> {
    let trimmed = executable_path.trim();
    if trimmed.is_empty() {
        return Err("未设置可执行文件路径".into());
    }
    let resolved = PathBuf::from(trimmed);
    if !resolved.exists() {
        return Err(format!("可执行文件不存在: {trimmed}"));
    }
    if resolved.is_dir() {
        return Err("所选路径是目录，请选择可执行文件".into());
    }
    Ok(resolved.to_string_lossy().to_string())
}

/// 按常见安装位置探测 WxP Client，找不到返回 null（由用户手动选择）
pub fn detect_wxp_executable() -> Option<String> {
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        let mut bases = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            bases.push(PathBuf::from(local).join("Programs"));
        }
        if let Some(pf) = std::env::var_os("PROGRAMFILES") {
            bases.push(PathBuf::from(pf));
        }
        if let Some(pf86) = std::env::var_os("PROGRAMFILES(X86)") {
            bases.push(PathBuf::from(pf86));
        }
        bases
            .into_iter()
            .map(|base| base.join("Wxp Client").join("WxP Client.exe"))
            .collect()
    } else if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/Applications/WxP Client.app"),
            PathBuf::from("/Applications/WxP.app"),
        ]
    } else {
        Vec::new()
    };
    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .map(|candidate| candidate.to_string_lossy().to_string())
}
