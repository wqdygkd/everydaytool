// offline-pack 域：Chrome Web Store / Edge Add-ons / VSCode Marketplace 代理。
use super::http::{fetch_json_with, fetch_text_with, post_json, HttpOptions};
use regex::Regex;
use serde_json::{json, Value};

pub const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CHROME_LANG: &str = "zh-CN,zh;q=0.9,en;q=0.8";
pub const EDGE_DOWNLOAD_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

fn chrome_headers() -> Vec<(&'static str, String)> {
    vec![
        ("Accept-Language", CHROME_LANG.to_string()),
        ("User-Agent", CHROME_UA.to_string()),
    ]
}

// ---- Chrome ----

pub fn search_chrome(query: &str) -> Result<Value, String> {
    let url = format!(
        "https://chromewebstore.google.com/search/{}",
        urlencode(query)
    );
    let options = HttpOptions {
        headers: &chrome_headers(),
        ..Default::default()
    };
    let html = fetch_text_with(&url, "搜索 Chrome 扩展", &options)?;
    let entry = Regex::new(r"detail/([^/]+)/([a-z]{32})").unwrap();
    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();
    for capture in entry.captures_iter(&html) {
        let slug = capture[1].to_string();
        let id = capture[2].to_string();
        if !seen.insert(id.clone()) {
            continue;
        }
        let name = slug
            .split('-')
            .map(|word| {
                let mut chars = word.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        results.push(json!({ "id": id, "name": name }));
        if results.len() >= 10 {
            break;
        }
    }
    Ok(Value::Array(results))
}

pub fn chrome_detail(id: &str) -> Result<Value, String> {
    let url = format!("https://chromewebstore.google.com/detail/{id}");
    let options = HttpOptions {
        headers: &chrome_headers(),
        ..Default::default()
    };
    let html = fetch_text_with(&url, "获取扩展信息", &options)?;
    let title = Regex::new(r"<title>([^<]*)</title>")
        .unwrap()
        .captures(&html)
        .map(|c| c[1].trim().to_string());
    let name = title.map(|t| {
        let cleaned = Regex::new(r"\s*[-–—]\s*Chrome.*$")
            .unwrap()
            .replace(&t, "")
            .trim()
            .to_string();
        if cleaned.is_empty() {
            Value::Null
        } else {
            json!(cleaned)
        }
    });
    let description = Regex::new(r#"meta\s+name="description"\s+content="([^"]*)""#)
        .unwrap()
        .captures(&html)
        .map(|c| json!(c[1].trim()))
        .unwrap_or(Value::Null);
    Ok(json!({
        "id": id,
        "name": name.unwrap_or(Value::Null),
        "description": description,
    }))
}

pub fn chrome_download_url(id: &str) -> String {
    let version = Regex::new(r"Chrome/([\d.]+)")
        .unwrap()
        .captures(CHROME_UA)
        .map(|c| c[1].to_string())
        .unwrap_or_else(|| "131.0.0.0".into());
    format!(
        "https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x64&os_arch=x86_64&nacl_arch=x86-64&prod=chromecrx&prodchannel=stable&prodversion={version}&lang=zh-CN&acceptformat=crx2%2Ccrx3&x=id%3D{id}%26installsource%3Dondemand%26uc%3D"
    )
}

// ---- Edge ----

fn edge_headers() -> Vec<(&'static str, String)> {
    vec![
        ("Accept", "application/json".to_string()),
        ("Accept-Language", "en-US,en;q=0.9".to_string()),
    ]
}

pub fn search_edge(query: &str) -> Result<Value, String> {
    let url = format!(
        "https://microsoftedge.microsoft.com/addons/v4/getfilteredorderedsearch?hl=en-US&gl=US&Query={query}&pgNo=1&filteredCategories=Edge-Extensions&filteredAddon=1&filterFeaturedAddons=false&filteredRating=0&sortBy=Relevance",
        query = urlencode(query)
    );
    let options = HttpOptions {
        headers: &edge_headers(),
        ..Default::default()
    };
    let data = fetch_json_with(&url, "搜索 Edge 扩展", &options)?;
    let mut results = Vec::new();
    if let Some(list) = data.get("extensionList").and_then(Value::as_array) {
        for item in list {
            let Some(crx_id) = item.get("crxId").and_then(Value::as_str) else {
                continue;
            };
            let Some(name) = item.get("name").and_then(Value::as_str) else {
                continue;
            };
            results.push(json!({
                "id": crx_id,
                "storeProductId": item.get("storeProductId").cloned().unwrap_or(Value::Null),
                "name": name,
                "developer": item.get("developerName").cloned().unwrap_or(Value::Null),
                "description": item.get("shortDescription").cloned().unwrap_or(Value::Null),
                "iconUrl": item.get("logoUrl").cloned().unwrap_or(Value::Null),
            }));
            if results.len() >= 10 {
                break;
            }
        }
    }
    Ok(Value::Array(results))
}

enum EdgeInput {
    CrxId(String),
    StoreProductId(String),
}

fn parse_edge_query(query: &str) -> Option<EdgeInput> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_lowercase();
    if lower.len() == 32 && lower.chars().all(|c| c.is_ascii_lowercase()) {
        return Some(EdgeInput::CrxId(lower));
    }
    if trimmed.len() == 12 && trimmed.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Some(EdgeInput::StoreProductId(trimmed.to_uppercase()));
    }
    let parsed = url::Url::parse(trimmed)
        .or_else(|_| url::Url::parse(&format!("https://{trimmed}")))
        .ok()?;
    let href = parsed.to_string().to_lowercase();
    let crx = Regex::new(r"([a-z]{32})").unwrap();
    if let Some(capture) = crx.captures(&href) {
        return Some(EdgeInput::CrxId(capture[1].to_string()));
    }
    for key in ["productId", "productid", "itemId", "itemid"] {
        if let Some(value) = parsed.query_pairs().find(|(k, _)| k == key) {
            let value = value.1.to_string();
            if value.len() == 12 && value.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Some(EdgeInput::StoreProductId(value.to_uppercase()));
            }
        }
    }
    None
}

