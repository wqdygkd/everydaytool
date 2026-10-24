// interceptor 域：规则引擎（v2，对齐 Node 版 rule-engine.ts）。
// 规则以 JSON Value 形态处理（存储即 JSON；字段访问用 pointer/键取值，天然容忍未知字段）。
use super::origin::normalize_host;
use regex::Regex;
use serde_json::{json, Value};

pub const RULE_DELAY_MAX_MS: i64 = 30_000;

pub struct MatchContext<'a> {
    pub method: &'a str,
    pub url: &'a str,
    pub host: &'a str,
    pub path: &'a str,
    pub resource_type: &'a str,
    pub page_url: Option<&'a str>,
    pub request_body: Option<&'a [u8]>,
    pub request_content_type: Option<&'a str>,
}

fn rule_str<'a>(rule: &'a Value, pointer: &str) -> &'a str {
    rule.pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn source_of(rule: &Value) -> (&str, &str, &str) {
    (
        rule.pointer("/source/key")
            .and_then(Value::as_str)
            .unwrap_or("url"),
        rule.pointer("/source/operator")
            .and_then(Value::as_str)
            .unwrap_or("contains"),
        rule.pointer("/source/value")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )
}

/// 用户输入驱动的正则编译（非法返回 None；缓存由调用方频度决定，本地编译开销可接受）
fn compile_regex(pattern: &str) -> Option<Regex> {
    Regex::new(pattern).ok()
}

/// 通配模式 → 正则：`*` 任意串、`?` 单字符（与 JS 版语义一致）
pub fn wildcard_to_regex(pattern: &str, with_captures: bool) -> Option<Regex> {
    let mut escaped = String::new();
    for ch in pattern.chars() {
        if matches!(
            ch,
            '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    let star = if with_captures { "(.*)" } else { ".*" };
    let pattern_text = escaped.replace('*', star).replace('?', ".");
    Regex::new(&format!("^{pattern_text}$")).ok()
}

/// 匹配源求值（规则与处理名单共用语义：key 选串，operator 决定比较方式）
pub fn match_source(
    key: &str,
    operator: &str,
    value: &str,
    url: &str,
    host: &str,
    path: &str,
) -> bool {
    let is_host_key = key == "host";
    let value_cmp = if is_host_key {
        value.to_lowercase()
    } else {
        value.to_string()
    };
    let candidate = match key {
        "url" => url.to_string(),
        "host" => host.to_lowercase(),
        _ => path.to_string(),
    };
    match operator {
        "equals" => candidate == value_cmp,
        "contains" => candidate.contains(&value_cmp),
        "matches" => compile_regex(value)
            .map(|re| re.is_match(&candidate))
            .unwrap_or(false),
        "wildcard" => wildcard_to_regex(value, false)
            .map(|re| re.is_match(&candidate))
            .unwrap_or(false),
        _ => false,
    }
}

fn stringified(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// 请求体取值：JSON 顶层键 / GraphQL variables 键 / 表单参数（找不到返回 None）
fn extract_payload_value(
    body: Option<&[u8]>,
    content_type: Option<&str>,
    key: &str,
) -> Option<String> {
    let body = body?;
    if body.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(body);
    let type_ = content_type.unwrap_or_default().to_lowercase();

    if type_.contains("json")
        || text.trim_start().starts_with('[')
        || text.trim_start().starts_with('{')
    {
        if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
            if let Some(found) = parsed.get(key) {
                return Some(stringified(found));
            }
            if let Some(found) = parsed.pointer("/variables").and_then(|v| v.get(key)) {
                return Some(stringified(found));
            }
        }
    }

    if type_.contains("form-urlencoded") {
        for pair in text.split('&') {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            if k == key {
                // URLSearchParams 以 + 表示空格
                return Some(v.replace('+', " "));
            }
        }
    }

    None
}

fn matches_filters(rule: &Value, ctx: &MatchContext) -> bool {
    let Some(filters) = rule.get("filters") else {
        return true;
    };

    if let Some(methods) = filters.get("requestMethod").and_then(Value::as_array) {
        if !methods.is_empty() {
            let method = ctx.method.to_uppercase();
            if !methods.iter().any(|item| {
                item.as_str()
                    .map(|m| m.to_uppercase() == method)
                    .unwrap_or(false)
            }) {
                return false;
            }
        }
    }

    if let Some(types) = filters.get("resourceType").and_then(Value::as_array) {
        if !types.is_empty()
            && !types
                .iter()
                .any(|item| item.as_str() == Some(ctx.resource_type))
        {
            return false;
        }
    }

    if let Some(page_filter) = filters
        .get("pageUrl")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        let page = ctx.page_url.unwrap_or_default().to_lowercase();
        if !page.contains(&page_filter.to_lowercase()) {
            return false;
        }
    }

    if let Some(payload) = filters.get("requestPayload") {
        let key = payload
            .get("key")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if key.is_empty() {
            return false;
        }
        let operator = payload
            .get("operator")
            .and_then(Value::as_str)
            .unwrap_or("equals");
        let value = payload
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(actual) = extract_payload_value(ctx.request_body, ctx.request_content_type, key)
        else {
            return false;
        };
        let matched = if operator == "equals" {
            actual == value
        } else {
            actual.contains(value)
        };
        if !matched {
            return false;
        }
    }

    true
}

/// 单条规则的匹配（不看 enabled；弹窗要连禁用的规则一起列出）
pub fn rule_matches(rule: &Value, ctx: &MatchContext) -> bool {
    let (key, operator, value) = source_of(rule);
    match_source(key, operator, value, ctx.url, ctx.host, ctx.path) && matches_filters(rule, ctx)
}

/// 命中规则集合（请求/响应/mock 共用一次匹配，避免重复求值）
pub fn find_matching_rules(rules: &[&Value], ctx: &MatchContext) -> Vec<Value> {
    rules
        .iter()
        .filter(|rule| {
            rule.get("enabled").and_then(Value::as_bool) == Some(true) && rule_matches(rule, ctx)
        })
        .map(|rule| (*rule).clone())
        .collect()
}

/// mock 短路：首个「不调服务器」的命中规则（type=response 且 mock）
pub fn find_mock_rule<'a>(matched: &[&'a Value]) -> Option<&'a Value> {
    matched.iter().copied().find(|rule| {
        rule.get("type").and_then(Value::as_str) == Some("response")
            && rule.pointer("/response/mock").and_then(Value::as_bool) == Some(true)
    })
}

