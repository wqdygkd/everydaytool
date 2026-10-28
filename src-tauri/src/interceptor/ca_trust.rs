// interceptor 域：根 CA 信任管理（Windows 用户证书库 certutil / macOS 钥匙串 security）。
use std::process::{Command, Stdio};

pub struct CaTrustResult {
    pub ok: bool,
    pub canceled: bool,
    pub detail: String,
}

pub struct CaTrustState {
    pub state: &'static str,
    pub detail: String,
}

/// 执行外部命令并返回结果（非零退出码不抛错，由调用方判定）
fn run_command(command: &str, args: &[String]) -> (i32, String, String) {
    Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map(|output| {
            (
                output.status.code().unwrap_or(1),
                String::from_utf8_lossy(&output.stdout).to_string(),
                String::from_utf8_lossy(&output.stderr).to_string(),
            )
        })
        .unwrap_or((1, String::new(), String::new()))
}

fn normalize_fingerprint(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_hexdigit())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

#[cfg(target_os = "windows")]
fn find_windows(fingerprint: &str) -> bool {
    let (code, _, _) = run_command(
        "certutil",
        &[
            "-user".to_string(),
            "-verifystore".into(),
            "Root".into(),
            fingerprint.to_string(),
        ],
    );
    code == 0
}

#[cfg(target_os = "windows")]
fn get_trust_state(fingerprint: &str) -> CaTrustState {
    // Windows 用户库只有“在 / 不在”，存在即在信任范围（无独立 trust 设置）
    if find_windows(fingerprint) {
        CaTrustState {
            state: "trusted",
            detail: String::new(),
        }
    } else {
        CaTrustState {
            state: "not-found",
            detail: String::new(),
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_trust_state(_fingerprint: &str) -> CaTrustState {
    CaTrustState {
        state: "error",
        detail: "当前平台暂不支持自动管理证书信任".into(),
    }
}

#[cfg(target_os = "windows")]
fn install(cert_path: &str) -> CaTrustResult {
    let (code, stdout, stderr) = run_command(
        "certutil",
        &[
            "-user".into(),
            "-addstore".into(),
            "-f".into(),
            "Root".into(),
            cert_path.to_string(),
        ],
    );
    if code == 0 {
        return CaTrustResult {
            ok: true,
            canceled: false,
            detail: String::new(),
        };
    }
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    CaTrustResult {
        ok: false,
        canceled: false,
        detail: if detail.is_empty() {
            format!("certutil 退出码 {code}")
        } else {
            detail.to_string()
        },
    }
}

#[cfg(target_os = "windows")]
fn uninstall(fingerprint: &str) -> CaTrustResult {
    let (code, stdout, stderr) = run_command(
        "certutil",
        &[
            "-user".into(),
            "-delstore".into(),
            "Root".into(),
            fingerprint.to_string(),
        ],
    );
    if code == 0 {
        return CaTrustResult {
            ok: true,
            canceled: false,
            detail: String::new(),
        };
    }
    let output = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    // 证书本就不存在时视为幂等成功
    if output.to_lowercase().contains("not found") || output.contains("找不到") {
        return CaTrustResult {
            ok: true,
            canceled: false,
            detail: String::new(),
        };
    }
    CaTrustResult {
        ok: false,
        canceled: false,
        detail: if output.is_empty() {
            format!("certutil 退出码 {code}")
        } else {
            output.to_string()
        },
    }
}

#[cfg(target_os = "macos")]
fn get_trust_state(fingerprint: &str) -> CaTrustState {
    let keychain = dirs_keychain();
    let (find_code, find_stdout, _) = run_command(
        "security",
        &[
            "find-certificate".into(),
            "-a".into(),
            "-Z".into(),
            "edt Interceptor CA".into(),
            keychain.clone(),
        ],
    );
    let found = find_code == 0 && normalize_fingerprint(&find_stdout).contains(fingerprint);
    if !found {
        return CaTrustState {
            state: "not-found",
            detail: String::new(),
        };
    }
    let (_, dump_stdout, _) = run_command("security", &["dump-trust-settings".into()]);
    for (index, line) in dump_stdout.lines().enumerate() {
        if normalize_fingerprint(line).contains(fingerprint) {
            let window = dump_stdout
                .lines()
                .skip(index)
                .take(8)
                .collect::<Vec<_>>()
                .join("\n");
            if window.contains("kSecTrustSettingsResultDeny") {
                return CaTrustState {
                    state: "installed-untrusted",
                    detail: "证书已导入但被显式 Deny，请重新安装".into(),
                };
            }
            if window.contains("kSecTrustSettingsResult") {
                return CaTrustState {
                    state: "trusted",
                    detail: String::new(),
                };
            }
            break;
        }
    }
    CaTrustState {
        state: "installed-untrusted",
        detail: "证书已导入但未设为信任，请重新执行安装".into(),
    }
}

#[cfg(target_os = "macos")]
fn dirs_keychain() -> String {
    std::env::var_os("HOME")
        .map(|home| {
            std::path::PathBuf::from(home)
                .join("Library")
                .join("Keychains")
                .join("login.keychain-db")
                .to_string_lossy()
                .to_string()
        })
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn install(cert_path: &str) -> CaTrustResult {
    let keychain = dirs_keychain();
    let shell = format!("security add-trusted-cert -r trustRoot -k '{keychain}' '{cert_path}'");
    let script = format!(
        "do shell script {} with prompt \"edt 请求将根证书加入登录钥匙串并设为信任\"",
        serde_json::json!(shell)
    );
    let (code, stdout, stderr) = run_command("osascript", &["-e".into(), script]);
    if code == 0 {
        return CaTrustResult {
            ok: true,
            canceled: false,
            detail: String::new(),
        };
    }
    let output = format!("{stderr}\n{stdout}");
    let cancel_pattern = regex::Regex::new(r"cancel|取消|-128").unwrap();
    if cancel_pattern.is_match(&output) {
        return CaTrustResult {
            ok: false,
            canceled: true,
            detail: "已取消授权".into(),
        };
    }
    CaTrustResult {
        ok: false,
        canceled: false,
        detail: output.trim().to_string(),
    }
}

#[cfg(target_os = "macos")]
fn uninstall(fingerprint: &str) -> CaTrustResult {
    let keychain = dirs_keychain();
    let (code, stdout, stderr) = run_command(
        "security",
        &[
            "delete-certificate".into(),
            "-Z".into(),
            fingerprint.to_string(),
            keychain,
        ],
    );
    if code == 0 {
        return CaTrustResult {
            ok: true,
            canceled: false,
            detail: String::new(),
        };
    }
    let output = format!("{stderr}\n{stdout}").trim().to_string();
    if output.to_lowercase().contains("not found") || output.contains("could not be found") {
        return CaTrustResult {
            ok: true,
            canceled: false,
            detail: String::new(),
        };
    }
    CaTrustResult {
        ok: false,
        canceled: false,
        detail: output,
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn install(_cert_path: &str) -> CaTrustResult {
    CaTrustResult {
        ok: false,
        canceled: false,
        detail: "当前平台暂不支持自动安装证书".into(),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn uninstall(_fingerprint: &str) -> CaTrustResult {
    CaTrustResult {
        ok: false,
        canceled: false,
        detail: "当前平台暂不支持自动卸载证书".into(),
    }
}

pub fn get_ca_trust_state(fingerprint: &str) -> CaTrustState {
    get_trust_state(fingerprint)
}

pub fn install_ca_trust(cert_path: &str) -> CaTrustResult {
    install(cert_path)
}

pub fn uninstall_ca_trust(fingerprint: &str) -> CaTrustResult {
    uninstall(fingerprint)
}