fn normalize_asset_url(url: Option<&str>) -> Value {
    match url {
        Some(url) if url.starts_with("//") => json!(format!("https:{url}")),
        Some(url) => json!(url),
        None => Value::Null,
    }
}

pub fn edge_detail(query: &str) -> Result<Value, String> {
    let parsed = match parse_edge_query(query) {
        Some(parsed) => parsed,
        None => return Err("无效的 Edge 扩展 ID、ProductId 或商店链接".into()),
    };
    let (base, fallback_id) = match &parsed {
        EdgeInput::CrxId(id) => (
            format!("https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/{id}"),
            id.clone(),
        ),
        EdgeInput::StoreProductId(id) => (
            format!("https://microsoftedge.microsoft.com/addons/getproductdetails/{id}"),
            String::new(),
        ),
    };
    let url = format!("{base}?hl=en-US&gl=US");
    let options = HttpOptions {
        headers: &edge_headers(),
        ..Default::default()
    };
    let data = fetch_json_with(&url, "获取扩展信息", &options)?;

    let string_field = |key: &str| -> Value {
        data.get(key)
            .and_then(Value::as_str)
            .map(|v| json!(v.trim()))
            .unwrap_or(Value::Null)
    };
    let id = data
        .get("crxId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or(fallback_id);
    Ok(json!({
        "id": id,
        "storeProductId": data.get("storeProductId").cloned().unwrap_or(Value::Null),
        "name": data.get("name").cloned().unwrap_or(Value::Null),
        "version": data.get("version").cloned().unwrap_or(Value::Null),
        "developer": data.get("developer").cloned().unwrap_or(Value::Null),
        "category": data.get("category").cloned().unwrap_or(Value::Null),
        "description": string_field("description"),
        "shortDescription": string_field("shortDescription"),
        "rating": data.get("averageRating").cloned().unwrap_or(Value::Null),
        "ratingCount": data.get("ratingCount").cloned().unwrap_or(Value::Null),
        "activeInstallCount": data.get("activeInstallCount").cloned().unwrap_or(Value::Null),
        "iconUrl": normalize_asset_url(data.get("logoUrl").and_then(Value::as_str)),
        "isFeatured": data.get("isBadgedAsFeatured").cloned().unwrap_or(Value::Null),
    }))
}

pub fn edge_download_url(id: &str) -> String {
    format!(
        "https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D{id}%26installsource%3Dondemand%26uc%3D"
    )
}

// ---- VSCode ----

fn extract_vscode_info(url: &str) -> Result<(String, String), String> {
    let parsed = url::Url::parse(url).map_err(|_| "无效的插件 URL，示例：https://marketplace.visualstudio.com/items?itemName=ms-python.python".to_string())?;
    let Some(item) = parsed
        .query_pairs()
        .find(|(key, _)| key == "itemName")
        .map(|(_, value)| value.to_string())
    else {
        return Err("无效的插件 URL，示例：https://marketplace.visualstudio.com/items?itemName=ms-python.python".into());
    };
    let Some(dot) = item.rfind('.') else {
        return Err("无效的插件 ID 格式，应为 publisher.extension".into());
    };
    Ok((item[..dot].to_string(), item[dot + 1..].to_string()))
}

pub fn vscode_versions(url: &str) -> Result<Value, String> {
    let (publisher, extension) = extract_vscode_info(url)?;
    let payload = json!({
        "filters": [{
            "criteria": [{ "filterType": 7, "value": format!("{publisher}.{extension}") }],
            "pageNumber": 1,
            "pageSize": 1,
            "sortBy": 0,
            "sortOrder": 0,
        }],
        "flags": 1,
    });
    let data = post_json(
        "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
        &payload,
        "查询插件版本",
        &[(
            "Accept",
            "application/json;api-version=3.0-preview.1".to_string(),
        )],
    )?;
    let mut versions: Vec<String> = Vec::new();
    if let Some(list) = data
        .pointer("/results/0/extensions/0/versions")
        .and_then(Value::as_array)
    {
        for item in list {
            let Some(version) = item.get("version").and_then(Value::as_str) else {
                continue;
            };
            if !versions.iter().any(|v| v == version) {
                versions.push(version.to_string());
            }
        }
    }
    if versions.is_empty() {
        return Err("未找到该插件，请检查 URL 是否正确".into());
    }
    versions.truncate(20);
    Ok(json!({ "versions": versions }))
}

pub fn vscode_link(url: &str, version: &str) -> Result<Value, String> {
    let (publisher, extension) = extract_vscode_info(url)?;
    Ok(json!({
        "downloadUrl": format!("https://marketplace.visualstudio.com/_apis/public/gallery/publishers/{publisher}/vsextensions/{extension}/{version}/vspackage"),
    }))
}

fn urlencode(input: &str) -> String {
    let mut output = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char)
            }
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}
