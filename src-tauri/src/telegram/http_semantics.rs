// HTTP 缓存语义（纯函数，无 IO）：只解析本工具需要的子集——
// no-store / no-cache / private / public / max-age / must-revalidate / immutable / Vary。
// **不使用启发式新鲜度**（没有 max-age 就不本地复用），保守优先。
//
// 本项目没有 `protocol.handle` 等价能力（Tauri/wry 无法拦截 https 请求），本地响应开关
// 仍按原契约计算 serve_class / fresh_until，但不会真的替换页面请求（见 docs/telegram-cache.md）。

pub const LOCAL_RESPONSE_MIME_PREFIX: &str = "image/";

const ACCEPTABLE_VARY_TOKENS: [&str; 1] = ["accept-encoding"];

#[derive(Debug, Clone, Default)]
pub struct ParsedCacheControl {
    pub no_store: bool,
    pub no_cache: bool,
    pub private: bool,
    pub public: bool,
    pub max_age_seconds: Option<i64>,
    pub must_revalidate: bool,
    pub immutable: bool,
}

pub fn parse_cache_control(raw: Option<&str>) -> ParsedCacheControl {
    let mut parsed = ParsedCacheControl::default();
    let Some(raw) = raw else {
        return parsed;
    };
    for part in raw.split(',') {
        let mut pieces = part.trim().split('=');
        let key = pieces.next().unwrap_or("").trim().to_lowercase();
        if key.is_empty() {
            continue;
        }
        let value = pieces
            .next()
            .map(|value| value.trim().trim_matches('"').to_string());
        match key.as_str() {
            "no-store" => parsed.no_store = true,
            "no-cache" => parsed.no_cache = true,
            "private" => parsed.private = true,
            "public" => parsed.public = true,
            "must-revalidate" => parsed.must_revalidate = true,
            "immutable" => parsed.immutable = true,
            "max-age" => {
                if let Some(seconds) = value.and_then(|value| value.parse::<f64>().ok()) {
                    if seconds.is_finite() && seconds >= 0.0 {
                        parsed.max_age_seconds = Some(seconds as i64);
                    }
                }
            }
            _ => {}
        }
    }
    parsed
}

pub fn parse_vary(raw: Option<&str>) -> Vec<String> {
    raw.map(|value| {
        value
            .split(',')
            .map(|token| token.trim().to_lowercase())
            .filter(|token| !token.is_empty())
            .collect()
    })
    .unwrap_or_default()
}

/// Vary 只有 accept-encoding（或为空）时才允许本地复用，避免把带 cookie / ua 的变体当同一份内容
pub fn is_vary_acceptable(vary: Option<&str>) -> bool {
    parse_vary(vary)
        .iter()
        .all(|token| ACCEPTABLE_VARY_TOKENS.contains(&token.as_str()))
}

#[derive(Debug, Clone)]
pub struct CacheFreshness {
    pub cache_control: Option<String>,
    pub etag: Option<String>,
    pub vary: Option<String>,
    pub no_store: bool,
    pub no_cache: bool,
    pub private: bool,
    pub max_age_seconds: Option<i64>,
    pub quota_managed: bool,
    pub cacheable: bool,
    pub serve_class: String,
    pub fresh_until: Option<u64>,
    pub stored_at: u64,
}

pub struct EvaluateInput<'a> {
    pub mime_type: Option<&'a str>,
    pub status_code: Option<u16>,
    pub cache_control: Option<&'a str>,
    pub etag: Option<&'a str>,
    pub vary: Option<&'a str>,
    pub age_seconds: Option<i64>,
    pub stored_at: u64,
}

fn serve_class_of(mime_type: &str) -> &'static str {
    if mime_type.starts_with(LOCAL_RESPONSE_MIME_PREFIX) {
        "image"
    } else if mime_type.starts_with("video/") || mime_type.starts_with("audio/") {
        "media"
    } else {
        "none"
    }
}

/// 一条响应能否进入「可本地复用」的缓存：图片 / 音视频 MIME、200、未声明
/// no-store / private / no-cache、max-age > 0、Vary 可接受。其余仍可归档，但永不自动替换请求。
pub fn evaluate_response_caching(input: EvaluateInput<'_>) -> CacheFreshness {
    let parsed = parse_cache_control(input.cache_control);
    let age = input.age_seconds.unwrap_or(0).max(0);
    let fresh_until = parsed
        .max_age_seconds
        .map(|seconds| input.stored_at + ((seconds - age).max(0) as u64) * 1000);
    let mime_type = input.mime_type.unwrap_or("");
    let serve_class = serve_class_of(mime_type);
    let cacheable = serve_class != "none"
        && input.status_code == Some(200)
        && !parsed.no_store
        && !parsed.private
        && !parsed.no_cache
        && parsed.max_age_seconds.unwrap_or(0) > 0
        && is_vary_acceptable(input.vary);

    CacheFreshness {
        cache_control: input.cache_control.map(str::to_string),
        etag: input.etag.map(str::to_string),
        vary: input.vary.map(str::to_string),
        no_store: parsed.no_store,
        no_cache: parsed.no_cache,
        private: parsed.private,
        max_age_seconds: parsed.max_age_seconds,
        // no-store 内容只为用户主动归档保留，不占缓存配额、不参与 LRU
        quota_managed: !parsed.no_store,
        cacheable,
        serve_class: serve_class.to_string(),
        fresh_until,
        stored_at: input.stored_at,
    }
}

pub fn is_cache_fresh(freshness: &CacheFreshness, now: u64) -> bool {
    freshness.cacheable && freshness.fresh_until.map(|until| until > now).unwrap_or(false)
}

