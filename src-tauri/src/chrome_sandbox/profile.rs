// chrome-sandbox 域：沙箱 profile 克隆 / 修复 + 指纹扩展落盘（对齐 Node 版 cloner.ts / config-writer.ts）。
use super::paths;
use super::store::Fingerprint;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const PROFILE_ITEMS_CORE: [&str; 2] = ["Bookmarks", "Preferences"];
const PROFILE_PASSWORD_DATABASES: [&str; 2] = ["Login Data", "Login Data For Account"];
const SQLITE_SIDECAR_SUFFIXES: [&str; 4] = ["", "-journal", "-wal", "-shm"];
const PROFILE_ITEM_SECURE_PREFS: &str = "Secure Preferences";
const EXTENSION_STATE_ITEMS: [&str; 4] = [
    "Extension State",
    "Local Extension Settings",
    "Extension Scripts",
    "Extension Rules",
];
const EXTENSION_ASSET_ITEMS: [&str; 5] = [
    "Extensions",
    "Extension State",
    "Local Extension Settings",
    "Extension Scripts",
    "Extension Rules",
];
const FINGERPRINT_CONFIG_FILE: &str = "fingerprint-config.json";

fn copy_dir_recursive(src: &Path, dest: &Path, skip_files: &[&str]) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("源目录不存在：{}", src.display()));
    }
    fs::create_dir_all(dest).map_err(|e| format!("创建目录失败：{e}"))?;
    let entries = fs::read_dir(src).map_err(|e| format!("读取目录失败：{e}"))?;
    for entry in entries.flatten() {
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to, skip_files)?;
        } else if !skip_files.contains(&entry.file_name().to_string_lossy().as_ref()) {
            fs::copy(&from, &to).map_err(|e| format!("复制文件失败：{e}"))?;
        }
    }
    Ok(())
}

fn copy_if_exists(src: &Path, dest: &Path) -> bool {
    if !src.exists() {
        return false;
    }
    if src.is_dir() {
        copy_dir_recursive(src, dest, &[]).is_ok()
    } else {
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::copy(src, dest).is_ok()
    }
}

fn remove_if_exists(target: &Path) {
    if target.is_dir() {
        let _ = fs::remove_dir_all(target);
    } else if target.exists() {
        let _ = fs::remove_file(target);
    }
}

fn read_json_or(path: &Path, fallback: Value) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(fallback)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, format!("{body}\n")).map_err(|e| format!("写入失败：{e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("保存失败：{e}"))
}

fn clone_items(inherit_extensions: bool) -> Vec<&'static str> {
    if inherit_extensions {
        let mut items = PROFILE_ITEMS_CORE.to_vec();
        items.push(PROFILE_ITEM_SECURE_PREFS);
        items.extend(EXTENSION_ASSET_ITEMS);
        items
    } else {
        PROFILE_ITEMS_CORE.to_vec()
    }
}

fn copy_password_stores(source_profile: &Path, target_profile: &Path) {
    for database in PROFILE_PASSWORD_DATABASES {
        for suffix in SQLITE_SIDECAR_SUFFIXES {
            let item = format!("{database}{suffix}");
            copy_if_exists(&source_profile.join(&item), &target_profile.join(&item));
        }
    }
}

fn remove_extension_profile_data(profile_path: &Path) {
    let mut items: Vec<&str> = EXTENSION_ASSET_ITEMS.to_vec();
    items.push(PROFILE_ITEM_SECURE_PREFS);
    for item in items {
        remove_if_exists(&profile_path.join(item));
    }
}

fn patch_preferences(profile_path: &Path, inherit_extensions: bool) -> Result<(), String> {
    let prefs_path = profile_path.join("Preferences");
    let mut prefs = read_json_or(&prefs_path, json!({}));

    prefs["session"] = prefs.get("session").cloned().unwrap_or(json!({}));
    prefs["session"]["restore_on_startup"] = json!(1);

    if !inherit_extensions {
        let developer_mode = prefs.pointer("/extensions/ui/developer_mode").cloned();
        prefs["extensions"] = json!({ "settings": { "enable_extensions": true } });
        if let Some(developer_mode) = developer_mode {
            prefs["extensions"]["ui"] = json!({ "developer_mode": developer_mode });
        }
    } else {
        let settings = prefs
            .pointer("/extensions/settings")
            .cloned()
            .unwrap_or(json!({}));
        prefs["extensions"] = prefs.get("extensions").cloned().unwrap_or(json!({}));
        prefs["extensions"]["settings"] = settings;
        prefs["extensions"]["settings"]["enable_extensions"] = json!(true);
    }

    write_json(&prefs_path, &prefs)
}

