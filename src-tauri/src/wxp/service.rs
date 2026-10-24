// wxp-enhancer 域：运行状态机（启动 / 附加 / 注入会话 / 自动采集 / 看门狗）。
use super::cdp;
use super::injection::{build_injection_source, InjectionOptions, WXP_INJECTION_REV};
use super::process;
use super::store;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;

const STARTUP_DELAY_MS: u64 = 500;
const CDP_TIMEOUT_MS: u64 = 30_000;
const POLL_INTERVAL_MS: u64 = 2000;
const AUTO_COLLECT_INTERVAL_MS: u64 = 15_000;
const AUTO_COLLECT_REFRESH_MS: u64 = 5 * 60 * 1000;
const ATTACH_CHECK_INTERVAL_MS: u64 = 15_000;
const ATTACH_MAX_MISSES: u32 = 2;
const VERIFY_EVERY_POLLS: u64 = 5;

struct Session {
    script_source: String,
    /// targetId -> (url, scriptIdentifier)
    targets: HashMap<String, (String, String)>,
    poll_count: u64,
    verify_cursor: usize,
}

impl Session {
    fn new(script_source: String) -> Self {
        Self {
            script_source,
            targets: HashMap::new(),
            poll_count: 0,
            verify_cursor: 0,
        }
    }

    fn scan_and_inject(&mut self, port: u16, force: bool) -> Result<usize, String> {
        let targets = cdp::fetch_targets(port)?;
        let mut injected = 0;
        let mut active_ids: Vec<String> = Vec::new();
        for target in &targets {
            active_ids.push(target.id.clone());
            let previous = self.targets.get(&target.id);
            let unchanged = previous.is_some_and(|(url, _)| *url == target.url);
            if !force && unchanged {
                continue;
            }
            let previous_identifier = previous.map(|(_, identifier)| identifier.clone());
            let identifier = cdp::inject_target(
                &target.ws_url,
                &self.script_source,
                previous_identifier.as_deref(),
            )?;
            self.targets
                .insert(target.id.clone(), (target.url.clone(), identifier));
            injected += 1;
        }
        self.targets.retain(|id, _| active_ids.contains(id));
        self.poll_count += 1;
        if !force && self.poll_count % VERIFY_EVERY_POLLS == 0 {
            // 存活探针轮转抽查一个已注入目标：刷新后的新文档无脚本时强制重注
            let candidates: Vec<(String, String)> = targets
                .iter()
                .filter(|target| self.targets.contains_key(&target.id) && !target.ws_url.is_empty())
                .map(|target| (target.id.clone(), target.ws_url.clone()))
                .collect();
            if !candidates.is_empty() {
                let index = self.verify_cursor % candidates.len();
                self.verify_cursor += 1;
                let (_, ws_url) = &candidates[index];
                if !cdp::probe_injection_alive(ws_url, WXP_INJECTION_REV) {
                    for target in &targets {
                        if target.id == candidates[index].0 {
                            if let Ok(identifier) =
                                cdp::inject_target(&target.ws_url, &self.script_source, None)
                            {
                                self.targets
                                    .insert(target.id.clone(), (target.url.clone(), identifier));
                                injected += 1;
                            }
                            break;
                        }
                    }
                }
            }
        }
        Ok(injected)
    }
}

struct Running {
    port: u16,
    pid: Option<u32>,
    executable_path: String,
    status: Value,
    session: Session,
}

static RUNTIME: LazyLock<Mutex<Option<Running>>> = LazyLock::new(|| Mutex::new(None));
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn emit_status(app: &tauri::AppHandle, status: &Value) {
    let _ = app.emit(
        "edt:event",
        json!({ "channel": "wxp:status-changed", "payload": status }),
    );
}

fn emit_cache(app: &tauri::AppHandle, cache: &Value) {
    let _ = app.emit(
        "edt:event",
        json!({ "channel": "wxp:data-cache-updated", "payload": cache }),
    );
}

