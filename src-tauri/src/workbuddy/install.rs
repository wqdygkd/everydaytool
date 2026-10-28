// workbuddy2api-panel 域：安装 / 更新（GitHub release 与本地 ZIP）。
//
// 目录结构与 Electron 版一致：
//   runtime/staging   解压落地处
//   runtime/current   当前版本（可执行文件所在）
//   runtime/previous  上一版本（更新失败回滚用）
// 更新单轨：stop → 装新 → 探活命中身份即成功，否则回滚 previous 并恢复旧 manifest。
use super::{
    digest, http, paths, process, store, Manifest, ProgressEvent, ReleaseSnapshot, GITHUB_SLUG,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    #[serde(default)]
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

struct ReleasePick {
    version: String,
    tag: String,
    asset_name: String,
    download_url: String,
    digest: Option<String>,
}

/// 当前平台 → 上游资产 os / arch 段。
pub fn resolve_platform() -> Result<(&'static str, &'static str), String> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err("当前平台不受支持".into());
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "amd64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        return Err("当前架构不受支持（仅 x64 / arm64）".into());
    };
    Ok((os, arch))
}

fn version_from_tag(tag: &str) -> String {
    tag.trim_start_matches('v').to_string()
}

fn tag_from_version(version: &str) -> String {
    format!("v{}", version.trim_start_matches('v'))
}

fn build_asset_name(version: &str, os: &str, arch: &str) -> String {
    format!("wb2api-panel-{}-{os}-{arch}.zip", version.trim_start_matches('v'))
}

fn app_handle() -> Option<AppHandle> {
    super::APP.get().cloned()
}

fn emit(event: ProgressEvent) {
    if let Some(app) = app_handle() {
        super::emit_progress(&app, event);
    }
}

fn emit_phase(phase: &str, message: &str) {
    emit(http::progress(phase, 0, 0, Some(message.to_string())));
}

fn pick_release_asset(tag: Option<&str>) -> Result<ReleasePick, String> {
    let (os, arch) = resolve_platform()?;
    let url = match tag {
        Some(tag) => format!(
            "https://api.github.com/repos/{GITHUB_SLUG}/releases/tags/{tag}"
        ),
        None => format!("https://api.github.com/repos/{GITHUB_SLUG}/releases/latest"),
    };
    let release: GithubRelease = serde_json::from_value(http::fetch_github_json(&url)?)
        .map_err(|error| format!("解析 release 失败：{error}"))?;
    let version = version_from_tag(&release.tag_name);
    let asset_name = build_asset_name(&version, os, arch);
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| format!("Release {} 未找到资产 {asset_name}", release.tag_name))?;
    Ok(ReleasePick {
        version,
        tag: release.tag_name,
        asset_name: asset.name,
        download_url: asset.browser_download_url,
        digest: asset.digest,
    })
}

fn snapshot_from_pick(pick: &ReleasePick, digest: String) -> ReleaseSnapshot {
    ReleaseSnapshot {
        latest_version: pick.version.clone(),
        latest_tag: pick.tag.clone(),
        asset_name: pick.asset_name.clone(),
        digest,
        download_url: pick.download_url.clone(),
        checked_at: super::now_timestamp(),
    }
}

fn promote_staging_to_current() -> Result<std::path::PathBuf, String> {
    let staging = paths::staging_dir();
    let current = paths::current_dir();
    let previous = paths::previous_dir();
    let binary_name = process::binary_file_name();

    let found = super::zip::find_binary_in_dir(&staging, binary_name)
        .ok_or_else(|| format!("解压后未找到 {binary_name}"))?;

    // 扁平化：把二进制与同级 config.example.json 提到 staging 根
    let staging_root_binary = staging.join(binary_name);
    if found != staging_root_binary {
        std::fs::copy(&found, &staging_root_binary)
            .map_err(|error| format!("搬运二进制失败：{error}"))?;
        let example_src = found
            .parent()
            .map(|parent| parent.join("config.example.json"));
        if let Some(example_src) = example_src {
            if example_src.is_file() {
                let _ = std::fs::copy(example_src, staging.join("config.example.json"));
            }
        }
    }
    process::prepare_binary_permissions(&staging_root_binary);

    let _ = std::fs::remove_dir_all(&previous);
    if std::fs::rename(&current, &previous).is_err() {
        let _ = std::fs::remove_dir_all(&current);
    }
    if let Some(parent) = current.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&staging, &current).map_err(|error| format!("晋升 current 失败：{error}"))?;
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;

    process::resolve_current_binary_path().ok_or_else(|| "晋升 current 后找不到二进制".into())
}

fn rollback_previous() {
    let current = paths::current_dir();
    let previous = paths::previous_dir();
    let staging = paths::staging_dir();
    emit_phase("rollback", "更新失败，回滚 previous");
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::create_dir_all(&staging);

    let tmp = current.with_extension("rollback-tmp");
    let _ = std::fs::remove_dir_all(&tmp);
    if std::fs::rename(&current, &tmp).is_err() {
        let _ = std::fs::remove_dir_all(&current);
    }
    if std::fs::rename(&previous, &current).is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    } else {
        let _ = std::fs::rename(&tmp, &previous);
    }
}

