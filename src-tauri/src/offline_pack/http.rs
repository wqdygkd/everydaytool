// offline-pack 域：HTTP 客户端封装（reqwest blocking，统一 UA / 超时 / 错误归一）。
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::io::Read;
use std::time::Duration;

pub const USER_AGENT: &str = "Mozilla/5.0 (compatible; offline-pack/1.0)";
const DEFAULT_TIMEOUT_MS: u64 = 60_000;

pub struct HttpOptions<'a> {
    pub headers: &'a [(&'static str, String)],
    pub timeout_ms: u64,
}

impl Default for HttpOptions<'_> {
    fn default() -> Self {
        Self {
            headers: &[],
            timeout_ms: DEFAULT_TIMEOUT_MS,
        }
    }
}

/// Windows 系统代理（注册表 WinINET 设置；reqwest 默认只认环境变量，不读系统代理）
fn system_proxy() -> Option<String> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
            .ok()?;
        let enabled: u32 = key.get_value("ProxyEnable").ok()?;
        if enabled != 1 {
            return None;
        }
        let server: String = key.get_value("ProxyServer").ok()?;
        if server.is_empty() {
            return None;
        }
        let server = if server.starts_with("http://")
            || server.starts_with("https://")
            || server.starts_with("socks")
        {
            server
        } else {
            format!("http://{server}")
        };
        Some(server)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn build_client(timeout_ms: u64) -> Result<Client, String> {
    let mut builder = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(timeout_ms));
    if let Some(proxy) = system_proxy() {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy) {
            builder = builder.proxy(proxy);
        }
    }
    builder
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败：{e}"))
}

fn build_headers(extra: &[(&'static str, String)]) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    for (key, value) in extra {
        let name =
            HeaderName::from_bytes(key.as_bytes()).map_err(|_| format!("非法请求头：{key}"))?;
        let value = HeaderValue::from_str(value).map_err(|_| format!("请求头值非法：{key}"))?;
        headers.insert(name, value);
    }
    Ok(headers)
}

/** 上游错误归一：HTTP 状态 →「前缀失败：上游返回 N」；网络错误 → 超时/环境提示 */
fn map_error(error: reqwest::Error, prefix: &str) -> String {
    if error.is_timeout() {
        format!("{prefix}超时，请检查网络环境")
    } else {
        format!("{prefix}失败，请检查网络环境")
    }
}

fn assert_ok(response: Response, prefix: &str) -> Result<Response, String> {
    let status = response.status();
    if status.is_success() {
        Ok(response)
    } else {
        Err(format!("{prefix}失败：上游返回 {}", status.as_u16()))
    }
}

/// 原始 GET（不校验状态码）：Docker Bearer challenge 需要读 401 的 WWW-Authenticate 头。
/// 返回 (是否 2xx, www_authenticate 头)。
pub fn raw_get(url: &str) -> Result<(bool, String), String> {
    let client = build_client(DEFAULT_TIMEOUT_MS)?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| map_error(e, "连接镜像仓库"))?;
    let ok = response.status().is_success();
    let challenge = response
        .headers()
        .get("www-authenticate")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    Ok((ok, challenge))
}

pub fn fetch_text_with(url: &str, prefix: &str, options: &HttpOptions) -> Result<String, String> {
    let client = build_client(options.timeout_ms)?;
    let response = client
        .get(url)
        .headers(build_headers(options.headers)?)
        .send()
        .map_err(|e| map_error(e, prefix))?;
    assert_ok(response, prefix)?
        .text()
        .map_err(|e| map_error(e, prefix))
}

pub fn fetch_json(url: &str, prefix: &str) -> Result<serde_json::Value, String> {
    fetch_json_with(url, prefix, &HttpOptions::default())
}

pub fn fetch_json_with(
    url: &str,
    prefix: &str,
    options: &HttpOptions,
) -> Result<serde_json::Value, String> {
    let text = fetch_text_with(url, prefix, options)?;
    serde_json::from_str(&text).map_err(|e| format!("{prefix}失败：响应解析失败（{e}）"))
}

pub fn post_json(
    url: &str,
    body: &serde_json::Value,
    prefix: &str,
    extra_headers: &[(&'static str, String)],
) -> Result<serde_json::Value, String> {
    let mut headers = build_headers(extra_headers)?;
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    let client = build_client(DEFAULT_TIMEOUT_MS)?;
    let response = client
        .post(url)
        .headers(headers)
        .json(body)
        .send()
        .map_err(|e| map_error(e, prefix))?;
    assert_ok(response, prefix)?
        .json()
        .map_err(|e| map_error(e, prefix))
}

pub fn post_form(
    url: &str,
    form: &[(&str, &str)],
    prefix: &str,
    extra_headers: &[(&'static str, String)],
) -> Result<String, String> {
    let client = build_client(DEFAULT_TIMEOUT_MS)?;
    let response = client
        .post(url)
        .headers(build_headers(extra_headers)?)
        .form(form)
        .send()
        .map_err(|e| map_error(e, prefix))?;
    assert_ok(response, prefix)?
        .text()
        .map_err(|e| map_error(e, prefix))
}

pub struct DownloadControl<'a> {
    pub headers: &'a [(&'static str, String)],
    pub is_cancelled: &'a dyn Fn() -> bool,
    pub on_progress: &'a dyn Fn(u64, u64),
}

/// 下载到内存（中小文件），按块读取支持进度回调与取消检查
pub fn fetch_buffer(url: &str, control: &DownloadControl) -> Result<Vec<u8>, String> {
    let client = build_client(DEFAULT_TIMEOUT_MS)?;
    let mut response = client
        .get(url)
        .headers(build_headers(control.headers)?)
        .send()
        .map_err(|e| map_error(e, "下载"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败：上游返回 {}", response.status().as_u16()));
    }
    let total = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    loop {
        if (control.is_cancelled)() {
            return Err("已取消".into());
        }
        let read = response
            .read(&mut chunk)
            .map_err(|e| format!("下载失败：{e}"))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        downloaded += read as u64;
        (control.on_progress)(downloaded, total);
    }
    Ok(buffer)
}

/// 流式下载到文件：先写 .part，完成后由调用方 rename
pub fn download_to_file(
    url: &str,
    dest: &std::path::Path,
    control: &DownloadControl,
) -> Result<(), String> {
    let client = build_client(DEFAULT_TIMEOUT_MS)?;
    let mut response = client
        .get(url)
        .headers(build_headers(control.headers)?)
        .send()
        .map_err(|e| map_error(e, "下载"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败：上游返回 {}", response.status().as_u16()));
    }
    let total = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    let mut file = std::fs::File::create(dest).map_err(|e| format!("创建下载文件失败：{e}"))?;
    let mut chunk = [0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    loop {
        if (control.is_cancelled)() {
            return Err("已取消".into());
        }
        let read = response
            .read(&mut chunk)
            .map_err(|e| format!("下载失败：{e}"))?;
        if read == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &chunk[..read])
            .map_err(|e| format!("写入下载文件失败：{e}"))?;
        downloaded += read as u64;
        (control.on_progress)(downloaded, total);
    }
    Ok(())
}