fn set_state(app: &tauri::AppHandle, patch: Value) -> Value {
    let mut runtime = RUNTIME.lock().unwrap();
    let Some(running) = runtime.as_mut() else {
        return Value::Null;
    };
    let mut next = json!({
        "port": running.port,
        "status": "stopped",
        "message": "",
        "updatedAt": now_ms(),
    });
    if running.pid.is_some() {
        next["pid"] = json!(running.pid);
    }
    if let (Some(target), Some(source)) = (next.as_object_mut(), running.status.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    if let Some(patch) = patch.as_object() {
        if let Some(target) = next.as_object_mut() {
            for (key, value) in patch {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    running.status = next.clone();
    emit_status(app, &next);
    next
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn running_state() -> Value {
    RUNTIME
        .lock()
        .unwrap()
        .as_ref()
        .map(|running| running.status.clone())
        .unwrap_or(Value::Null)
}

fn assert_settings(settings: &Value) -> Result<(), String> {
    let path = settings
        .get("executablePath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if path.is_empty() {
        return Err("未设置 WXP 路径，请先选择可执行文件".into());
    }
    let port = settings.get("debugPort").and_then(Value::as_i64);
    match port {
        Some(port) if (1024..=65535).contains(&port) => Ok(()),
        _ => Err("调试端口需在 1024 - 65535 之间".into()),
    }
}

fn build_source_from_store(clear_once: bool) -> String {
    let settings = store::settings();
    let cache = store::data_cache();
    let favorites_backup = if cache.is_null() {
        None
    } else {
        Some(json!({
            "favs": store::normalize_favorites(cache.get("favorites").unwrap_or(&json!([]))),
            "updatedAt": cache.get("favoritesUpdatedAt").and_then(Value::as_i64).unwrap_or(0),
        }))
    };
    build_injection_source(&InjectionOptions {
        show_status_badge: settings.get("showStatusBadge").and_then(Value::as_bool) != Some(false),
        cache_login: settings.get("cacheLogin").and_then(Value::as_bool) != Some(false),
        clear_login_cache_once: clear_once,
        favorites_backup,
    })
}

fn spawn_poll_threads(app: tauri::AppHandle, port: u16) {
    let generation = GENERATION.load(Ordering::SeqCst);

    // 注入轮询：新页面自动注入 + 存活探针
    let poll_app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        let injected = {
            let mut runtime = RUNTIME.lock().unwrap();
            match runtime.as_mut() {
                Some(running) if running.port == port => {
                    running.session.scan_and_inject(port, false).ok()
                }
                _ => None,
            }
        };
        if let Some(count) = injected {
            if count > 0 {
                let total = RUNTIME
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|running| running.session.targets.len())
                    .unwrap_or(0);
                let _ = set_state(
                    &poll_app,
                    json!({
                        "status": "running",
                        "message": "注入运行中，新页面将自动应用",
                        "targetCount": total,
                    }),
                );
            }
        }
    });

    // 登录探测：登录成功 / 收藏变化 / 超时兜底时自动采集
    let collect_app = app;
    std::thread::spawn(move || {
        let mut last_fav_ts: Option<i64> = None;
        let mut last_collected_at: i64 = 0;
        loop {
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let alive = RUNTIME
                .lock()
                .unwrap()
                .as_ref()
                .map(|running| running.port == port)
                .unwrap_or(false);
            if !alive {
                return;
            }
            if let Ok(state) = cdp::evaluate_on_main_page(port, LOGIN_STATE_EXPRESSION) {
                let user_code = state
                    .get("userCode")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !user_code.is_empty() {
                    let fav_ts = state
                        .get("favUpdatedAt")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    let stale = last_collected_at == 0
                        || (now_ms() as i64 - last_collected_at) > AUTO_COLLECT_REFRESH_MS as i64;
                    let changed = last_fav_ts.map(|old| old != fav_ts).unwrap_or(true);
                    if changed || stale {
                        if let Ok(cache) = collect_data(&collect_app, port) {
                            last_fav_ts = Some(fav_ts);
                            last_collected_at = cache
                                .get("collectedAt")
                                .and_then(Value::as_i64)
                                .unwrap_or(0);
                            emit_cache(&collect_app, &cache);
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(AUTO_COLLECT_INTERVAL_MS));
        }
    });
}

fn spawn_attach_watchdog(app: tauri::AppHandle, executable_path: String) {
    let generation = GENERATION.load(Ordering::SeqCst);
    std::thread::spawn(move || {
        let mut misses = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(ATTACH_CHECK_INTERVAL_MS));
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            if process::is_executable_running(&executable_path) {
                misses = 0;
                continue;
            }
            misses += 1;
            if misses >= ATTACH_MAX_MISSES {
                teardown(&app);
                return;
            }
        }
    });
}

fn teardown(app: &tauri::AppHandle) -> bool {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = generation;
    let pid = {
        let mut runtime = RUNTIME.lock().unwrap();
        runtime.take().map(|running| running.pid).unwrap_or(None)
    };
    if let Some(pid) = pid {
        process::kill_process_tree(pid, 4000);
    }
    emit_status(app, &Value::Null);
    pid.is_some()
}

fn start_session(app: &tauri::AppHandle, settings: &Value, message: &str) -> Result<Value, String> {
    let port = settings
        .get("debugPort")
        .and_then(Value::as_i64)
        .unwrap_or_default() as u16;
    let clear_pending = store::login_cache_clear_pending();
    let mut session = Session::new(build_source_from_store(clear_pending));
    session.scan_and_inject(port, false)?;

    *RUNTIME.lock().unwrap() = Some(Running {
        port,
        pid: RUNTIME
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|running| running.pid),
        executable_path: settings
            .get("executablePath")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        status: json!({}),
        session,
    });

    if clear_pending {
        // 首轮注入已执行清除，换回常规脚本并强制重注入
        store::set_login_cache_clear_pending(false)?;
        let source = build_source_from_store(false);
        if let Some(running) = RUNTIME.lock().unwrap().as_mut() {
            running.session.script_source = source;
            let _ = running.session.scan_and_inject(port, true);
        }
    }

    spawn_poll_threads(app.clone(), port);

    let target_count = RUNTIME
        .lock()
        .unwrap()
        .as_ref()
        .map(|running| running.session.targets.len())
        .unwrap_or(0);
    Ok(set_state(
        app,
        json!({
            "port": port,
            "status": "running",
            "message": message,
            "targetCount": target_count,
        }),
    ))
}

pub fn launch(app: &tauri::AppHandle) -> Result<Value, String> {
    if RUNTIME.lock().unwrap().is_some() {
        return Err("WXP 增强已在运行中，请先停止后再启动".into());
    }
    let settings = store::settings();
    assert_settings(&settings)?;
    let port = settings
        .get("debugPort")
        .and_then(Value::as_i64)
        .unwrap_or_default() as u16;
    let executable = settings
        .get("executablePath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    // 已运行的 WXP 且调试端口可用：直接附加注入
    if cdp::wait_for_cdp_port(port, 2500).is_ok() {
        if !process::is_executable_running(&executable) {
            return Err(format!(
                "调试端口 {port} 已被其他程序占用，请更换端口后重试"
            ));
        }
        *RUNTIME.lock().unwrap() = Some(Running {
            port,
            pid: None,
            executable_path: executable.clone(),
            status: json!({}),
            session: Session::new(String::new()),
        });
        let _ = set_state(
            app,
            json!({
                "port": port,
                "status": "connecting",
                "message": format!("发现 WXP 已在运行，附加调试端口 {port}…"),
                "targetCount": 0,
            }),
        );
        let state = start_session(app, &settings, "已附加到运行中的 WXP，脚本注入生效")?;
        spawn_attach_watchdog(app.clone(), executable);
        return Ok(state);
    }

    if process::is_executable_running(&executable) {
        return Err("检测到 WXP 已在运行（未开启调试端口），请先退出 WXP 再启动".into());
    }

    *RUNTIME.lock().unwrap() = Some(Running {
        port,
        pid: None,
        executable_path: executable.clone(),
        status: json!({}),
        session: Session::new(String::new()),
    });
    let _ = set_state(
        app,
        json!({
            "port": port,
            "status": "launching",
            "message": "正在启动 WXP…",
            "targetCount": 0,
        }),
    );

    let extra_args = settings
        .get("extraArgs")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let args = process::launch_args(&extra_args, port);
    let executable_for_runtime = executable.clone();
    let launched = match process::spawn_wxp(&executable, &args) {
        Ok(launched) => launched,
        Err(error) => {
            let _ = teardown(app);
            return Err(error);
        }
    };
    let pid = launched.child.id();
    if let Some(running) = RUNTIME.lock().unwrap().as_mut() {
        running.pid = Some(pid);
        running.executable_path = executable_for_runtime;
    }

    // 退出监视：launcher 交接型启动时应用可能仍存活，转看门狗；否则拆会话
    let watcher_app = app.clone();
    let watcher_executable = RUNTIME
        .lock()
        .unwrap()
        .as_ref()
        .map(|running| running.executable_path.clone())
        .unwrap_or_default();
    let mut child = launched.child;
    std::thread::spawn(move || {
        let _ = child.wait();
        let still_alive = process::is_executable_running(&watcher_executable);
        if still_alive {
            spawn_attach_watchdog(watcher_app.clone(), watcher_executable);
        } else {
            teardown(&watcher_app);
        }
    });

    let _ = set_state(
        app,
        json!({
            "pid": pid,
            "status": "waiting",
            "message": format!("进程已启动 (PID {pid})，等待 CDP…"),
            "launchArgs": args,
        }),
    );
    std::thread::sleep(std::time::Duration::from_millis(STARTUP_DELAY_MS));
    let _ = set_state(
        app,
        json!({ "status": "connecting", "message": format!("连接调试端口 {port}…") }),
    );

    if let Err(error) = cdp::wait_for_cdp_port(port, CDP_TIMEOUT_MS) {
        let child_alive = RUNTIME
            .lock()
            .unwrap()
            .as_ref()
            .map(|running| running.pid.is_some())
            .unwrap_or(false);
        let _ = teardown(app);
        let message = if !child_alive {
            "WXP 进程在启动过程中已退出，请检查路径与启动参数".to_string()
        } else {
            error.clone()
        };
        // teardown 后重新登记 error 态供前端展示
        *RUNTIME.lock().unwrap() = Some(Running {
            port,
            pid: None,
            executable_path: String::new(),
            status: json!({}),
            session: Session::new(String::new()),
        });
        let _ = set_state(
            app,
            json!({ "status": "error", "message": message, "port": port }),
        );
        let _ = RUNTIME.lock().unwrap().take();
        return Err(error);
    }

    start_session(app, &settings, "注入运行中，新页面将自动应用")
}

pub fn stop(app: &tauri::AppHandle) -> Result<bool, String> {
    Ok(teardown(app))
}

pub fn reinject(app: &tauri::AppHandle) -> Result<usize, String> {
    let count = {
        let mut runtime = RUNTIME.lock().unwrap();
        let Some(running) = runtime.as_mut() else {
            return Err("WXP 未在运行，请先启动".into());
        };
        let count = running.session.scan_and_inject(running.port, true)?;
        running.status["targetCount"] = json!(running.session.targets.len());
        count
    };
    let _ = set_state(
        app,
        json!({ "status": "running", "message": "已重新注入", "targetCount": target_count() }),
    );
    Ok(count)
}

fn target_count() -> usize {
    RUNTIME
        .lock()
        .unwrap()
        .as_ref()
        .map(|running| running.session.targets.len())
        .unwrap_or(0)
}

/// 保存设置后运行中自动换新脚本重注入（失败不影响保存）
pub fn apply_if_running(app: &tauri::AppHandle) -> bool {
    let source = build_source_from_store(false);
    {
        let mut runtime = RUNTIME.lock().unwrap();
        let Some(running) = runtime.as_mut() else {
            return false;
        };
        running.session.script_source = source;
    }
    reinject(app).is_ok()
}

pub fn clear_login_cache(app: &tauri::AppHandle) -> Result<Value, String> {
    let running = {
        let runtime = RUNTIME.lock().unwrap();
        runtime
            .as_ref()
            .map(|running| (running.port, running.status.is_object()))
    };
    if let Some((port, true)) = running {
        let cleared = cdp::evaluate_in_page_targets(
            port,
            &super::injection::build_clear_login_cache_snippet(),
        )?;
        let _ = cdp::evaluate_in_page_targets(port, "location.reload();");
        store::set_login_cache_clear_pending(false)?;
        let _ = set_state(
            app,
            json!({ "message": format!("已清除登录缓存（{cleared} 个页面），请重新登录") }),
        );
        return Ok(json!({ "pages": cleared }));
    }
    store::set_login_cache_clear_pending(true)?;
    Ok(json!({ "pages": 0, "pending": true }))
}

// —— 数据采集（在 WXP 主页面执行的 JS 表达式；内部禁用反斜杠转义）——
const COLLECT_EXPRESSION: &str = r#"(function () {
  var out = {}
  var ls = function (k) { try { return localStorage.getItem(k) || '' } catch (e) { return '' } }
  out.accessToken = ls('wxp_access_token')
  out.refreshToken = ls('wxp_refresh_token')
  out.accessExpiresAt = Number(ls('wxp_access_expires_at')) || 0
  out.refreshExpiresAt = Number(ls('wxp_refresh_expires_at')) || 0
  out.snapshotExists = !!ls('__wxpEnhancerSessionSnapshot')
  try { out.loginParams = JSON.parse(ls('__wxpEnhancerLoginParams') || '{}') } catch (e) { out.loginParams = {} }
  try { out.favorites = JSON.parse(ls('__wxpEnhancerLinkFavorites') || '[]') } catch (e) { out.favorites = [] }
  out.favUpdatedAt = Number(ls('__wxpEnhancerLinkFavoritesTs')) || 0
  out.user = null
  try {
    var vm = (document.getElementById('app') || {}).__vue__
    out.user = (vm && vm.$store && vm.$store.getters.user) || null
  } catch (e) {}
  out.username = ''
  try {
    var u = out.user || {}
    out.username = u.code || u.userCode || u.username || u.name || ''
  } catch (e) {}
  return out
})()"#;

const LOGIN_STATE_EXPRESSION: &str = r#"(function () {
  var out = { userCode: '', favUpdatedAt: 0 }
  try {
    var vm = (document.getElementById('app') || {}).__vue__
    var user = vm && vm.$store && vm.$store.getters && vm.$store.getters.user
    if (user) out.userCode = user.code || user.userCode || ''
  } catch (e) {}
  try { out.favUpdatedAt = Number(localStorage.getItem('__wxpEnhancerLinkFavoritesTs')) || 0 } catch (e) {}
  return out
})()"#;

