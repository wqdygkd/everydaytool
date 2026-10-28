// workbuddy2api-panel 域：数据目录布局（全部落在 `<数据目录>/workbuddy2api-panel/`）。
use crate::appearance::resolve_data_dir;
use std::path::PathBuf;

pub const TOOL_DIR: &str = "workbuddy2api-panel";

pub fn root_dir() -> PathBuf {
    resolve_data_dir().join(TOOL_DIR)
}

pub fn manifest_path() -> PathBuf {
    root_dir().join("manifest.json")
}

pub fn settings_path() -> PathBuf {
    root_dir().join("app-settings.json")
}

pub fn downloads_dir() -> PathBuf {
    root_dir().join("downloads")
}

pub fn runtime_dir() -> PathBuf {
    root_dir().join("runtime")
}

pub fn current_dir() -> PathBuf {
    runtime_dir().join("current")
}

pub fn previous_dir() -> PathBuf {
    runtime_dir().join("previous")
}

pub fn staging_dir() -> PathBuf {
    runtime_dir().join("staging")
}

pub fn run_dir() -> PathBuf {
    root_dir().join("run")
}

pub fn config_path() -> PathBuf {
    run_dir().join("config.json")
}

pub fn ensure_dirs() -> Result<(), String> {
    let dirs = [
        downloads_dir(),
        current_dir(),
        previous_dir(),
        staging_dir(),
        run_dir().join("auths"),
        run_dir().join("data"),
    ];
    for dir in dirs {
        std::fs::create_dir_all(&dir).map_err(|error| format!("创建 {} 失败：{error}", dir.display()))?;
    }
    Ok(())
}
