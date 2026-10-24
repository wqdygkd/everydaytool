// Node sidecar 监管：以子进程方式启动 sidecar/main.mjs，通过 stdio JSON-RPC 双向通信。
// Rust 负责进程生命周期、平台能力（对话框 / 打开路径 / 缓存 / DevTools）与事件转发；
// Node 负责原有工具后端的业务逻辑。协议见 sidecar/transport.ts 顶部注释。
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

type PendingCalls = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

pub struct SidecarHost {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    pending: PendingCalls,
    next_id: AtomicU64,
    child: Mutex<Option<Child>>,
    ready: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
}

impl SidecarHost {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        let (node, script, app_root, resources) = resolve_paths(&app)?;
        // 测试 / 便携模式可覆盖数据目录；默认与桌面 userData 一致
        let user_data = crate::appearance::resolve_user_data_dir(&app);
        let mut command = Command::new(&node);
        command
            .arg(&script)
            .current_dir(&app_root)
            .env("EDT_IS_PACKAGED", if cfg!(dev) { "0" } else { "1" })
            .env("EDT_USER_DATA", &user_data)
            .env("EDT_APP_ROOT", &app_root)
            .env("EDT_RESOURCES", &resources)
            .env("EDT_APP_VERSION", app.package_info().version.to_string())
            .env(
                "NODE_ENV",
                if cfg!(dev) {
                    "development"
                } else {
                    "production"
                },
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // 生产态不显示控制台窗口；开发态保留输出便于排查
            if !cfg!(dev) {
                command.creation_flags(0x0800_0000);
            }
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("启动 Node 业务运行时失败（{}）：{e}", node.display()))?;

        let stdin = child.stdin.take().ok_or("无法取得 Node 运行时 stdin")?;
        let stdout = child.stdout.take().ok_or("无法取得 Node 运行时 stdout")?;

        let host = Self {
            stdin: Arc::new(Mutex::new(Some(stdin))),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            child: Mutex::new(Some(child)),
            ready: Arc::new(AtomicBool::new(false)),
            exited: Arc::new(AtomicBool::new(false)),
        };

        Self::spawn_reader(
            app,
            stdout,
            host.pending.clone(),
            host.stdin.clone(),
            host.ready.clone(),
            host.exited.clone(),
        );

