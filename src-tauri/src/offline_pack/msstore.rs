// offline-pack 域：Microsoft Store 解析（rg-adguard 文件列表 + displaycatalog 元数据，双源合并）。
use super::http::{fetch_json_with, post_form, HttpOptions};
use regex::Regex;
use serde_json::{json, Value};

const RG_URL: &str = "https://store.rg-adguard.net/api/GetFiles";
const DISPLAY_CATALOG_URL: &str = "https://displaycatalog.mp.microsoft.com/v7.0/products";

fn is_product_id(value: &str) -> bool {
    value.len() == 12 && value.chars().all(|c| c.is_ascii_alphanumeric())
}

fn is_store_identifier(value: &str) -> bool {
    (12..=16).contains(&value.len()) && value.chars().all(|c| c.is_ascii_alphanumeric())
}

fn is_category_id(value: &str) -> bool {
    value.len() == 36
        && value.as_bytes()[8] == b'-'
        && value.as_bytes()[13] == b'-'
        && value.as_bytes()[18] == b'-'
        && value.as_bytes()[23] == b'-'
        && value.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn is_package_family_name(value: &str) -> bool {
    let Some((name, publisher)) = value.rsplit_once('_') else {
        return false;
    };
    !name.is_empty()
        && name
            .chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !publisher.is_empty()
        && publisher.chars().all(|c| c.is_ascii_alphanumeric())
}

enum RequestType {
    Url,
    ProductId,
    PackageFamilyName,
    CategoryId,
}

fn detect_request_type(query: &str) -> Option<RequestType> {
    let value = query.trim();
    if value.is_empty() {
        return None;
    }
    if value.starts_with("http://") || value.starts_with("https://") {
        return Some(RequestType::Url);
    }
    if Regex::new(r"(?:^|/)(?:apps\.microsoft\.com|microsoft\.com/\S*store)")
        .unwrap()
        .is_match(value)
    {
        return Some(RequestType::Url);
    }
    if is_category_id(value) {
        return Some(RequestType::CategoryId);
    }
    if is_package_family_name(value) {
        return Some(RequestType::PackageFamilyName);
    }
    if is_product_id(value) {
        return Some(RequestType::ProductId);
    }
    None
}

fn extract_identifier_from_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if is_store_identifier(trimmed) {
        return Some(trimmed.to_uppercase());
    }
    let parsed = url::Url::parse(trimmed).ok()?;
    for key in ["productId", "productid", "itemId", "itemid"] {
        if let Some((_, value)) = parsed.query_pairs().find(|(k, _)| k == key) {
            let value = value.to_string();
            if is_store_identifier(&value) {
                return Some(value.to_uppercase());
            }
        }
    }
    let path = parsed.path();
    let detail =
        Regex::new(r"/(?:detail|store/productid|productid)/([A-Za-z0-9]{12,16})(?:[/?#]|$)")
            .unwrap();
    detail.captures(path).map(|c| c[1].to_uppercase())
}

fn normalize_store_identifier(kind: &str, query: &str) -> Result<String, String> {
    let trimmed = query.trim();
    match kind {
        "url" => {
            if extract_identifier_from_url(trimmed).is_none() {
                return Err("无法从 URL 提取应用标识".into());
            }
            Ok(trimmed.to_string())
        }
        "ProductId" => {
            if !is_product_id(trimmed) {
                return Err("无效 ProductId（需 12 位，例如 9N0DX20HK701）".into());
            }
            Ok(trimmed.to_uppercase())
        }
        "PackageFamilyName" => {
            if !is_package_family_name(trimmed) {
                return Err("无效 PackageFamilyName".into());
            }
            Ok(trimmed.to_string())
        }
        "CategoryId" => {
            if !is_category_id(trimmed) {
                return Err("无效 CategoryId".into());
            }
            Ok(trimmed.to_lowercase())
        }
        _ => Err("query 不能为空".into()),
    }
}