fn install_from_zip_file(
    zip_path: &std::path::Path,
    version: &str,
    tag: &str,
    asset_name: &str,
    digest_value: &str,
    source: &str,
) -> Result<Manifest, String> {
    let (os, arch) = resolve_platform()?;
    emit_phase("verify", "校验 digest");
    digest::assert_file_digest(zip_path, digest_value)?;

    emit_phase("extract", "解压到 staging");
    super::zip::extract_archive(zip_path, &paths::staging_dir())?;

    emit_phase("promote", "晋升为 current");
    promote_staging_to_current()?;
    super::config::ensure_run_config_initialized()?;

    let manifest = Manifest {
        version: version.to_string(),
        tag: tag.to_string(),
        os: os.to_string(),
        arch: arch.to_string(),
        asset_name: asset_name.to_string(),
        digest: digest::normalize_digest(Some(digest_value)).unwrap_or_else(|| digest_value.to_string()),
        source: source.to_string(),
        installed_at: super::now_timestamp(),
    };
    store::write_manifest(&manifest)?;
    emit_phase("done", "安装完成");
    Ok(manifest)
}

fn download_release(pick: &ReleasePick) -> Result<std::path::PathBuf, String> {
    let dest = paths::downloads_dir().join(&pick.asset_name);
    emit_phase("download", &format!("下载 {}", pick.asset_name));
    let name = pick.asset_name.clone();
    http::download_to_file(&pick.download_url, &dest, move |downloaded, total| {
        emit(http::progress("download", downloaded, total, Some(format!("下载 {name}"))));
    })?;
    Ok(dest)
}

fn cancelled_error() -> String {
    super::Cancelled.to_string()
}

pub fn install_from_github(tag: Option<&str>) -> Result<Value, String> {
    if super::is_busy() {
        return Err("已有安装/更新任务进行中".into());
    }
    // 运行中不换版本：Windows 上 current/ 里正在执行的 exe 换不掉，
    // 而且「装着新版本、跑着旧进程」会让状态与版本对不上。
    if process::is_process_managed_alive() {
        return Err("服务运行中，请先停止再安装 / 切换版本".into());
    }
    super::set_busy(true);
    super::set_cancel_requested(false);
    let result = (|| -> Result<Manifest, String> {
        paths::ensure_dirs()?;
        let pick = pick_release_asset(tag)?;
        let digest_value = digest::normalize_digest(pick.digest.as_deref())
            .ok_or_else(|| format!("资产 {} 缺少 GitHub digest，拒绝安装", pick.asset_name))?;

        let zip_path = download_release(&pick)?;
        let manifest = install_from_zip_file(
            &zip_path,
            &pick.version,
            &pick.tag,
            &pick.asset_name,
            &digest_value,
            "github",
        )?;
        // 装的就是 latest release 时顺手写缓存，面板不必再点一次「检查更新」；
        // 显式指定 tag 的安装不冒充「最新」。
        if tag.is_none() {
            super::set_release_snapshot(Some(snapshot_from_pick(&pick, digest_value)));
        }
        Ok(manifest)
    })();
    super::set_busy(false);
    super::set_cancel_requested(false);

    match result {
        Ok(manifest) => serde_json::to_value(manifest).map_err(|error| error.to_string()),
        Err(error) => {
            let cancelled = error == cancelled_error();
            emit(http::progress_error(
                if cancelled { "cancelled" } else { "error" },
                if cancelled { None } else { Some(error.clone()) },
            ));
            if cancelled {
                Err(cancelled_error())
            } else {
                Err(error)
            }
        }
    }
}

pub fn install_from_local_zip(app: &AppHandle) -> Result<Option<Value>, String> {
    if super::is_busy() {
        return Err("已有安装/更新任务进行中".into());
    }
    if process::is_process_managed_alive() {
        return Err("服务运行中，请先停止再安装 / 切换版本".into());
    }

    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("选择 workbuddy2api-panel 安装包")
        .add_filter("ZIP", &["zip"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let zip_path = picked
        .into_path()
        .map_err(|error| format!("无法解析所选文件路径：{error}"))?;

    super::set_busy(true);
    let result = (|| -> Result<Manifest, String> {
        paths::ensure_dirs()?;
        let digest_value = digest::sha256_file_digest(&zip_path)?;
        let base = zip_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("wb2api-panel.zip")
            .to_string();
        // 尽量从文件名解析版本（wb2api-panel-1.2.3-<os>-<arch>.zip），失败则用时间戳标记
        let version = base
            .strip_prefix("wb2api-panel-")
            .and_then(|rest| rest.split('-').next())
            .filter(|value| !value.is_empty() && value.chars().all(|c| c.is_ascii_digit() || c == '.'))
            .map(str::to_string)
            .unwrap_or_else(|| format!("local-{}", std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_secs())
                .unwrap_or(0)));
        let tag = tag_from_version(&version);

        // 复制到 downloads 留存
        let dest = paths::downloads_dir().join(&base);
        std::fs::copy(&zip_path, &dest).map_err(|error| format!("留存安装包失败：{error}"))?;

        install_from_zip_file(&dest, &version, &tag, &base, &digest_value, "local-file")
    })();
    super::set_busy(false);

    match result {
        Ok(manifest) => serde_json::to_value(manifest)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) => {
            emit(http::progress_error("error", Some(error.clone())));
            Err(error)
        }
    }
}

