// interceptor 域：origin / 主机归一（对齐 shared/interceptor.ts 的纯函数语义）。

pub const PROXY_PORT_MIN: i64 = 1024;
pub const PROXY_PORT_MAX: i64 = 65535;
pub const PROXY_PORT_RANDOM_MIN: i64 = 20000;
pub const PROXY_PORT_RANDOM_MAX: i64 = 30000;
pub const WS_PORT_BASE: u16 = 35110;
pub const WS_PORT_RANGE: u16 = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct HostInput {
    pub host: String,
    pub port: Option<i64>,
}

fn host_chars_valid(host: &str) -> bool {
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '*' || c == ':' || c == '-')
}

fn parse_target_host_input(value: &str) -> Option<HostInput> {
    let lower = value.to_lowercase();
    let scheme_end = lower.find("://");
    let has_scheme = match scheme_end {
        Some(index) => {
            index > 0
                && lower[..index]
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_alphabetic())
                    .unwrap_or(false)
                && lower[..index]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '.' || c == '-')
        }
        None => false,
    };
    if has_scheme || value.contains('/') || value.contains('?') {
        let candidate = if has_scheme {
            value.to_string()
        } else {
            format!("http://{value}")
        };
        if let Ok(url) = url::Url::parse(&candidate) {
            let host = url.host_str()?.to_lowercase();
            if host.is_empty() {
                return None;
            }
            let port = url.port().map(|p| p as i64);
            return Some(HostInput { host, port });
        }
        return None;
    }

    // 带方括号的 IPv6（可带端口）：`[::1]` / `[::1]:8089`
    if let Some(close) = value.find(']') {
        if value.starts_with('[') {
            let host = value[1..close].to_lowercase();
            let port = value[close + 1..]
                .strip_prefix(':')
                .and_then(|p| p.parse::<i64>().ok());
            return Some(HostInput { host, port });
        }
    }

    // host:port（裸 IPv6 不含方括号，落到这里当纯主机）
    if let Some(colon) = value.rfind(':') {
        let (host, port_text) = (&value[..colon], &value[colon + 1..]);
        if let Ok(port) = port_text.parse::<i64>() {
            if (0..=65535).contains(&port) && !host.is_empty() && !host.contains(':') {
                return Some(HostInput {
                    host: host.to_lowercase(),
                    port: Some(port),
                });
            }
        }
    }

    Some(HostInput {
        host: value
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_lowercase(),
        port: None,
    })
}

/// 用户输入归一成「域名 + 端口」；解析不出主机（空格、中文、空串）时返回 None
pub fn normalize_target_host_input(raw: &str) -> Option<HostInput> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    let parsed = parse_target_host_input(value)?;
    host_chars_valid(&parsed.host).then_some(parsed)
}

/// 主机名归一：小写；IPv6 补方括号
pub fn normalize_origin_host(host: &str) -> String {
    let raw = host.trim().to_lowercase();
    if raw.is_empty() {
        return String::new();
    }
    let bare = raw.trim_start_matches('[').trim_end_matches(']');
    if bare.contains(':') {
        format!("[{bare}]")
    } else {
        bare.to_string()
    }
}

fn default_port(scheme: &str) -> i64 {
    if scheme == "https" {
        443
    } else {
        80
    }
}

/// 按 origin 语义拼串：默认端口不写
pub fn origin_of(scheme: &str, host: &str, port: Option<i64>) -> String {
    let normalized = normalize_origin_host(host);
    let effective = port.unwrap_or_else(|| default_port(scheme));
    if effective == default_port(scheme) {
        format!("{scheme}://{normalized}")
    } else {
        format!("{scheme}://{normalized}:{effective}")
    }
}

fn is_loopback_host_text(host: &str) -> bool {
    let bare = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_lowercase();
    bare == "localhost" || bare == "::1" || bare.starts_with("127.")
}

fn is_valid_origin_host(host: &str) -> bool {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.is_empty() {
        return false;
    }
    if bare.contains(':') {
        return bare.chars().all(|c| c.is_ascii_hexdigit() || c == ':');
    }
    bare.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
        && !bare.starts_with('.')
        && !bare.ends_with('.')
}

/// 用户输入 → origin；非 http(s) 协议、含通配符、解析不出主机 → None
pub fn parse_target_origin(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    let scheme_match = regex::Regex::new(r"^([a-z][a-z0-9+.-]*)://")
        .unwrap()
        .captures(value);
    let explicit_scheme = scheme_match
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_lowercase());
    if let Some(scheme) = &explicit_scheme {
        if scheme != "http" && scheme != "https" {
            return None;
        }
    }
    if explicit_scheme.is_none() && value.contains('*') {
        return None;
    }

    let candidate = explicit_scheme
        .as_ref()
        .map(|_| value.to_string())
        .unwrap_or_else(|| format!("http://{value}"));
    let url = url::Url::parse(&candidate).ok()?;
    let host = url.host_str()?.to_lowercase();
    if host.is_empty() || !is_valid_origin_host(&host) {
        return None;
    }
    let scheme = explicit_scheme.unwrap_or_else(|| {
        if is_loopback_host_text(&host) {
            "http".into()
        } else {
            "https".into()
        }
    });
    Some(origin_of(&scheme, &host, url.port().map(|p| p as i64)))
}

pub fn is_loopback_host(host: &str) -> bool {
    is_loopback_host_text(host)
}

/// 主机名归一：小写、去方括号
pub fn normalize_host(host: &str) -> String {
    host.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_target_origin_normalizes() {
        assert_eq!(
            parse_target_origin("https://www.a.com/35110.html?x=1"),
            Some("https://www.a.com".into())
        );
        assert_eq!(
            parse_target_origin("www.a.com"),
            Some("https://www.a.com".into())
        );
        assert_eq!(
            parse_target_origin("127.0.0.1:8089"),
            Some("http://127.0.0.1:8089".into())
        );
        assert_eq!(
            parse_target_origin("http://a.com:80"),
            Some("http://a.com".into())
        );
        assert_eq!(parse_target_origin("ftp://a.com"), None);
        assert_eq!(parse_target_origin("*.a.com"), None);
        assert_eq!(
            parse_target_origin("[::1]:8089"),
            Some("http://[::1]:8089".into())
        );
    }

    #[test]
    fn normalize_host_input_handles_urls_and_ports() {
        assert_eq!(
            normalize_target_host_input("https://www.a.com/35110.html"),
            Some(HostInput {
                host: "www.a.com".into(),
                port: None
            })
        );
        assert_eq!(
            normalize_target_host_input("www.a.com:8089"),
            Some(HostInput {
                host: "www.a.com".into(),
                port: Some(8089)
            })
        );
        assert_eq!(
            normalize_target_host_input("[::1]:8089"),
            Some(HostInput {
                host: "::1".into(),
                port: Some(8089)
            })
        );
        assert_eq!(normalize_target_host_input("有中文"), None);
    }
}