/// 本地响应对页面声明的剩余新鲜期（秒，至少 0）
pub fn remaining_fresh_seconds(freshness: &CacheFreshness, now: u64) -> u64 {
    freshness
        .fresh_until
        .map(|until| until.saturating_sub(now) / 1000)
        .unwrap_or(0)
}

/// 单区间解析结果：None = 不支持 / 多区间（回源）；Unsatisfiable = 416
#[derive(Debug, Clone, PartialEq)]
pub enum ByteRange {
    Range { start: u64, end: u64 },
    Unsatisfiable,
}

/// 解析 `Range: bytes=start-end`（单区间）。多区间、非法语法、非法区间一律 None 由调用方回源。
pub fn parse_byte_range(header: Option<&str>, size: u64) -> Option<ByteRange> {
    let header = header?.trim();
    let rest = header
        .strip_prefix("bytes=")
        .or_else(|| header.strip_prefix("Bytes="))?;
    if rest.contains(',') {
        return None;
    }
    let (raw_start, raw_end) = rest.split_once('-')?;
    let raw_start = raw_start.trim();
    let raw_end = raw_end.trim();
    if raw_start.is_empty() && raw_end.is_empty() {
        return None;
    }
    if size == 0 {
        return Some(ByteRange::Unsatisfiable);
    }

    if raw_start.is_empty() {
        let suffix: u64 = raw_end.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some(ByteRange::Range {
            start: size.saturating_sub(suffix),
            end: size - 1,
        });
    }

    let start: u64 = raw_start.parse().ok()?;
    if start >= size {
        return Some(ByteRange::Unsatisfiable);
    }
    let mut end = if raw_end.is_empty() {
        size - 1
    } else {
        raw_end.parse::<u64>().ok()?
    };
    if end < start {
        return None;
    }
    if end >= size {
        end = size - 1;
    }
    Some(ByteRange::Range { start, end })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cache_control_fields() {
        let parsed = parse_cache_control(Some("public, max-age=31536000, immutable"));
        assert_eq!(parsed.max_age_seconds, Some(31_536_000));
        assert!(parsed.immutable);
        assert!(!parsed.no_store);

        let parsed = parse_cache_control(Some("private, no-store, no-cache, must-revalidate"));
        assert!(parsed.private && parsed.no_store && parsed.no_cache && parsed.must_revalidate);
        assert_eq!(parse_cache_control(None).max_age_seconds, None);
    }

    #[test]
    fn image_with_max_age_is_cacheable_but_private_is_not() {
        let base = |cc: &'static str| EvaluateInput {
            mime_type: Some("image/jpeg"),
            status_code: Some(200),
            cache_control: Some(cc),
            etag: Some("\"abc\""),
            vary: None,
            age_seconds: None,
            stored_at: 1_000,
        };
        let ok = evaluate_response_caching(base("public, max-age=60"));
        assert!(ok.cacheable);
        assert_eq!(ok.serve_class, "image");
        assert!(ok.quota_managed);
        assert_eq!(ok.fresh_until, Some(1_000 + 60_000));

        assert!(!evaluate_response_caching(base("private, max-age=60")).cacheable);
        assert!(!evaluate_response_caching(base("public, no-cache, max-age=60")).cacheable);
        let no_store = evaluate_response_caching(base("public, no-store, max-age=60"));
        assert!(!no_store.cacheable);
        assert!(!no_store.quota_managed, "no-store 不占缓存配额");
    }

    #[test]
    fn media_is_media_class_and_unknown_mime_is_none() {
        let media = evaluate_response_caching(EvaluateInput {
            mime_type: Some("video/mp4"),
            status_code: Some(200),
            cache_control: Some("public, max-age=10"),
            etag: None,
            vary: None,
            age_seconds: None,
            stored_at: 0,
        });
        assert_eq!(media.serve_class, "media");
        let other = evaluate_response_caching(EvaluateInput {
            mime_type: Some("application/javascript"),
            status_code: Some(200),
            cache_control: Some("public, max-age=10"),
            etag: None,
            vary: None,
            age_seconds: None,
            stored_at: 0,
        });
        assert_eq!(other.serve_class, "none");
        assert!(!other.cacheable);
    }

    #[test]
    fn vary_with_cookie_is_not_acceptable() {
        assert!(is_vary_acceptable(Some("accept-encoding")));
        assert!(is_vary_acceptable(None));
        assert!(!is_vary_acceptable(Some("accept-encoding, cookie")));
    }

    #[test]
    fn age_header_is_subtracted_from_freshness() {
        let freshness = evaluate_response_caching(EvaluateInput {
            mime_type: Some("image/png"),
            status_code: Some(200),
            cache_control: Some("max-age=100"),
            etag: None,
            vary: None,
            age_seconds: Some(40),
            stored_at: 5_000,
        });
        assert_eq!(freshness.fresh_until, Some(5_000 + 60_000));
    }

    #[test]
    fn parses_single_byte_range() {
        assert_eq!(
            parse_byte_range(Some("bytes=0-99"), 1_000),
            Some(ByteRange::Range { start: 0, end: 99 })
        );
        assert_eq!(
            parse_byte_range(Some("bytes=900-"), 1_000),
            Some(ByteRange::Range { start: 900, end: 999 })
        );
        assert_eq!(
            parse_byte_range(Some("bytes=-100"), 1_000),
            Some(ByteRange::Range { start: 900, end: 999 })
        );
        assert_eq!(parse_byte_range(Some("bytes=0-99,200-299"), 1_000), None);
        assert_eq!(parse_byte_range(Some("bytes=5000-5100"), 1_000), Some(ByteRange::Unsatisfiable));
        assert_eq!(parse_byte_range(Some("items=0-1"), 1_000), None);
        assert_eq!(parse_byte_range(None, 1_000), None);
    }
}