pub fn check_update() -> Result<Value, String> {
    // 只对「已安装」判断更新：没有 manifest 就没有比较基准
    let installed = store::read_manifest().map(|manifest| manifest.version);
    let Some(installed_version) = installed else {
        return Err("尚未安装，无法检查更新".into());
    };
    let pick = pick_release_asset(None)?;
    let digest_value = digest::normalize_digest(pick.digest.as_deref())
        .ok_or_else(|| format!("最新版本资产 {} 缺少 digest", pick.asset_name))?;
    let snapshot = snapshot_from_pick(&pick, digest_value);
    let info = json!({
        "currentVersion": installed_version,
        "latestVersion": snapshot.latest_version,
        "latestTag": snapshot.latest_tag,
        "assetName": snapshot.asset_name,
        "digest": snapshot.digest,
        "downloadUrl": snapshot.download_url,
        "hasUpdate": installed_version != snapshot.latest_version,
    });
    super::set_release_snapshot(Some(snapshot));
    Ok(info)
}

pub fn apply_update(_app: &AppHandle) -> Result<Value, String> {
    if super::is_busy() {
        return Err("已有安装/更新任务进行中".into());
    }
    // 未安装时没有「旧版本」可回滚；必须在 set_busy 之前判，否则抛错会把 busy 永久置 true
    let previous_manifest = store::read_manifest().ok_or("尚未安装，无法应用更新")?;
    super::set_busy(true);
    super::set_cancel_requested(false);

    let result = (|| -> Result<Manifest, String> {
        paths::ensure_dirs()?;
        process::stop_managed_process()?;

        let pick = pick_release_asset(None)?;
        let digest_value = digest::normalize_digest(pick.digest.as_deref())
            .ok_or_else(|| format!("资产 {} 缺少 GitHub digest", pick.asset_name))?;

        let zip_path = download_release(&pick)?;
        let manifest = install_from_zip_file(
            &zip_path,
            &pick.version,
            &pick.tag,
            &pick.asset_name,
            &digest_value,
            "github",
        )?;

        // 探活验证：命中身份才算更新成功，否则回滚 previous
        let health_ok = match process::start_managed_process() {
            Ok((port, _)) => super::health::probe_healthz(port).ok,
            Err(error) => {
                rollback_previous();
                let _ = store::write_manifest(&previous_manifest);
                let _ = process::start_managed_process();
                return Err(error);
            }
        };
        if !health_ok {
            let _ = process::stop_managed_process();
            rollback_previous();
            let _ = store::write_manifest(&previous_manifest);
            let _ = process::start_managed_process();
            return Err("更新后探活未命中 service=workbuddy2api".into());
        }

        // 更新成功：这次发布的快照进缓存，面板立刻显示「已是最新」
        super::set_release_snapshot(Some(snapshot_from_pick(&pick, digest_value)));
        Ok(manifest)
    })();

    super::set_busy(false);
    super::set_cancel_requested(false);

    match result {
        Ok(manifest) => serde_json::to_value(manifest).map_err(|error| error.to_string()),
        Err(error) => {
            let cancelled = error == cancelled_error();
            emit(http::progress_error(
                if cancelled { "cancelled" } else { "error" },
                if cancelled { None } else { Some(error.clone()) },
            ));
            if cancelled {
                // 取消发生在下载阶段：更新流程已经停过服务，把原来那版重新拉起来
                let _ = process::start_managed_process();
                Err(cancelled_error())
            } else {
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_asset_name_and_tag_round_trip() {
        assert_eq!(
            build_asset_name("1.2.3", "darwin", "arm64"),
            "wb2api-panel-1.2.3-darwin-arm64.zip"
        );
        assert_eq!(build_asset_name("v1.2.3", "windows", "amd64"), "wb2api-panel-1.2.3-windows-amd64.zip");
        assert_eq!(tag_from_version("1.2.3"), "v1.2.3");
        assert_eq!(version_from_tag("v1.2.3"), "1.2.3");
    }

    #[test]
    fn resolves_current_platform() {
        let (os, arch) = resolve_platform().unwrap();
        assert!(matches!(os, "darwin" | "windows" | "linux"));
        assert!(matches!(arch, "amd64" | "arm64"));
    }
}
