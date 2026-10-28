// workbuddy2api-panel 域：HTTP 抓取与下载（GitHub release API + 资产下载）。
// - 下载地址走白名单：仅 `misakano7545/workbuddy2api-panel` 的 API / 页面 / release CDN；
// - 先写 `<dest>.part`，完整落盘后才 rename：取消 / 失败不会在 downloads/ 里留下残缺 zip；
// - 用户主动取消由 `cancel_active_download()` 置标记，下载循环在下一块读取时退出。
use super::{ProgressEvent, GITHUB_SLUG};
use std::fs::File;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};

const USER_AGENT: &str = "everydaytool-workbuddy2api-panel/1.0";
const TIMEOUT_SECS: u64 = 120;
static ACTIVE_DOWNLOAD: AtomicBool = AtomicBool::new(false);
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn cancel_active_download() -> bool {
    if !ACTIVE_DOWNLOAD.load(Ordering::SeqCst) {
        return false;
    }
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    true
}

fn is_cancelled() -> bool {
    CANCEL_REQUESTED.load(Ordering::SeqCst)
}

/// 下载 URL 白名单：仅该 GitHub repo / api / release CDN。
pub fn is_allowed_download_url(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or("").to_lowercase();
    let path = url.path();
    match host.as_str() {
        "api.github.com" => path.starts_with(&format!("/repos/{GITHUB_SLUG}/")),
        "github.com" => path.starts_with(&format!("/{GITHUB_SLUG}/")),
        other => other == "objects.githubusercontent.com" || other.ends_with(".githubusercontent.com"),
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("HTTP 客户端创建失败：{error}"))
}

fn request(url: &str) -> Result<reqwest::blocking::Response, String> {
    if !is_allowed_download_url(url) {
        return Err(format!("拒绝非白名单下载地址：{url}"));
    }
    client()?
        .get(url)
        .send()
        .map_err(|error| format!("请求失败：{error}"))
}

pub fn fetch_github_json(url: &str) -> Result<serde_json::Value, String> {
    let response = request(url)?;
    if !response.status().is_success() {
        return Err(format!("GitHub API {}", response.status().as_u16()));
    }
    response
        .json::<serde_json::Value>()
        .map_err(|error| format!("解析 GitHub 响应失败：{error}"))
}

/// 下载到文件；`on_progress(downloaded, total)` 每读一块回调一次。
pub fn download_to_file<F>(
    url: &str,
    dest: &std::path::Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    let response = request(url)?;
    if !response.status().is_success() {
        return Err(format!("下载失败 HTTP {}", response.status().as_u16()));
    }
    let total = response.content_length().unwrap_or(0);
    let temp = dest.with_extension("part");
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建下载目录失败：{error}"))?;
    }

    ACTIVE_DOWNLOAD.store(true, Ordering::SeqCst);
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);
    let result = (|| -> Result<(), String> {
        let mut file = File::create(&temp).map_err(|error| format!("创建临时文件失败：{error}"))?;
        let mut source = response;
        let mut buffer = vec![0u8; 128 * 1024];
        let mut downloaded: u64 = 0;
        loop {
            if is_cancelled() {
                return Err("已取消下载".into());
            }
            let read = source
                .read(&mut buffer)
                .map_err(|error| format!("读取响应失败：{error}"))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])
                .map_err(|error| format!("写入文件失败：{error}"))?;
            downloaded += read as u64;
            on_progress(downloaded, total);
        }
        file.flush().map_err(|error| format!("写入文件失败：{error}"))?;
        drop(file);
        // Windows 上句柄未释放时改名可能 EBUSY：先关文件再 rename
        if dest.exists() {
            let _ = std::fs::remove_file(dest);
        }
        std::fs::rename(&temp, dest).map_err(|error| format!("落盘失败：{error}"))?;
        Ok(())
    })();
    ACTIVE_DOWNLOAD.store(false, Ordering::SeqCst);
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

pub fn progress(phase: &str, downloaded: u64, total: u64, message: Option<String>) -> ProgressEvent {
    ProgressEvent {
        phase: phase.to_string(),
        downloaded_bytes: downloaded,
        total_bytes: total,
        message,
        error: None,
    }
}

pub fn progress_error(phase: &str, error: Option<String>) -> ProgressEvent {
    ProgressEvent {
        phase: phase.to_string(),
        downloaded_bytes: 0,
        total_bytes: 0,
        message: None,
        error,
    }
}
