// interceptor 域：路径解析（数据目录 / 证书 / 扩展）。
use crate::appearance::resolve_data_dir;
use std::path::PathBuf;
use tauri::Manager;

pub fn interceptor_data_directory() -> PathBuf {
    resolve_data_dir().join("interceptor")
}

pub fn certs_directory() -> PathBuf {
    interceptor_data_directory().join("certs")
}

pub fn ca_key_path() -> PathBuf {
    certs_directory().join("ca.key")
}

pub fn ca_cert_path() -> PathBuf {
    certs_directory().join("ca.crt")
}

/// 根 CA 导出文件名（用户手动导入用；写用户选定位置，不落在数据目录）
pub const CA_EXPORT_FILE_NAME: &str = "edt-interceptor-ca.crt";

/// 扩展源码目录：dev 用仓库源码，打包用 resources/extension-interceptor
pub fn extension_source_path(app: &tauri::AppHandle) -> PathBuf {
    if cfg!(dev) {
        project_root()
            .join("tools")
            .join("interceptor")
            .join("extension")
    } else {
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| project_root())
            .join("extension-interceptor")
    }
}

/// 运行时扩展目录：打包态复制到**数据目录**下的稳定路径（安装目录可变，load unpacked 的路径必须稳）。
/// 早期版本放在 userData（`<userData>/interceptor-extension`）：首次准备时一次性搬进数据目录，
/// 与「所有可持久化数据都在数据目录」的约定对齐（换目录时随整目录迁移一起走）。
pub fn runtime_extension_path() -> PathBuf {
    interceptor_data_directory().join("extension")
}

/// 旧位置（早期版本的运行时扩展目录）：仅用于一次性搬移。
pub fn legacy_runtime_extension_path() -> PathBuf {
    crate::appearance::default_user_data_dir().join("interceptor-extension")
}

fn project_root() -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