/// 近似可注册域（不做完整 PSL：只覆盖常见的两段后缀）
pub fn registrable_domain(host: &str) -> String {
    let normalized = normalize_host(host);
    let parts: Vec<String> = normalized.split('.').map(|part| part.to_string()).collect();
    if parts.len() <= 2 {
        return parts.join(".");
    }
    let second = parts[parts.len() - 2].clone();
    const TWO_LEVEL: [&str; 7] = ["co", "com", "net", "org", "gov", "edu", "ac"];
    if TWO_LEVEL.contains(&second.as_str()) {
        parts[parts.len() - 3..].join(".")
    } else {
        parts[parts.len() - 2..].join(".")
    }
}

/// 规则的域约束来源
fn source_host_pattern(rule: &Value) -> Option<String> {
    let (key, operator, raw) = source_of(rule);
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if key == "host" {
        return Some(raw.to_string());
    }
    if key == "url" {
        if operator == "matches" {
            return None;
        }
        if let Some(capture) = Regex::new(r"^[a-z*]+://([^/?#]+)").unwrap().captures(raw) {
            return Some(capture[1].to_string());
        }
        if !raw.contains('/')
            && raw
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '*' | ':' | '-' | '_'))
            && raw.contains('.')
        {
            return Some(raw.to_string());
        }
    }
    None
}