        Ok(host)
    }

    fn spawn_reader(
        app: AppHandle,
        stdout: std::process::ChildStdout,
        pending: PendingCalls,
        stdin: Arc<Mutex<Option<ChildStdin>>>,
        ready: Arc<AtomicBool>,
        exited: Arc<AtomicBool>,
    ) {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let message: Value = match serde_json::from_str(line) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("[tauri] invalid host frame: {error}");
                        continue;
                    }
                };
                match message.get("kind").and_then(|v| v.as_str()) {
                    Some("response") => {
                        let Some(id) = message.get("id").and_then(|v| v.as_u64()) else {
                            continue;
                        };
                        let Some(sender) = pending.lock().ok().and_then(|mut map| map.remove(&id))
                        else {
                            continue;
                        };
                        let result = if message.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                            Ok(message.get("result").cloned().unwrap_or(Value::Null))
                        } else {
                            Err(message
                                .get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Node 运行时调用失败")
                                .to_string())
                        };
                        let _ = sender.send(result);
                    }
                    Some("platform") => {
                        let app = app.clone();
                        let stdin = stdin.clone();
                        std::thread::spawn(move || {
                            let id = message.get("id").cloned().unwrap_or(Value::Null);
                            let op = message
                                .get("op")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let args = message.get("args").cloned().unwrap_or(Value::Null);
                            let result = crate::platform::handle(&app, &op, &args);
                            let frame = match result {
                                Ok(value) => json!({
                                    "kind": "response",
                                    "id": id,
                                    "ok": true,
                                    "result": value
                                }),
                                Err(error) => json!({
                                    "kind": "response",
                                    "id": id,
                                    "ok": false,
                                    "error": error
                                }),
                            };
                            if let Ok(mut guard) = stdin.lock() {
                                if let Some(writer) = guard.as_mut() {
                                    let _ = writeln!(writer, "{frame}");
                                    let _ = writer.flush();
                                }
                            }
                        });
                    }
                    Some("event") => {
                        let channel = message
                            .get("channel")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if channel.is_empty() {
                            continue;
                        }
                        let payload = message.get("payload").cloned().unwrap_or(Value::Null);
                        let _ = app.emit(
                            "edt:event",
                            json!({ "channel": channel, "payload": payload }),
                        );
                    }
                    Some("ready") => {
                        ready.store(true, Ordering::SeqCst);
                        eprintln!("[tauri] node business runtime ready");
                    }
                    Some("error") => {
                        eprintln!(
                            "[tauri] node runtime error: {}",
                            message
                                .get("message")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                        );
                    }
                    _ => {}
                }
            }

            // Node 退出：唤醒所有等待中的调用，避免前端永久挂起
            ready.store(false, Ordering::SeqCst);
            exited.store(true, Ordering::SeqCst);
            if let Ok(mut map) = pending.lock() {
                for (_, sender) in map.drain() {
                    let _ = sender.send(Err("Node 业务运行时已退出".into()));
                }
            }
        });
    }

    pub fn invoke(&self, domain: &str, command: &str, args: Vec<Value>) -> Result<Value, String> {
        let started = Instant::now();
        while !self.ready.load(Ordering::SeqCst) {
            if self.exited.load(Ordering::SeqCst) {
                return Err("Node 业务运行时已退出".into());
            }
            if started.elapsed() > Duration::from_secs(90) {
                return Err("Node 业务运行时启动超时".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        {
            let mut map = self
                .pending
                .lock()
                .map_err(|_| "host pending lock poisoned")?;
            map.insert(id, sender);
        }

        {
            let mut guard = self.stdin.lock().map_err(|_| "host stdin lock poisoned")?;
            let stdin = guard.as_mut().ok_or("Node 业务运行时未运行")?;
            let frame = json!({
                "kind": "invoke",
                "id": id,
                "domain": domain,
                "command": command,
                "args": args
            });
            writeln!(stdin, "{frame}").map_err(|e| format!("写入 Node 运行时失败：{e}"))?;
            stdin
                .flush()
                .map_err(|e| format!("刷新 Node 运行时失败：{e}"))?;
        }

        match receiver.recv_timeout(Duration::from_secs(600)) {
            Ok(result) => result,
            Err(_) => {
                if let Ok(mut map) = self.pending.lock() {
                    map.remove(&id);
                }
                Err(format!("命令调用超时：{command}"))
            }
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.stdin.lock() {
            if let Some(mut writer) = guard.take() {
                let _ = writeln!(writer, "{{\"kind\":\"shutdown\"}}");
                let _ = writer.flush();
            }
        }
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let started = Instant::now();
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => return,
                        Ok(None) => {
                            if started.elapsed() > Duration::from_secs(10) {
                                let _ = child.kill();
                                let _ = child.wait();
                                return;
                            }
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        Err(_) => return,
                    }
                }
            }
        }
    }
}

fn dev_project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let project_root = dev_project_root();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| project_root.clone());
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| exe_dir.clone());

    let (script, app_root, resources) = if cfg!(dev) {
        (
            project_root.join("dist-sidecar/main.mjs"),
            project_root.clone(),
            project_root,
        )
    } else {
        (
            resource_dir.join("sidecar/main.mjs"),
            exe_dir.clone(),
            resource_dir,
        )
    };

    let node = if cfg!(dev) {
        std::env::var_os("EDT_NODE_EXE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node"))
    } else {
        let bundled = exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
        if bundled.exists() {
            bundled
        } else {
            let alt = resources.join(if cfg!(windows) { "node.exe" } else { "node" });
            if alt.exists() {
                alt
            } else {
                PathBuf::from("node")
            }
        }
    };

    if !script.exists() {
        return Err(format!(
            "找不到 Node sidecar 入口：{}（请先运行 pnpm build:sidecar）",
            script.display()
        ));
    }

    Ok((node, script, app_root, resources))
}