/// 从运行中的 WXP 采集登录信息与收藏数据并缓存
pub fn collect_data(app: &tauri::AppHandle, port: u16) -> Result<Value, String> {
    let raw = cdp::evaluate_on_main_page(port, COLLECT_EXPRESSION)?;
    if raw.is_null() {
        return Err("采集脚本未返回数据，请确认 WXP 已完全启动".into());
    }
    let text = |key: &str| -> String {
        raw.get(key)
            .map(|v| match v {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default()
    };
    let number = |key: &str| -> i64 { raw.get(key).and_then(Value::as_i64).unwrap_or(0) };
    let params = raw.get("loginParams").cloned().unwrap_or(json!({}));
    let previous = store::data_cache();
    let favorites = store::keep_known_hospitals(
        &store::normalize_favorites(raw.get("favorites").unwrap_or(&json!([]))),
        &store::normalize_favorites(previous.get("favorites").unwrap_or(&json!([]))),
    );
    let cache = json!({
        "collectedAt": now_ms(),
        "login": {
            "accessToken": text("accessToken"),
            "refreshToken": text("refreshToken"),
            "accessExpiresAt": number("accessExpiresAt"),
            "refreshExpiresAt": number("refreshExpiresAt"),
            "username": text("username"),
            "password": "",
            "user": raw.get("user").cloned().unwrap_or(Value::Null),
            "nameNodeAddrs": params.get("nameNodeAddrs").and_then(Value::as_str).unwrap_or_default(),
            "statusQueryServers": params.get("statusQueryServers").and_then(Value::as_str).unwrap_or_default(),
            "snapshotExists": raw.get("snapshotExists").and_then(Value::as_bool) == Some(true),
        },
        "favorites": favorites,
        "favoritesUpdatedAt": number("favUpdatedAt"),
    });
    store::set_data_cache(&cache)?;
    let _ = app;
    Ok(cache)
}

/// 设置保存入口：校验 + 落盘 + 运行中热应用
pub fn save_settings(app: &tauri::AppHandle, patch: &Value) -> Result<Value, String> {
    let merged = {
        let current = store::settings();
        let mut merged = current.clone();
        if let (Some(target), Some(source)) = (merged.as_object_mut(), patch.as_object()) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
        merged
    };
    assert_settings(&merged)?;
    let settings = store::save_settings(patch)?;
    apply_if_running(app);
    Ok(settings)
}