fn host_matches_pattern(pattern: &str, host: &str, operator: &str) -> bool {
    let value = Regex::new(r":\d+$")
        .unwrap()
        .replace(pattern, "")
        .to_lowercase();
    if value.is_empty() || value == "*" {
        return true;
    }
    if operator == "matches" {
        return compile_regex(&value)
            .map(|re| re.is_match(host))
            .unwrap_or(false);
    }
    if let Some(base) = value.strip_prefix("*.") {
        if host == base || host.ends_with(&format!(".{base}")) {
            return true;
        }
    }
    if value.contains('*') || value.contains('?') {
        let matches_wildcard = wildcard_to_regex(&value, false)
            .map(|re| re.is_match(host))
            .unwrap_or(false);
        if matches_wildcard {
            return true;
        }
    }
    if operator == "contains" && host.contains(&value) {
        return true;
    }
    if value == host || host.ends_with(&format!(".{value}")) || value.ends_with(&format!(".{host}"))
    {
        return true;
    }
    registrable_domain(host) == registrable_domain(&value)
}

/// 该站点能否用上这条规则：global / site / null（不适用）
pub fn rule_applies_to_host(rule: &Value, host: &str) -> Option<&'static str> {
    let normalized = normalize_host(host);

    let page_filter = rule
        .pointer("/filters/pageUrl")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    if !page_filter.is_empty() {
        let domain = registrable_domain(&normalized);
        if !page_filter.contains(&normalized) && !page_filter.contains(&domain) {
            return None;
        }
    }

    let Some(pattern) = source_host_pattern(rule) else {
        return Some("global");
    };
    if pattern
        .chars()
        .all(|c| c.is_whitespace() || c == '*' || c == '?' || c == ':')
    {
        return Some("global");
    }
    let (operator, _, _) = source_of(rule);
    host_matches_pattern(&pattern, &normalized, operator).then_some("site")
}

fn find_header_key(headers: &mut Value, name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    headers
        .as_object_mut()?
        .keys()
        .find(|key| key.to_lowercase() == lower)
        .cloned()
}

fn set_header_value(headers: &mut Value, name: &str, value: &str) {
    if let Some(existing) = find_header_key(headers, name) {
        headers[&existing] = json_str(value);
    } else {
        headers[name] = json_str(value);
    }
}

fn json_str(value: &str) -> Value {
    Value::String(value.to_string())
}

/// 请求头操作（add 拼接 / remove 删除 / override 覆盖）
pub fn apply_header_operations(headers: &mut Value, operations: Option<&Value>) {
    let Some(operations) = operations.and_then(Value::as_array) else {
        return;
    };
    for operation in operations {
        let Some(name) = operation.get("name").and_then(Value::as_str) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let value = operation
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let existing = find_header_key(headers, name);
        match operation
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("override")
        {
            "add" => match existing {
                Some(key) => {
                    let combined =
                        format!("{}, {}", headers[&key].as_str().unwrap_or_default(), value);
                    headers[&key] = json_str(&combined);
                }
                None => {
                    headers[name] = json_str(value);
                }
            },
            "remove" => {
                if let Some(key) = existing {
                    if let Some(map) = headers.as_object_mut() {
                        map.remove(&key);
                    }
                }
            }
            _ => {
                if let Some(key) = existing {
                    headers[&key] = json_str(value);
                } else {
                    headers[name] = json_str(value);
                }
            }
        }
    }
}

/// 计算重定向目标：支持正则 / 通配捕获组 `$1` 替换与查询串保留
fn compute_redirect_location(rule: &Value, url: &str, host: &str, path: &str) -> Option<String> {
    let destination = rule
        .pointer("/redirect/destination")
        .and_then(Value::as_str)?;
    let mut location = destination.to_string();

    if Regex::new(r"\$[1-9]").unwrap().is_match(&location) {
        let (key, operator, value) = source_of(rule);
        let candidate = match key {
            "url" => url,
            "host" => host,
            _ => path,
        };
        let regex = match operator {
            "matches" => compile_regex(value),
            "wildcard" => wildcard_to_regex(value, true),
            _ => None,
        };
        let capture = regex.and_then(|re| re.captures(candidate));
        let captured_groups: Vec<Option<String>> = capture
            .as_ref()
            .map(|caps| {
                (1..caps.len())
                    .map(|index| caps.get(index).map(|m| m.as_str().to_string()))
                    .collect()
            })
            .unwrap_or_default();
        location = Regex::new(r"\$(\d)")
            .unwrap()
            .replace_all(&location, |caps: &regex::Captures| {
                caps[1]
                    .parse::<usize>()
                    .ok()
                    .and_then(|index| captured_groups.get(index.saturating_sub(1)).cloned())
                    .flatten()
                    .unwrap_or_default()
            })
            .to_string();
    }

    if rule
        .pointer("/redirect/preserveQueryParams")
        .and_then(Value::as_bool)
        == Some(true)
    {
        if let Some(query) = url::Url::parse(url).ok().and_then(|parsed| {
            (!parsed.query().unwrap_or_default().is_empty())
                .then_some(format!("?{}", parsed.query().unwrap_or_default()))
        }) {
            if !location.contains('?') {
                location.push_str(&query);
            }
        }
    }

    (location.starts_with("http://") || location.starts_with("https://")).then_some(location)
}

