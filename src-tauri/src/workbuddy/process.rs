// workbuddy2api-panel 域：托管进程（启动 / 停止 / 存活判定 / 残留进程清理）。
//
// 与 Electron 版一致的取舍：
// - 默认不自动启动；单实例（已在运行则直接报错）；
// - START 后轮询 /healthz 直到命中 `service=workbuddy2api`，超时则停掉避免残留；
// - STOP 先礼后兵（SIGTERM / taskkill → 超时强杀），主动停止不把关停日志当成错误。
use super::{config, health, paths, BINARY_NAME, BINARY_NAME_WIN};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const STOP_GRACE: Duration = Duration::from_millis(8_000);
const READY_TIMEOUT: Duration = Duration::from_millis(20_000);
const READY_POLL: Duration = Duration::from_millis(400);

pub fn binary_file_name() -> &'static str {
    if cfg!(windows) {
        BINARY_NAME_WIN
    } else {
        BINARY_NAME
    }
}

pub fn resolve_current_binary_path() -> Option<PathBuf> {
    let name = binary_file_name();
    let direct = paths::current_dir().join(name);
    if direct.is_file() {
        return Some(direct);
    }
    // 解压可能多一层目录
    zip_find(&paths::current_dir(), name)
}

fn zip_find(root: &Path, name: &str) -> Option<PathBuf> {
    super::zip::find_binary_in_dir(root, name)
}

pub fn get_managed_pid() -> Option<u32> {
    let state = super::lock();
    if let Some(child) = state.child.as_ref() {
        // child 仍在本进程里：pid 有效即视为托管中
        return Some(child.id());
    }
    state.managed_pid
}

pub fn is_process_managed_alive() -> bool {
    match get_managed_pid() {
        Some(pid) => is_pid_alive(pid),
        None => false,
    }
}

pub fn peek_last_stderr() -> String {
    super::lock().last_stderr.trim().to_string()
}

pub fn clear_last_stderr() {
    super::lock().last_stderr.clear();
}

fn is_pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // 信号 0 只做存在性检查，不投递
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        // tasklist 过滤 PID；找不到即视为已退出（多一层进程，但避免引入 Win32 句柄管理）
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|output| {
                let text = String::from_utf8_lossy(&output.stdout);
                text.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
}

/// macOS 去掉 quarantine，避免 Gatekeeper 拦住托管进程。
fn clear_mac_quarantine(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(path)
            .output();
        let _ = Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(path)
            .output();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
}

pub fn prepare_binary_permissions(binary: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(binary, std::fs::Permissions::from_mode(0o755));
    }
    clear_mac_quarantine(binary);
    clear_mac_quarantine(&paths::current_dir());
}

fn kill_pid(pid: u32, force: bool) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/pid", &pid.to_string(), "/T"]);
        if force {
            command.arg("/F");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let _ = command.output();
    }
    #[cfg(unix)]
    {
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        unsafe {
            libc::kill(pid as i32, signal);
        }
    }
}

/// STOP：先礼后兵；无论成败都清掉 stderr 尾巴（关停日志不应冒充错误）。
pub fn stop_managed_process() -> Result<(), String> {
    let (child, pid) = {
        let mut state = super::lock();
        let child = state.child.take();
        let pid = state.managed_pid.take().or_else(|| child.as_ref().map(Child::id));
        (child, pid)
    };

    let Some(pid) = pid else {
        clear_last_stderr();
        return Ok(());
    };

    if let Some(mut child) = child {
        kill_pid(pid, false);
        if !wait_exit(&mut child, STOP_GRACE) && is_pid_alive(pid) {
            kill_pid(pid, true);
        }
        let _ = wait_exit(&mut child, Duration::from_millis(2_000));
    } else if is_pid_alive(pid) {
        kill_pid(pid, false);
        std::thread::sleep(Duration::from_millis(800));
        if is_pid_alive(pid) {
            kill_pid(pid, true);
        }
    }
    clear_last_stderr();
    Ok(())
}