fn decode_html(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn strip_html(value: &str) -> String {
    let decoded = decode_html(value);
    let tag = Regex::new(r"<[^>]+>").unwrap();
    let stripped = tag.replace_all(&decoded, " ").to_string();
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_rg_html(html: &str) -> (Option<String>, Vec<Value>) {
    let category = Regex::new(r"(?i)CategoryID:\s*</b>\s*<i>([^<]+)</i>")
        .unwrap()
        .captures(html)
        .map(|c| c[1].trim().to_string());
    let mut files = Vec::new();
    let row = Regex::new(r"(?is)<tr[^>]*>(.*?)</tr>").unwrap();
    let link = Regex::new(r#"(?i)<a href="([^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
    let cell = Regex::new(r"(?is)<td[^>]*>(.*?)</td>").unwrap();
    for row_match in row.captures_iter(html) {
        let row_html = row_match.get(1).map(|m| m.as_str()).unwrap_or_default();
        let Some(link_match) = link.captures(row_html) else {
            continue;
        };
        let cells: Vec<String> = cell
            .captures_iter(row_html)
            .map(|c| strip_html(c.get(1).map(|m| m.as_str()).unwrap_or_default()))
            .filter(|value| !value.is_empty())
            .collect();
        let expires = if cells.len() >= 4 {
            cells[1].clone()
        } else {
            String::new()
        };
        let sha1 = if cells.len() >= 4 {
            cells[cells.len() - 2].clone()
        } else if cells.len() >= 2 {
            cells[cells.len() - 1].clone()
        } else {
            String::new()
        };
        let size = if cells.len() >= 4 {
            cells[cells.len() - 1].clone()
        } else {
            String::new()
        };
        files.push(json!({
            "url": decode_html(&link_match[1]),
            "name": decode_html(&link_match[2]),
            "expires": expires,
            "sha1": sha1,
            "size": size,
        }));
    }
    (category, files)
}

pub fn resolve(query: &str) -> Result<Value, String> {
    let request_type = detect_request_type(query).ok_or(
        "无法识别输入类型，请输入 Microsoft Store 链接、ProductId（12 位）、PackageFamilyName 或 CategoryId（UUID）",
    )?;
    let type_name = match request_type {
        RequestType::Url => "url",
        RequestType::ProductId => "ProductId",
        RequestType::PackageFamilyName => "PackageFamilyName",
        RequestType::CategoryId => "CategoryId",
    };
    let identifier = normalize_store_identifier(type_name, query)?;

    // 1) rg-adguard 文件列表（失败不阻断）
    let mut files: Option<Vec<Value>> = None;
    let mut files_error: Option<String> = None;
    let mut category_id: Option<String> = None;
    let rg_type = if type_name == "CategoryId" {
        "CategoryID"
    } else {
        type_name
    };
    let html = post_form(
        RG_URL,
        &[
            ("type", rg_type),
            ("url", identifier.as_str()),
            ("ring", "RP"),
            ("lang", "en-US"),
        ],
        "解析应用",
        &[
            ("Origin", "https://store.rg-adguard.net".to_string()),
            ("Referer", "https://store.rg-adguard.net/".to_string()),
        ],
    );
    match html {
        Ok(html) => {
            let (category, parsed) = parse_rg_html(&html);
            if parsed.is_empty() {
                files_error = Some("下载接口未返回可用文件".into());
            } else {
                category_id = category;
                files = Some(parsed);
            }
        }
        Err(error) => files_error = Some(error),
    }

    // 2) Display Catalog 元数据
    let big_id = match &request_type {
        RequestType::ProductId => Some(identifier.clone()),
        RequestType::Url => extract_identifier_from_url(&identifier),
        _ => None,
    };
    let mut product: Option<Value> = None;
    if let Some(big_id) = big_id.as_ref().filter(|id| is_product_id(id)) {
        let url = format!(
            "{DISPLAY_CATALOG_URL}?bigIds={}&market=US&languages=en-us",
            big_id
        );
        let options = HttpOptions {
            headers: &[("Accept-Language", "en-us,en-us;q=0.8".to_string())],
            ..Default::default()
        };
        if let Ok(data) = fetch_json_with(&url, "解析应用", &options) {
            product = data
                .get("Products")
                .and_then(Value::as_array)
                .and_then(|list| list.first().cloned());
        }
    }

    if product.is_none() && files.as_ref().map(Vec::is_empty) != Some(false) {
        return Err(files_error.unwrap_or_else(|| "未找到对应产品，请检查 ProductId 或链接".into()));
    }

    let empty = json!({});
    let product_ref = product.as_ref().unwrap_or(&empty);
    let localized_list = product_ref
        .get("LocalizedProperties")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let localized = localized_list
        .iter()
        .find(|item| {
            item.get("Language")
                .and_then(Value::as_str)
                .map(|l| l.eq_ignore_ascii_case("en-us"))
                .unwrap_or(false)
        })
        .or(localized_list.first())
        .cloned()
        .unwrap_or_default();
    let text = |value: Option<&Value>, key: &str| -> String {
        value
            .and_then(|v| v.get(key))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };

    Ok(json!({
        "productId": text(product.as_ref(), "ProductId")
            .if_empty_then(|| big_id.clone().or_else(|| extract_identifier_from_url(&identifier)).unwrap_or_else(|| identifier.clone())),
        "title": text(Some(&localized), "ProductTitle"),
        "publisherName": text(Some(&localized), "PublisherName"),
        "description": text(Some(&localized), "ProductDescription"),
        "lastModifiedDate": product_ref.get("LastModifiedDate").cloned().unwrap_or(Value::Null),
        "packageFamilyNames": product_ref
            .pointer("/Properties/PackageFamilyNames")
            .and_then(Value::as_array)
            .map(|list| list.iter().map(|v| json!(v.to_string())).collect::<Vec<_>>())
            .unwrap_or_default(),
        "market": "US",
        "language": "en-us",
        "categoryId": category_id.unwrap_or_default(),
        "files": files.clone().unwrap_or_default(),
        "filesSource": if files.is_some() { "rg-adguard" } else { "" },
        "filesError": files_error.unwrap_or_default(),
    }))
}

trait IfEmpty {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl IfEmpty for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}