fn clamp_delay(ms: f64) -> i64 {
    if !ms.is_finite() || ms <= 0.0 {
        return 0;
    }
    (ms.trunc() as i64).min(RULE_DELAY_MAX_MS)
}

fn apply_query_modifications(url: &mut url::Url, modifications: &Value) {
    let Some(list) = modifications.as_array() else {
        return;
    };
    for modification in list {
        let action = modification
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let param = modification
            .get("param")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if action != "removeAll" && param.is_empty() {
            continue;
        }
        let value = modification
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match action {
            "add" => {
                if url.query_pairs().any(|(key, _)| key == param) {
                    if modification
                        .get("actionWhenParamExists")
                        .and_then(Value::as_str)
                        .unwrap_or("overwrite")
                        == "overwrite"
                    {
                        let existing_pairs: Vec<(String, String)> = url
                            .query_pairs()
                            .map(|(key, value)| (key.to_string(), value.to_string()))
                            .collect();
                        url.query_pairs_mut().clear();
                        for (key, existing) in existing_pairs {
                            url.query_pairs_mut().append_pair(&key, &existing);
                        }
                        url.query_pairs_mut().append_pair(param, value);
                    }
                } else {
                    url.query_pairs_mut().append_pair(param, value);
                }
            }
            "remove" => {
                let filtered = url
                    .query_pairs()
                    .filter(|(key, _)| key != param)
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("&");
                url.set_query(if filtered.is_empty() {
                    None
                } else {
                    Some(&filtered)
                });
            }
            "removeAll" => url.set_query(None),
            _ => {}
        }
    }
}

pub struct RequestPlan {
    pub cancel: bool,
    pub redirected_to: Option<String>,
    pub redirect_status_code: u16,
    pub url: String,
    pub rewritten: bool,
    pub delay_ms: i64,
    pub request_headers: Vec<Value>,
    pub user_agent: Option<String>,
    pub body_replace: Option<String>,
    pub body_script: Option<String>,
}