fn wait_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {}
            Err(_) => return true,
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// START：强制 listen=127.0.0.1、关自更新后 spawn，并轮询 /healthz 直到命中身份。
pub fn start_managed_process() -> Result<(u16, u32), String> {
    if is_process_managed_alive() {
        return Err("服务已在运行".into());
    }
    let binary = resolve_current_binary_path().ok_or("未找到 wb2api 二进制，请先安装")?;
    prepare_binary_permissions(&binary);
    let (port, config_path) = config::enforce_start_config()?;
    let run_dir = paths::run_dir();
    std::fs::create_dir_all(&run_dir).map_err(|error| error.to_string())?;

    clear_last_stderr();
    let mut child = Command::new(&binary)
        .arg("-config")
        .arg(&config_path)
        .current_dir(&run_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动失败：{error}"))?;
    let pid = child.id();

    // stderr 尾巴单独线程收：进程异常退出时作为 lastError 兜底
    if let Some(mut stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match stderr.read(&mut buffer) {
                    Ok(0) => return,
                    Ok(read) => {
                        let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                        let mut state = super::lock();
                        let next = format!("{}{}", state.last_stderr, text);
                        // 只留尾巴 8000 字符，避免长时间运行把内存吃掉
                        let trimmed: String = next
                            .chars()
                            .rev()
                            .take(8_000)
                            .collect::<Vec<char>>()
                            .into_iter()
                            .rev()
                            .collect();
                        state.last_stderr = trimmed;
                    }
                    Err(_) => return,
                }
            }
        });
    }

    {
        let mut state = super::lock();
        state.child = Some(child);
        state.managed_pid = Some(pid);
    }

    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(code) = take_exit_code() {
            let stderr = peek_last_stderr();
            return Err(if stderr.is_empty() {
                format!("进程提前退出 code={code}")
            } else {
                stderr
            });
        }
        let snapshot = health::probe_healthz(port);
        if snapshot.ok {
            return Ok((port, pid));
        }
        std::thread::sleep(READY_POLL);
    }

    // 超时仍未探活成功：停掉避免残留
    let _ = stop_managed_process();
    Err(peek_last_stderr()).or_else(|_| {
        Err(format!(
            "启动超时：{}ms 内 /healthz 未命中 service=workbuddy2api",
            READY_TIMEOUT.as_millis()
        ))
    })
}

/// 托管进程是否已退出（退出后把句柄从状态里摘掉）。返回退出码。
fn take_exit_code() -> Option<i32> {
    let mut state = super::lock();
    let child = state.child.as_mut()?;
    match child.try_wait() {
        Ok(Some(status)) => {
            state.child = None;
            state.managed_pid = None;
            Some(status.code().unwrap_or(-1))
        }
        _ => None,
    }
}

/// 查找占用端口、且非本工具托管的残留进程。
pub fn find_orphan_pids(port: u16) -> Vec<u32> {
    let managed = get_managed_pid();
    let mut pids: Vec<u32> = Vec::new();

    #[cfg(windows)]
    {
        if let Ok(output) = Command::new("netstat").args(["-ano", "-p", "tcp"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let needle = format!("127.0.0.1:{port}");
            for line in text.lines() {
                if !line.contains(&needle) || !line.contains("LISTENING") {
                    continue;
                }
                if let Some(pid) = line.split_whitespace().last().and_then(|value| value.parse().ok()) {
                    if !pids.contains(&pid) {
                        pids.push(pid);
                    }
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if let Ok(pid) = line.trim().parse::<u32>() {
                    if !pids.contains(&pid) {
                        pids.push(pid);
                    }
                }
            }
        }
    }

    if let Some(managed) = managed {
        pids.retain(|pid| *pid != managed);
    }
    pids
}

/// 只结束占用，不接管。
pub fn kill_orphan_processes(port: u16) -> Vec<u32> {
    let pids = find_orphan_pids(port);
    for pid in &pids {
        kill_pid(*pid, true);
    }
    pids
}

