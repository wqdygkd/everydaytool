// interceptor 域：动态脚本规则 → InjectedScript 编译（对齐 Node 版 script-compile.ts）。
use super::rule_engine::wildcard_to_regex;
use serde_json::{json, Value};

const ALL_PAGES_MATCH: &str = "*://*/*";

/// 形状合法的 chrome match pattern（scheme://…/…）才直接用作注册范围，否则退回全站 + 守卫
fn as_match_pattern(value: &str) -> Option<String> {
    let regex = regex::Regex::new(r"^(?:\*|https?|file|ftp)://(\S*)$").unwrap();
    let capture = regex.captures(value)?;
    let rest = &capture[1];
    rest.contains('/').then(|| value.to_string())
}

fn compute_matches(source: &Value) -> Vec<String> {
    let key = source.get("key").and_then(Value::as_str).unwrap_or("url");
    let operator = source
        .get("operator")
        .and_then(Value::as_str)
        .unwrap_or("contains");
    let value = source
        .get("value")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if value.is_empty() {
        return vec![ALL_PAGES_MATCH.to_string()];
    }
    if operator == "wildcard" {
        if let Some(pattern) = as_match_pattern(value) {
            return vec![pattern];
        }
    }
    if key == "host" && operator == "equals" {
        return vec![format!("*://{}/*", value.to_lowercase())];
    }
    vec![ALL_PAGES_MATCH.to_string()]
}

/// 生成守卫表达式（对页面 location 复刻 source 匹配语义）；留空返回 None（不守卫）
fn build_guard(source: &Value) -> Option<String> {
    let key = source.get("key").and_then(Value::as_str).unwrap_or("url");
    let operator = source
        .get("operator")
        .and_then(Value::as_str)
        .unwrap_or("contains");
    let value = source
        .get("value")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if value.is_empty() {
        return None;
    }
    let is_host = key == "host";
    let target = match key {
        "url" => "location.href",
        "host" => "location.hostname.toLowerCase()",
        _ => "location.pathname",
    };
    let compared = if is_host {
        value.to_lowercase()
    } else {
        value.to_string()
    };
    let literal = serde_json::json!(compared).to_string();
    match operator {
        "equals" => Some(format!("{target} === {literal}")),
        "contains" => Some(format!("{target}.includes({literal})")),
        "matches" => Some(format!("__edtMatch({literal}, {target})")),
        "wildcard" => {
            let regex_source = wildcard_to_regex(value, false)
                .map(|re| re.as_str().to_string())
                .unwrap_or_default();
            Some(format!(
                "__edtMatch({}, {target})",
                serde_json::json!(regex_source)
            ))
        }
        _ => None,
    }
}

fn wrap_with_guard(source: &Value, code: &str) -> String {
    let Some(condition) = build_guard(source) else {
        return code.to_string();
    };
    let guard = [
        "(() => {",
        "  const __edtMatch = (pattern, target) => {",
        "    try {",
        "      return new RegExp(pattern).test(target)",
        "    } catch (e) {",
        "      return false",
        "    }",
        "  }",
        &format!("  if (!({condition})) return"),
    ];
    let mut wrapped: Vec<String> = guard.iter().map(|s| s.to_string()).collect();
    wrapped.push(code.to_string());
    wrapped.push("})()".to_string());
    wrapped.join("\n")
}

/// 脚本规则（启用与禁用都下发，扩展按 enabled 过滤注册）→ 扩展用 InjectedScript 列表
pub fn compile_script_rules(rules: &[Value]) -> Vec<Value> {
    rules
        .iter()
        .filter(|rule| {
            rule.get("type").and_then(Value::as_str) == Some("script")
                && !rule
                    .pointer("/script/code")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
        })
        .map(|rule| {
            let source = rule.get("source").cloned().unwrap_or(json!({}));
            json!({
                "id": rule.get("id").cloned().unwrap_or(Value::Null),
                "name": rule.get("name").cloned().unwrap_or(Value::Null),
                "enabled": rule.get("enabled").and_then(Value::as_bool) == Some(true),
                "matches": compute_matches(&source),
                "world": rule.pointer("/script/world").cloned().unwrap_or(json!("MAIN")),
                "runAt": rule.pointer("/script/runAt").cloned().unwrap_or(json!("document_start")),
                "code": wrap_with_guard(
                    &source,
                    rule.pointer("/script/code").and_then(Value::as_str).unwrap_or_default(),
                ),
                "updatedAt": rule.get("updatedAt").cloned().unwrap_or(Value::Null),
            })
        })
        .collect()
}
