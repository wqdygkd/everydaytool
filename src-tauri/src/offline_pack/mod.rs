// offline-pack 域：命令分发（Rust 原生实现，命令名与 OFFLINE_PACK_COMMANDS 一致）。
pub mod docker;
pub mod downloads;
pub mod history;
pub mod http;
pub mod marketplaces;
pub mod msstore;

use serde_json::Value;

fn require_string(args: &[Value], index: usize, label: &str) -> Result<String, String> {
    args.get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{label}非法"))
}

fn resolve_registry(args: &[Value], index: usize) -> String {
    args.get(index)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("docker.io")
        .to_string()
}

fn resolve_mirror(args: &[Value], index: usize) -> Option<String> {
    args.get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn require_namespace(args: &[Value], index: usize) -> String {
    let value = args
        .get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if value.is_empty() {
        "library".to_string()
    } else {
        value.to_string()
    }
}

fn sanitize_filename(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| *c != '\r' && *c != '\n' && *c != '"')
        .map(|c| if c == '\\' || c == '/' { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        "download.bin".into()
    } else {
        cleaned
    }
}

pub fn handle(app: &tauri::AppHandle, command: &str, args: &[Value]) -> Result<Value, String> {
    match command {
        // ---- VSCode ----
        "offline-pack:vscode:query" => {
            let url = require_string(args, 0, "插件 URL")?;
            marketplaces::vscode_versions(&url)
        }
        "offline-pack:vscode:link" => {
            let url = require_string(args, 0, "插件 URL")?;
            let version = require_string(args, 1, "版本号")?;
            marketplaces::vscode_link(&url, &version)
        }

        // ---- Chrome ----
        "offline-pack:chrome:search" => {
            let query = require_string(args, 0, "搜索关键词")?;
            marketplaces::search_chrome(&query)
        }
        "offline-pack:chrome:detail" => {
            let id = require_string(args, 0, "扩展 ID")?;
            marketplaces::chrome_detail(&id)
        }

        // ---- Edge ----
        "offline-pack:edge:search" => {
            let query = require_string(args, 0, "搜索关键词")?;
            marketplaces::search_edge(&query)
        }
        "offline-pack:edge:detail" => {
            let query = require_string(args, 0, "输入内容")?;
            marketplaces::edge_detail(&query)
        }

        // ---- Docker ----
        "offline-pack:docker:search" => {
            let keyword = require_string(args, 0, "搜索关键词")?;
            docker::search_images(&keyword)
        }
        "offline-pack:docker:tags" => {
            let registry = resolve_registry(args, 0);
            let namespace = require_namespace(args, 1);
            let repository = require_string(args, 2, "仓库名")?;
            let mirror = resolve_mirror(args, 3);
            docker::tag_list(&registry, &namespace, &repository, mirror.as_deref())
        }
        "offline-pack:docker:platforms" => {
            let registry = resolve_registry(args, 0);
            let namespace = require_namespace(args, 1);
            let repository = require_string(args, 2, "仓库名")?;
            let tag = require_string(args, 3, "标签")?;
            let mirror = resolve_mirror(args, 4);
            let token = docker::get_token(&registry, &namespace, &repository, mirror.as_deref())?;
            docker::platforms(
                &registry,
                &namespace,
                &repository,
                &tag,
                &token,
                mirror.as_deref(),
            )
        }
        "offline-pack:docker:manifest" => {
            let registry = resolve_registry(args, 0);
            let namespace = require_namespace(args, 1);
            let repository = require_string(args, 2, "仓库名")?;
            let tag = require_string(args, 3, "标签")?;
            let platform = args
                .get(4)
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            let mirror = resolve_mirror(args, 5);
            let token = docker::get_token(&registry, &namespace, &repository, mirror.as_deref())?;
            docker::manifest(
                &registry,
                &namespace,
                &repository,
                &tag,
                &token,
                platform,
                mirror.as_deref(),
            )
        }

        // ---- MSStore ----
        "offline-pack:msstore:resolve" => {
            let query = require_string(args, 0, "输入内容")?;
            msstore::resolve(&query)
        }

        // ---- 下载 ----
        "offline-pack:download" => {
            let request = args.first().ok_or("下载参数非法")?;
            let get_string = |key: &str| -> Option<String> {
                request
                    .get(key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            let task_id = get_string("taskId").ok_or("任务 ID 非法")?;
            let filename = sanitize_filename(get_string("filename").unwrap_or_default().as_str());
            let kind = get_string("kind").unwrap_or_default();

            if kind == "docker" {
                let registry = get_string("registry").unwrap_or_else(|| "docker.io".into());
                let namespace = get_string("namespace").unwrap_or_else(|| "library".into());
                let repository = get_string("repository").ok_or("仓库名非法")?;
                let tag = get_string("tag").ok_or("标签非法")?;
                let platform = get_string("platform");
                let mirror = get_string("mirror");
                return docker::download_docker_image(
                    app,
                    &task_id,
                    &registry,
                    &namespace,
                    &repository,
                    &tag,
                    platform.as_deref(),
                    mirror.as_deref(),
                    &filename,
                );
            }

            let (url, headers): (String, Vec<(&'static str, String)>) = match kind.as_str() {
                "chrome" => (
                    marketplaces::chrome_download_url(
                        get_string("id").as_deref().ok_or("扩展 ID 非法")?,
                    ),
                    vec![("User-Agent", marketplaces::CHROME_UA.to_string())],
                ),
                "edge" => (
                    marketplaces::edge_download_url(
                        get_string("id").as_deref().ok_or("扩展 ID 非法")?,
                    ),
                    vec![("User-Agent", marketplaces::EDGE_DOWNLOAD_UA.to_string())],
                ),
                _ => (get_string("url").ok_or("下载链接非法")?, Vec::new()),
            };
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err("下载链接必须是 http(s)".into());
            }
            let convert_to_zip = request.get("convertToZip").and_then(Value::as_bool) == Some(true);
            downloads::download_simple_file(
                app,
                &task_id,
                &kind,
                &url,
                &filename,
                &headers,
                convert_to_zip,
            )
        }
        "offline-pack:download:cancel" => {
            let task_id = require_string(args, 0, "任务 ID")?;
            Ok(Value::Bool(downloads::cancel(&task_id)))
        }
        "offline-pack:open-dir" => {
            let dir = downloads::ensure_download_dir()?;
            let path = dir.to_string_lossy().to_string();
            crate::platform::handle(app, "system.openPath", &serde_json::json!({ "path": path }))?;
            Ok(Value::Bool(true))
        }

        // ---- 历史 ----
        "offline-pack:history:list" => history::list(),
        "offline-pack:history:delete" => {
            let id = require_string(args, 0, "记录 ID")?;
            let delete_file = args.get(1).and_then(Value::as_bool) == Some(true);
            history::delete(&id, delete_file)
        }
        "offline-pack:history:clear" => {
            let delete_files = args.first().and_then(Value::as_bool) == Some(true);
            history::clear(delete_files)
        }

        other => Err(format!("未实现的离线包命令：{other}")),
    }
}
