// 资源身份解析：URL 只是「本次会话可复查的地址」，身份键是规范化 URL 的哈希，
// 显示地址一律脱敏。
//
// 保守策略：**不删任何 query 参数**。Telegram 的短期签名恰好放在 query 里，贸然归一化会把
// 不同资源压成同一个键（错误命中比不命中更糟）。因此键 = origin + pathname + search 的哈希，
// 只去掉 fragment。
use sha2::{Digest, Sha256};
use url::Url;

const MAX_DISPLAY_PATH: usize = 160;
const MAX_DISPLAY_QUERY_KEYS: usize = 4;

pub struct ResourceIdentity {
    pub resource_key: String,
    /// 完整地址（仅进程内持有，用于下载；不写日志、不落盘）
    pub fetch_url: String,
    pub display_url: String,
    pub host: String,
    pub path: String,
    pub scheme: String,
    pub downloadable: bool,
}

fn clean_text(value: &str) -> String {
    value
        .chars()
        .filter(|c| {
            let code = *c as u32;
            code > 31 && code != 127
        })
        .collect()
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() > max {
        let mut out: String = value.chars().take(max).collect();
        out.push('…');
        out
    } else {
        value.to_string()
    }
}

fn sanitize_search(search: &str) -> String {
    if search.is_empty() || search == "?" {
        return String::new();
    }
    let params: Vec<(String, String)> = url::form_urlencoded::parse(search.trim_start_matches('?').as_bytes())
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    if params.is_empty() {
        return "?***".into();
    }
    let total = params.len();
    let mut shown: Vec<String> = params
        .iter()
        .take(MAX_DISPLAY_QUERY_KEYS)
        .map(|(key, _)| format!("{}=***", clean_text(key)))
        .collect();
    if total > MAX_DISPLAY_QUERY_KEYS {
        shown.push(format!("…共 {total} 个参数"));
    }
    format!("?{}", shown.join("&"))
}

pub fn hash_resource_identity(normalized: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// 解析任意 URL；无法解析（blob: / data: 之外的畸形串）返回 None。
pub fn describe_url(raw: &str) -> Option<ResourceIdentity> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let Ok(url) = Url::parse(trimmed) else {
        // 不可解析：只做脱敏展示（blob: / data: 一类）
        let scheme = trimmed.split(':').next().unwrap_or("").to_lowercase();
        return Some(ResourceIdentity {
            resource_key: String::new(),
            fetch_url: String::new(),
            display_url: format!("{scheme}:{}", truncate(&clean_text(trimmed), MAX_DISPLAY_PATH)),
            host: String::new(),
            path: truncate(&clean_text(trimmed), MAX_DISPLAY_PATH),
            scheme,
            downloadable: false,
        });
    };

    let scheme = url.scheme().to_lowercase();
    let host = clean_text(url.host_str().unwrap_or(""));
    let display_path = format!(
        "{}{}",
        truncate(&clean_text(url.path()), MAX_DISPLAY_PATH),
        sanitize_search(url.query().map(|q| format!("?{q}")).unwrap_or_default().as_str())
    );

    if matches!(scheme.as_str(), "http" | "https" | "ws" | "wss") {
        let query = url
            .query()
            .map(|value| format!("?{value}"))
            .unwrap_or_default();
        let normalized = format!("{}{}{}", url.origin().ascii_serialization(), url.path(), query);
        let digest = hash_resource_identity(&normalized);
        let is_http = scheme == "http" || scheme == "https";
        return Some(ResourceIdentity {
            resource_key: format!(
                "{}:v1:{}",
                if is_http { "http" } else { "ws" },
                &digest[..40]
            ),
            fetch_url: if is_http { normalized } else { String::new() },
            display_url: format!("{}://{}{}", scheme, host, display_path),
            host,
            path: display_path,
            scheme,
            downloadable: is_http,
        });
    }

    Some(ResourceIdentity {
        resource_key: String::new(),
        fetch_url: String::new(),
        display_url: format!("{}:{}", scheme, truncate(&clean_text(&host), MAX_DISPLAY_PATH)),
        host: String::new(),
        path: truncate(&clean_text(url.path()), MAX_DISPLAY_PATH),
        scheme,
        downloadable: false,
    })
}

/// 只接受本工具写入的键格式（命令入参校验，避免渲染层伪造任意键）
pub fn is_resource_key(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("http:v1:").or_else(|| value.strip_prefix("ws:v1:")) else {
        return false;
    };
    rest.len() == 40 && rest.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_query_values_and_keeps_identity_stable() {
        let a = describe_url("https://cdn.example.com/a/b.jpg?sig=1&x=2#frag").unwrap();
        let b = describe_url("https://cdn.example.com/a/b.jpg?sig=1&x=2").unwrap();
        assert_eq!(a.resource_key, b.resource_key, "fragment 不参与身份");
        assert!(a.display_url.contains("sig=***"), "{}", a.display_url);
        assert!(!a.display_url.contains("sig=1"));
        assert_eq!(a.host, "cdn.example.com");
        assert!(a.downloadable);
        assert_eq!(a.scheme, "https");
        assert!(is_resource_key(&a.resource_key));
    }

    #[test]
    fn different_query_is_different_identity() {
        let a = describe_url("https://cdn.example.com/x?a=1").unwrap();
        let b = describe_url("https://cdn.example.com/x?a=2").unwrap();
        assert_ne!(a.resource_key, b.resource_key);
    }

    #[test]
    fn websocket_is_observable_but_not_downloadable() {
        let ws = describe_url("wss://example.com/ws?token=secret").unwrap();
        assert!(!ws.downloadable);
        assert!(ws.resource_key.starts_with("ws:v1:"));
        assert!(ws.display_url.contains("token=***"));
    }

    #[test]
    fn blob_url_only_for_display() {
        let blob = describe_url("blob:https://web.telegram.org/abc").unwrap();
        assert!(!blob.downloadable);
        assert!(blob.resource_key.is_empty());
    }

    #[test]
    fn rejects_forged_keys() {
        assert!(!is_resource_key("http:v1:abc"));
        assert!(!is_resource_key("http:v1:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"));
    }
}
