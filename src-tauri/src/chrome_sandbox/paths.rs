// chrome-sandbox 域：路径解析（Chrome 安装位置 / 沙箱目录 / 扩展资源）。
use crate::appearance::resolve_data_dir;
use std::path::PathBuf;
use tauri::Manager;

pub struct ChromePaths {
    pub user_data_root: PathBuf,
    pub default_profile: PathBuf,
    pub executables: Vec<PathBuf>,
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn chrome_paths() -> ChromePaths {
    if cfg!(target_os = "windows") {
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData").join("Local"));
        let user_data_root = local_app_data
            .join("Google")
            .join("Chrome")
            .join("User Data");
        let program_files = std::env::var_os("PROGRAMFILES")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Program Files"));
        let program_files_x86 = std::env::var_os("PROGRAMFILES(X86)")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Program Files (x86)"));
        ChromePaths {
            default_profile: user_data_root.join("Default"),
            executables: vec![
                program_files
                    .join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe"),
                program_files_x86
                    .join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe"),
                local_app_data
                    .join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe"),
            ],
            user_data_root,
        }
    } else if cfg!(target_os = "macos") {
        let user_data_root = home()
            .join("Library")
            .join("Application Support")
            .join("Google")
            .join("Chrome");
        ChromePaths {
            default_profile: user_data_root.join("Default"),
            executables: vec![PathBuf::from(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            )],
            user_data_root,
        }
    } else {
        let user_data_root = home().join(".config").join("google-chrome");
        ChromePaths {
            default_profile: user_data_root.join("Default"),
            executables: vec![
                PathBuf::from("/usr/bin/google-chrome"),
                PathBuf::from("/usr/bin/google-chrome-stable"),
                PathBuf::from("/usr/bin/chromium"),
                PathBuf::from("/usr/bin/chromium-browser"),
            ],
            user_data_root,
        }
    }
}

fn project_root() -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 指纹扩展模板：dev 用源码目录，打包用 resources/extension
pub fn extension_template_path(app: &tauri::AppHandle) -> PathBuf {
    if cfg!(dev) {
        project_root()
            .join("tools")
            .join("chrome-sandbox")
            .join("extension")
    } else {
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| project_root())
            .join("extension")
    }
}

/// Chrome 进程查询脚本：dev 用源码目录，打包用 resources/chrome-sandbox/
pub fn process_query_script(app: &tauri::AppHandle) -> PathBuf {
    if cfg!(dev) {
        project_root()
            .join("tools")
            .join("chrome-sandbox")
            .join("chrome-process-query.ps1")
    } else {
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| project_root())
            .join("chrome-sandbox")
            .join("chrome-process-query.ps1")
    }
}

pub fn default_chrome_profile_path() -> PathBuf {
    chrome_paths().default_profile
}

pub fn chrome_user_data_root() -> PathBuf {
    chrome_paths().user_data_root
}

pub fn default_chrome_paths() -> Vec<PathBuf> {
    chrome_paths().executables
}

/// 所有沙箱 profile 的根目录：删除等写操作必须局限在此目录内
pub fn sandboxes_directory() -> PathBuf {
    resolve_data_dir().join("sandboxes")
}

pub fn sandbox_path(sandbox_id: &str) -> PathBuf {
    sandboxes_directory().join(sandbox_id)
}

pub fn sandbox_profile_directory_name(sandbox_id: &str) -> String {
    format!("sb_{}", sandbox_id.trim_start_matches("sandbox_"))
}

pub fn sandbox_profile_path(sandbox_id: &str) -> PathBuf {
    sandbox_path(sandbox_id).join(sandbox_profile_directory_name(sandbox_id))
}

pub fn sandbox_fingerprint_ext_path(sandbox_id: &str) -> PathBuf {
    sandbox_path(sandbox_id).join("fingerprint_ext")
}

pub fn shared_fingerprint_ext_path() -> PathBuf {
    resolve_data_dir().join("shared").join("fingerprint_ext")
}