/// 请求执行计划（按规则顺序叠加）：cancel / redirect 短路 URL 改写
pub fn plan_request(matched_rules: &[&Value], current_url: &str) -> RequestPlan {
    let mut url = url::Url::parse(current_url)
        .unwrap_or_else(|_| url::Url::parse("http://invalid.invalid/").unwrap());
    let mut rewritten = false;
    let mut cancel = false;
    let mut redirected_to: Option<String> = None;
    let mut redirect_status_code: u16 = 302;
    let mut delay_ms: i64 = 0;
    let mut request_headers: Vec<Value> = Vec::new();
    let mut user_agent: Option<String> = None;
    let mut body_replace: Option<String> = None;
    let mut body_script: Option<String> = None;

    for rule in matched_rules {
        let shaping_blocked = cancel || redirected_to.is_some();
        match rule.get("type").and_then(Value::as_str).unwrap_or_default() {
            "cancel" => cancel = true,
            "redirect" => {
                if !shaping_blocked && rule.get("redirect").is_some() {
                    if let Some(location) = compute_redirect_location(
                        rule,
                        url.as_ref(),
                        url.host_str().unwrap_or_default(),
                        url.path(),
                    ) {
                        redirected_to = Some(location);
                        redirect_status_code = rule
                            .pointer("/redirect/statusCode")
                            .and_then(Value::as_u64)
                            .unwrap_or(302) as u16;
                    }
                }
            }
            "replace" => {
                if !shaping_blocked {
                    if let Some(from) = rule.pointer("/replace/from").and_then(Value::as_str) {
                        if !from.is_empty() {
                            let to = rule
                                .pointer("/replace/to")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let next = if let Ok(regex) = Regex::new(from) {
                                regex.replace(url.as_ref(), to).to_string()
                            } else {
                                url.to_string()
                            };
                            if let Ok(next_url) = url::Url::parse(&next) {
                                url = next_url;
                                rewritten = true;
                            }
                        }
                    }
                }
            }
            "queryParam" => {
                if !shaping_blocked {
                    if let Some(modifications) = rule.pointer("/queryParam/modifications") {
                        if modifications
                            .as_array()
                            .map(|list| !list.is_empty())
                            .unwrap_or(false)
                        {
                            apply_query_modifications(&mut url, modifications);
                            rewritten = true;
                        }
                    }
                }
            }
            "delay" => {
                if let Some(delay) = rule.pointer("/delay/delayMs").and_then(Value::as_f64) {
                    delay_ms = clamp_delay(delay);
                }
            }
            "headers" => {
                if let Some(request_ops) = rule.pointer("/headers/request") {
                    // 收集为待应用操作；实际改写在请求转发处执行
                    if let Some(list) = request_ops.as_array() {
                        request_headers.extend(list.iter().cloned());
                    }
                }
            }
            "userAgent" => {
                if let Some(ua) = rule.pointer("/userAgent/userAgent").and_then(Value::as_str) {
                    if !ua.is_empty() {
                        user_agent = Some(ua.to_string());
                    }
                }
            }
            "request" => {
                let mode = rule
                    .pointer("/request/type")
                    .and_then(Value::as_str)
                    .unwrap_or("static");
                let value = rule
                    .pointer("/request/value")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let legacy = rule
                    .pointer("/request/bodyReplace")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if mode == "code" {
                    if let Some(code) = value.filter(|s| !s.is_empty()) {
                        body_script = Some(code);
                        body_replace = None;
                    }
                } else if let Some(value) = value.or(legacy) {
                    body_replace = Some(value);
                    body_script = None;
                }
            }
            _ => {}
        }
    }

    if cancel {
        redirected_to = None;
    }
    RequestPlan {
        cancel,
        redirected_to,
        redirect_status_code,
        url: url.to_string(),
        rewritten,
        delay_ms,
        request_headers,
        user_agent,
        body_replace,
        body_script,
    }
}

/// 响应侧变更：headers 类型规则的响应头操作 + response 类型规则的状态码 / 文案 / 改体
pub struct ResponseMutation {
    pub status_code: u16,
    pub status_text: Option<String>,
    pub body: Option<Vec<u8>>,
}

pub fn apply_response_mutations(
    matched_rules: &[&Value],
    status_code: u16,
    headers: &mut Value,
    body: Option<Vec<u8>>,
) -> ResponseMutation {
    let mut next_status = status_code;
    let mut next_status_text: Option<String> = None;
    let mut next_body = body;

    for rule in matched_rules {
        if rule.get("type").and_then(Value::as_str) == Some("headers") {
            apply_header_operations(headers, rule.pointer("/headers/response"));
        }
        if rule.get("type").and_then(Value::as_str) != Some("response") {
            continue;
        }
        if let Some(configured) = rule.pointer("/response/statusCode").and_then(Value::as_u64) {
            next_status = configured as u16;
        }
        if let Some(text) = rule.pointer("/response/statusText").and_then(Value::as_str) {
            next_status_text = Some(text.to_string());
        }
        if let Some(replace) = rule
            .pointer("/response/bodyReplace")
            .and_then(Value::as_str)
        {
            let replaced = replace.as_bytes().to_vec();
            if let Some(key) = find_header_key(headers, "content-length") {
                headers[&key] = json!(replaced.len().to_string());
            }
            if let Some(key) = find_header_key(headers, "content-encoding") {
                if let Some(map) = headers.as_object_mut() {
                    map.remove(&key);
                }
            }
            next_body = Some(replaced);
        }
    }

    ResponseMutation {
        status_code: next_status,
        status_text: next_status_text,
        body: next_body,
    }
}