fn write_local_state_profile(
    sandbox_path: &Path,
    profile_dir_name: &str,
    copy_from_source: bool,
    inherit_extensions: bool,
) -> Result<(), String> {
    let dest = sandbox_path.join("Local State");
    if copy_from_source {
        let source = paths::chrome_user_data_root().join("Local State");
        copy_if_exists(&source, &dest);
    }

    let mut local_state = read_json_or(&dest, json!({}));
    local_state["profile"] = local_state.get("profile").cloned().unwrap_or(json!({}));
    local_state["profile"]["info_cache"] = json!({
        profile_dir_name: {
            "name": profile_dir_name,
            "is_using_default_name": true,
        }
    });
    local_state["profile"]["last_used"] = json!(profile_dir_name);
    local_state["profile"]["profiles_created"] = json!(1);
    local_state["profile"]["profiles_order"] = json!([profile_dir_name]);
    if !inherit_extensions {
        if let Some(map) = local_state.as_object_mut() {
            map.remove("extensions");
            map.remove("updateclientdata");
        }
    }
    write_json(&dest, &local_state)
}

/// 新建沙箱：从系统 Chrome 默认 profile 克隆核心数据
pub fn init_sandbox_user_data(
    sandbox_path: &Path,
    sandbox_id: &str,
    inherit_extensions: bool,
) -> Result<(), String> {
    let source_profile = paths::default_chrome_profile_path();
    let profile_dir_name = paths::sandbox_profile_directory_name(sandbox_id);
    let profile_path = sandbox_path.join(&profile_dir_name);
    fs::create_dir_all(&profile_path).map_err(|e| format!("创建沙箱目录失败：{e}"))?;

    for item in clone_items(inherit_extensions) {
        copy_if_exists(&source_profile.join(item), &profile_path.join(item));
    }
    copy_password_stores(&source_profile, &profile_path);
    patch_preferences(&profile_path, inherit_extensions)?;
    if !inherit_extensions {
        remove_extension_profile_data(&profile_path);
    }
    write_local_state_profile(sandbox_path, &profile_dir_name, true, inherit_extensions)
}

/// 启动前修复：补密码库 / 扩展状态 / Local State / Preferences
pub fn repair_sandbox_profile(
    sandbox_path: &Path,
    sandbox_id: &str,
    inherit_extensions: bool,
) -> Result<(), String> {
    let source_profile = paths::default_chrome_profile_path();
    let profile_dir_name = paths::sandbox_profile_directory_name(sandbox_id);
    let profile_path = sandbox_path.join(&profile_dir_name);

    // 联通版早期把 profile 放在 Default/：迁到专属目录名
    let legacy = sandbox_path.join("Default");
    if !profile_path.exists() && legacy.exists() {
        let _ = fs::rename(&legacy, &profile_path);
    }
    fs::create_dir_all(&profile_path).map_err(|e| format!("创建沙箱目录失败：{e}"))?;

    if !profile_path.join("Login Data").exists() {
        copy_password_stores(&source_profile, &profile_path);
    }

    if inherit_extensions {
        for item in EXTENSION_STATE_ITEMS {
            let dest = profile_path.join(item);
            if !dest.exists() {
                copy_if_exists(&source_profile.join(item), &dest);
            }
        }
    } else {
        remove_extension_profile_data(&profile_path);
    }

    let copy_local_state = !sandbox_path.join("Local State").exists();
    write_local_state_profile(
        sandbox_path,
        &profile_dir_name,
        copy_local_state,
        inherit_extensions,
    )?;
    patch_preferences(&profile_path, inherit_extensions)
}

/// 把指纹写进沙箱的指纹扩展目录；共享扩展模板首次使用时初始化
pub fn prepare_fingerprint_extension(
    app: &tauri::AppHandle,
    target_path: &Path,
    fingerprint: &Fingerprint,
) -> Result<(), String> {
    let shared_path = paths::shared_fingerprint_ext_path();
    if !shared_path.join("manifest.json").exists() {
        let template = paths::extension_template_path(app);
        copy_dir_recursive(&template, &shared_path, &[FINGERPRINT_CONFIG_FILE])?;
    }
    fs::create_dir_all(target_path).map_err(|e| format!("创建指纹扩展目录失败：{e}"))?;
    copy_dir_recursive(&shared_path, target_path, &[])?;
    update_fingerprint_config(target_path, fingerprint)
}

pub fn update_fingerprint_config(
    target_path: &Path,
    fingerprint: &Fingerprint,
) -> Result<(), String> {
    let value = serde_json::to_value(fingerprint).map_err(|e| e.to_string())?;
    write_json(&target_path.join(FINGERPRINT_CONFIG_FILE), &value)
}
