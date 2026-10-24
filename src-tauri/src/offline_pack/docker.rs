// offline-pack 域：Docker Registry 代理（鉴权 / manifest / 层下载 / docker load TAR 打包）。
use super::downloads::{emit_progress, ensure_download_dir};
use super::http::{fetch_buffer, fetch_json_with, DownloadControl, HttpOptions};
use flate2::read::GzDecoder;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

const MANIFEST_ACCEPT: &str = "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json";
const IMAGE_MANIFEST_ACCEPT: &str = "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json";

struct RegistryConfig {
    token_url: Option<String>,
    token_service: Option<&'static str>,
    registry_base: String,
    tags_mode_hub: bool,
    hub_base: Option<&'static str>,
    path_prefix: &'static str,
}

fn registry_config(registry: &str, mirror: Option<&str>) -> RegistryConfig {
    let mirror_base = mirror
        .map(|m| {
            let trimmed = m.trim().trim_end_matches('/');
            if trimmed.is_empty() {
                String::new()
            } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                trimmed.to_string()
            } else {
                format!("https://{trimmed}")
            }
        })
        .unwrap_or_default();
    if !mirror_base.is_empty() {
        return RegistryConfig {
            token_url: None,
            token_service: None,
            registry_base: mirror_base,
            tags_mode_hub: false,
            hub_base: None,
            path_prefix: if registry == "ghcr.io" {
                "ghcr.io/"
            } else {
                ""
            },
        };
    }
    if registry == "ghcr.io" {
        return RegistryConfig {
            token_url: Some("https://ghcr.io/token".into()),
            token_service: Some("ghcr.io"),
            registry_base: "https://ghcr.io".into(),
            tags_mode_hub: false,
            hub_base: None,
            path_prefix: "",
        };
    }
    RegistryConfig {
        token_url: Some("https://auth.docker.io/token".into()),
        token_service: Some("registry.docker.io"),
        registry_base: "https://registry-1.docker.io".into(),
        tags_mode_hub: true,
        hub_base: Some("https://registry.hub.docker.com"),
        path_prefix: "",
    }
}

fn repo_path(config: &RegistryConfig, namespace: &str, repository: &str) -> String {
    format!("{}{namespace}/{repository}", config.path_prefix)
}

fn auth_headers(token: &str) -> Vec<(&'static str, String)> {
    if token.is_empty() {
        Vec::new()
    } else {
        vec![("Authorization", format!("Bearer {token}"))]
    }
}

pub fn search_images(keyword: &str) -> Result<Value, String> {
    let url = format!(
        "https://hub.docker.com/v2/search/repositories/?query={query}&page_size=5",
        query = keyword.trim().replace(' ', "+")
    );
    let data = super::http::fetch_json(&url, "搜索镜像")?;
    let mut results = Vec::new();
    if let Some(list) = data.get("results").and_then(Value::as_array) {
        for item in list {
            let Some(repo_name) = item.get("repo_name").and_then(Value::as_str) else {
                continue;
            };
            let parts: Vec<&str> = repo_name.split('/').collect();
            let (namespace, repository) = if parts.len() > 1 {
                (parts[0], parts[1])
            } else {
                ("library", parts[0])
            };
            if repository.is_empty() {
                continue;
            }
            results.push(json!({
                "namespace": namespace,
                "repository": repository,
                "shortDescription": item.get("short_description").and_then(Value::as_str).unwrap_or(""),
                "starCount": item.get("star_count").and_then(Value::as_i64).unwrap_or(0),
                "pullCount": item.get("pull_count").and_then(Value::as_f64).unwrap_or(0.0),
            }));
        }
    }
    Ok(Value::Array(results))
}

pub fn get_token(
    registry: &str,
    namespace: &str,
    repository: &str,
    mirror: Option<&str>,
) -> Result<String, String> {
    let config = registry_config(registry, mirror);
    let path = repo_path(&config, namespace, repository);
    if let Some(token_url) = &config.token_url {
        let url = format!(
            "{token_url}?service={}&scope=repository:{path}:pull",
            config.token_service.unwrap_or_default()
        );
        let data = super::http::fetch_json(&url, "获取 Docker 令牌")?;
        let token = data
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if token.is_empty() {
            return Err("Docker 认证服务未返回 token".into());
        }
        return Ok(token.to_string());
    }
    // Bearer challenge：探测 /v2/，401 时按 WWW-Authenticate 换 token（加速服务可能免鉴权）
    let response = super::http::raw_get(&format!("{}/v2/", config.registry_base))?;
    if response.0 {
        return Ok(String::new());
    }
    let challenge = response.1;
    let realm = regex::Regex::new(r#"realm="([^"]+)""#)
        .unwrap()
        .captures(&challenge)
        .map(|c| c[1].to_string());
    let Some(realm) = realm else {
        return Err("加速服务未返回认证信息，请更换加速服务".into());
    };
    let service = regex::Regex::new(r#"service="([^"]+)""#)
        .unwrap()
        .captures(&challenge)
        .map(|c| c[1].to_string());
    let mut token_url = realm;
    token_url.push(if token_url.contains('?') { '&' } else { '?' });
    if let Some(service) = service {
        token_url.push_str(&format!("service={service}&"));
    }
    token_url.push_str(&format!("scope=repository:{path}:pull"));
    let data = super::http::fetch_json(&token_url, "获取 Docker 令牌")?;
    let token = data
        .get("token")
        .or_else(|| data.get("access_token"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if token.is_empty() {
        return Err("Docker 认证服务未返回 token".into());
    }
    Ok(token.to_string())
}

fn manifest_url(
    registry: &str,
    namespace: &str,
    repository: &str,
    reference: &str,
    mirror: Option<&str>,
) -> String {
    let config = registry_config(registry, mirror);
    format!(
        "{}/v2/{}/manifests/{reference}",
        config.registry_base,
        repo_path(&config, namespace, repository)
    )
}

fn layer_url(
    registry: &str,
    namespace: &str,
    repository: &str,
    digest: &str,
    mirror: Option<&str>,
) -> String {
    let config = registry_config(registry, mirror);
    format!(
        "{}/v2/{}/blobs/{digest}",
        config.registry_base,
        repo_path(&config, namespace, repository)
    )
}

fn is_manifest_list(media_type: &str) -> bool {
    media_type == "application/vnd.docker.distribution.manifest.list.v2+json"
        || media_type == "application/vnd.oci.image.index.v1+json"
}

pub fn tag_list(
    registry: &str,
    namespace: &str,
    repository: &str,
    mirror: Option<&str>,
) -> Result<Value, String> {
    let config = registry_config(registry, mirror);
    if config.tags_mode_hub {
        let url = format!(
            "{}/v2/repositories/{namespace}/{repository}/tags?page_size=100",
            config.hub_base.unwrap_or_default()
        );
        let data = super::http::fetch_json(&url, "获取标签")?;
        let tags: Vec<Value> = data
            .get("results")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|item| {
                        item.get("name")
                            .and_then(Value::as_str)
                            .map(|name| json!(name))
                    })
                    .collect()
            })
            .unwrap_or_default();
        return Ok(Value::Array(tags));
    }
    let token = get_token(registry, namespace, repository, mirror)?;
    let url = format!(
        "{}/v2/{}/tags/list",
        config.registry_base,
        repo_path(&config, namespace, repository)
    );
    let options = HttpOptions {
        headers: &auth_headers(&token),
        ..Default::default()
    };
    let data = fetch_json_with(&url, "获取标签", &options)?;
    Ok(data.get("tags").cloned().unwrap_or(json!([])))
}

fn fetch_manifest(
    registry: &str,
    namespace: &str,
    repository: &str,
    reference: &str,
    token: &str,
    accept: &str,
    mirror: Option<&str>,
) -> Result<Value, String> {
    let options = HttpOptions {
        headers: &[
            ("Authorization", format!("Bearer {token}")),
            ("Accept", accept.to_string()),
        ],
        ..Default::default()
    };
    fetch_json_with(
        &manifest_url(registry, namespace, repository, reference, mirror),
        "获取镜像清单",
        &options,
    )
}

pub fn platforms(
    registry: &str,
    namespace: &str,
    repository: &str,
    tag: &str,
    token: &str,
    mirror: Option<&str>,
) -> Result<Value, String> {
    let data = fetch_manifest(
        registry,
        namespace,
        repository,
        tag,
        token,
        MANIFEST_ACCEPT,
        mirror,
    )?;
    let media_type = data
        .get("mediaType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !is_manifest_list(media_type) {
        return Ok(json!([]));
    }
    let mut results = Vec::new();
    if let Some(list) = data.get("manifests").and_then(Value::as_array) {
        for item in list {
            let Some(platform) = item.get("platform") else {
                continue;
            };
            let architecture = platform
                .get("architecture")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let os = platform
                .get("os")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if architecture.is_empty()
                || architecture == "unknown"
                || os.is_empty()
                || os == "unknown"
            {
                continue;
            }
            results.push(json!({
                "architecture": architecture,
                "os": os,
                "variant": platform.get("variant").cloned().unwrap_or(Value::Null),
                "digest": item.get("digest").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    Ok(Value::Array(results))
}

fn normalize_manifest(data: &Value) -> Value {
    let mut layers = Vec::new();
    if let Some(list) = data.get("layers").and_then(Value::as_array) {
        for layer in list {
            let Some(digest) = layer.get("digest").and_then(Value::as_str) else {
                continue;
            };
            layers.push(json!({
                "mediaType": layer.get("mediaType").and_then(Value::as_str).unwrap_or("application/octet-stream"),
                "size": layer.get("size").and_then(Value::as_i64).unwrap_or(0),
                "digest": digest,
            }));
        }
    }
    json!({
        "schemaVersion": data.get("schemaVersion").and_then(Value::as_i64).unwrap_or(2),
        "mediaType": data.get("mediaType").cloned().unwrap_or(Value::Null),
        "config": {
            "mediaType": data.pointer("/config/mediaType").cloned().unwrap_or(Value::Null),
            "size": data.pointer("/config/size").and_then(Value::as_i64).unwrap_or(0),
            "digest": data.pointer("/config/digest").and_then(Value::as_str).unwrap_or(""),
        },
        "layers": layers,
    })
}

pub fn manifest(
    registry: &str,
    namespace: &str,
    repository: &str,
    tag: &str,
    token: &str,
    platform: Option<&str>,
    mirror: Option<&str>,
) -> Result<Value, String> {
    let data = fetch_manifest(
        registry,
        namespace,
        repository,
        tag,
        token,
        MANIFEST_ACCEPT,
        mirror,
    )?;
    let media_type = data
        .get("mediaType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut normalized = if !is_manifest_list(media_type) {
        normalize_manifest(&data)
    } else {
        let Some(platform) = platform else {
            return Err("多架构镜像需要指定平台".into());
        };
        let mut parts = platform.split('/');
        let target_os = parts.next().unwrap_or_default();
        let target_arch = parts.next().unwrap_or_default();
        let target_variant = parts.next();

        let list = data
            .get("manifests")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let matched = list
            .iter()
            .find(|item| {
                let Some(p) = item.get("platform") else {
                    return false;
                };
                let os = p.get("os").and_then(Value::as_str).unwrap_or_default();
                let arch = p
                    .get("architecture")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let variant = p.get("variant").and_then(Value::as_str);
                if os != target_os || arch != target_arch {
                    return false;
                }
                match (target_variant, variant) {
                    (Some(target), Some(actual)) => target == actual,
                    (Some(_), None) => false,
                    (None, Some(actual)) => target_arch != "arm" || actual.is_empty(),
                    (None, None) => true,
                }
            })
            .or_else(|| {
                list.iter().find(|item| {
                    let Some(p) = item.get("platform") else {
                        return false;
                    };
                    p.get("os").and_then(Value::as_str) == Some(target_os)
                        && p.get("architecture").and_then(Value::as_str) == Some(target_arch)
                })
            });
        let Some(matched) = matched else {
            return Err(format!("未找到 {platform} 平台的镜像"));
        };
        let digest = matched
            .get("digest")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if digest.is_empty() {
            return Err(format!("未找到 {platform} 平台的镜像"));
        }
        let specific = fetch_manifest(
            registry,
            namespace,
            repository,
            digest,
            token,
            IMAGE_MANIFEST_ACCEPT,
            mirror,
        )?;
        normalize_manifest(&specific)
    };

    // config blob 提取真实版本号
    let config_digest = normalized
        .pointer("/config/digest")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if !config_digest.is_empty() {
        let headers = auth_headers(token);
        let control = DownloadControl {
            headers: &headers,
            is_cancelled: &|| false,
            on_progress: &|_, _| {},
        };
        if let Ok(blob) = fetch_buffer(
            &layer_url(registry, namespace, repository, &config_digest, mirror),
            &control,
        ) {
            if let Ok(config) = serde_json::from_slice::<Value>(&blob) {
                let version = config
                    .pointer("/config/Labels/org.opencontainers.image.version")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        config
                            .pointer("/config/Labels/version")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .or_else(|| {
                        config
                            .pointer("/config/Env")
                            .and_then(Value::as_array)
                            .and_then(|env| {
                                env.iter().find_map(|entry| {
                                    let entry = entry.as_str()?;
                                    let (key, value) = entry.split_once('=')?;
                                    if key.ends_with("_VERSION") && !value.is_empty() {
                                        Some(value.to_string())
                                    } else {
                                        None
                                    }
                                })
                            })
                    });
                if let Some(version) = version {
                    normalized["version"] = json!(version);
                }
            }
        }
    }
    Ok(normalized)
}

struct ProcessedLayer {
    data: Vec<u8>,
    diff_id: String,
    layer_id: String,
}

fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    format!("sha256:{digest:x}")
}

fn generate_image_id(image_tag: &str) -> String {
    let mut hash: i32 = 0;
    for byte in image_tag.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as i32);
    }
    format!("{:012x}", (hash as u32) as i64)
}

/// 打包 docker load 格式 TAR（512 字节 header + 八进制字段 + 校验和，与 Node 版一致）
fn pack_docker_load_tar(
    dest: &Path,
    layers: &[Value],
    processed: &[ProcessedLayer],
    namespace: &str,
    repository: &str,
    tag: &str,
    platform: Option<&str>,
) -> Result<(), String> {
    let full_name = if namespace.is_empty() {
        repository.to_string()
    } else {
        format!("{namespace}/{repository}")
    };
    let image_tag = format!("{full_name}:{tag}");
    let image_id = generate_image_id(&image_tag);
    let mut writer = TarWriter::new(dest)?;

    let manifest_entry = json!([{
        "Config": format!("{image_id}.json"),
        "RepoTags": [image_tag],
        "Layers": processed.iter().map(|l| format!("{}/layer.tar", l.layer_id)).collect::<Vec<_>>(),
    }]);
    writer.add_file(b"manifest.json", manifest_entry.to_string().as_bytes())?;

    let architecture = platform
        .map(|p| p.split('/').nth(1).unwrap_or("amd64"))
        .unwrap_or("amd64");
    let now = crate::iso_time::now_iso();
    let config_json = json!({
        "architecture": architecture,
        "config": {
            "Hostname": "", "Domainname": "", "User": "",
            "AttachStdin": false, "AttachStdout": false, "AttachStderr": false,
            "Tty": false, "OpenStdin": false, "StdinOnce": false,
            "Env": ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
            "Cmd": null, "Image": "", "Volumes": null, "WorkingDir": "",
            "Entrypoint": null, "OnBuild": null, "Labels": null,
        },
        "container_config": {
            "Hostname": "", "Domainname": "", "User": "",
            "AttachStdin": false, "AttachStdout": false, "AttachStderr": false,
            "Tty": false, "OpenStdin": false, "StdinOnce": false,
            "Env": ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
            "Cmd": ["/bin/sh", "-c", "#(nop) ADD file: in /"],
            "Image": "", "Volumes": null, "WorkingDir": "",
            "Entrypoint": null, "OnBuild": null, "Labels": {},
        },
        "created": now,
        "docker_version": "20.10.0",
        "history": layers.iter().map(|_| json!({
            "created": now,
            "created_by": "/bin/sh -c #(nop) ADD file: in /",
        })).collect::<Vec<_>>(),
        "os": "linux",
        "rootfs": { "type": "layers", "diff_ids": processed.iter().map(|l| json!(l.diff_id)).collect::<Vec<_>>() },
    });
    writer.add_file(
        format!("{image_id}.json").as_bytes(),
        config_json.to_string().as_bytes(),
    )?;

    for (index, layer) in processed.iter().enumerate() {
        writer.add_directory(format!("{}/", layer.layer_id).as_bytes())?;
        writer.add_file(format!("{}/VERSION", layer.layer_id).as_bytes(), b"1.0")?;
        let layer_json = json!({
            "id": layer.layer_id,
            "parent": if index > 0 { json!(processed[index - 1].layer_id) } else { Value::Null },
            "created": now,
            "container_config": { "Cmd": ["/bin/sh", "-c", "#(nop) ADD file: in /"] },
        });
        writer.add_file(
            format!("{}/json", layer.layer_id).as_bytes(),
            layer_json.to_string().as_bytes(),
        )?;
        writer.add_file(
            format!("{}/layer.tar", layer.layer_id).as_bytes(),
            &layer.data,
        )?;
    }
    writer.finish()
}

struct TarWriter {
    file: std::fs::File,
}

impl TarWriter {
    fn new(dest: &Path) -> Result<Self, String> {
        let file = std::fs::File::create(dest).map_err(|e| format!("创建 TAR 文件失败：{e}"))?;
        Ok(Self { file })
    }

    fn header(name: &[u8], size: u64, mode: &str, type_flag: u8) -> Vec<u8> {
        let mut header = vec![0u8; 512];
        let name_len = name.len().min(100);
        header[..name_len].copy_from_slice(&name[..name_len]);
        header[100..107].copy_from_slice(format!("{mode:0>7}").as_bytes());
        header[108..115].copy_from_slice(b"0000000");
        header[116..123].copy_from_slice(b"0000000");
        header[124..136].copy_from_slice(format!("{:0>11o}", size).as_bytes());
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        header[136..148].copy_from_slice(format!("{:0>11o}", now_secs).as_bytes());
        for byte in header[148..156].iter_mut() {
            *byte = b' ';
        }
        header[156] = type_flag;
        let checksum: u32 = header.iter().map(|b| *b as u32).sum();
        let checksum = format!("{:0>6o}\0 ", checksum);
        header[148..156].copy_from_slice(checksum.as_bytes());
        header
    }

    fn add_file(&mut self, name: &[u8], data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let header = Self::header(name, data.len() as u64, "0000644", b'0');
        self.file.write_all(&header).map_err(|e| e.to_string())?;
        self.file.write_all(data).map_err(|e| e.to_string())?;
        let padding = (512 - (data.len() % 512)) % 512;
        if padding > 0 {
            self.file
                .write_all(&vec![0u8; padding])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn add_directory(&mut self, name: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let header = Self::header(name, 0, "0000755", b'5');
        self.file.write_all(&header).map_err(|e| e.to_string())
    }

    fn finish(mut self) -> Result<(), String> {
        use std::io::Write;
        self.file
            .write_all(&[0u8; 1024])
            .map_err(|e| e.to_string())?;
        self.file.flush().map_err(|e| e.to_string())
    }
}

#[allow(clippy::too_many_arguments)]
pub fn download_docker_image(
    app: &tauri::AppHandle,
    task_id: &str,
    registry: &str,
    namespace: &str,
    repository: &str,
    tag: &str,
    platform: Option<&str>,
    mirror: Option<&str>,
    filename: &str,
) -> Result<Value, String> {
    super::downloads::register(task_id);
    let result: Result<Value, String> = (|| {
        let dir = ensure_download_dir()?;
        let final_path = dir.join(filename);
        let tmp_path = dir.join(format!("{filename}.part"));
        let token = get_token(registry, namespace, repository, mirror)?;
        let manifest_data = manifest(
            registry, namespace, repository, tag, &token, platform, mirror,
        )?;
        let layers: Vec<Value> = manifest_data
            .get("layers")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mut processed = Vec::new();
        let total_layers = layers.len();
        for (index, layer) in layers.iter().enumerate() {
            // 每层下载前刷新 token，避免大层下载期间 token 过期
            let fresh_token = get_token(registry, namespace, repository, mirror)?;
            let digest = layer
                .get("digest")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let size = layer.get("size").and_then(Value::as_i64).unwrap_or(0) as u64;
            emit_progress(
                app,
                task_id,
                "docker",
                "downloading",
                0,
                size,
                Some(format!("下载层 {}/{}", index + 1, total_layers)),
                Some((index + 1, total_layers)),
            );
            let headers = auth_headers(&fresh_token);
            let task_id_ref = task_id;
            let app_ref = app;
            let index_ref = index;
            let total_ref = total_layers;
            let control = DownloadControl {
                headers: &headers,
                is_cancelled: &|| super::downloads::is_cancelled(task_id_ref),
                on_progress: &|downloaded, total| {
                    emit_progress(
                        app_ref,
                        task_id_ref,
                        "docker",
                        "downloading",
                        downloaded,
                        total,
                        Some(format!("下载层 {}/{}", index_ref + 1, total_ref)),
                        Some((index_ref + 1, total_ref)),
                    );
                },
            };
            let blob = fetch_buffer(
                &layer_url(registry, namespace, repository, digest, mirror),
                &control,
            )?;
            let (data, diff_id) = decompress_layer(&blob)?;
            processed.push(ProcessedLayer {
                data,
                diff_id,
                layer_id: digest.trim_start_matches("sha256:")[..12].to_string(),
            });
        }

        emit_progress(
            app,
            task_id,
            "docker",
            "processing",
            0,
            0,
            Some("正在打包 docker load TAR".into()),
            None,
        );
        pack_docker_load_tar(
            &tmp_path, &layers, &processed, namespace, repository, tag, platform,
        )?;
        std::fs::rename(&tmp_path, &final_path).map_err(|e| format!("保存镜像失败：{e}"))?;

        emit_progress(
            app,
            task_id,
            "docker",
            "completed",
            0,
            0,
            Some("打包完成".into()),
            None,
        );
        let saved = final_path.to_string_lossy().to_string();
        super::history::add_history("docker", filename, &saved)?;
        Ok(json!({ "taskId": task_id, "savedPath": saved, "filename": filename }))
    })();
    super::downloads::unregister(task_id);
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            let cancelled = super::downloads::is_cancelled(task_id);
            super::downloads::emit_error(app, task_id, "docker", cancelled, &error);
            Err(error)
        }
    }
}

fn decompress_layer(raw: &[u8]) -> Result<(Vec<u8>, String), String> {
    let data = if raw.len() >= 2 && raw[0] == 0x1F && raw[1] == 0x8B {
        let mut decoder = GzDecoder::new(raw);
        let mut output = Vec::new();
        decoder
            .read_to_end(&mut output)
            .map_err(|e| format!("镜像层解压失败：{e}"))?;
        output
    } else if raw.len() >= 4 && raw[0] == 0x28 && raw[1] == 0xB5 && raw[2] == 0x2F && raw[3] == 0xFD
    {
        return Err("该镜像层使用 zstd 压缩，当前版本暂不支持。请尝试其他架构或标签。".into());
    } else {
        raw.to_vec()
    };
    let diff_id = sha256_hex(&data);
    Ok((data, diff_id))
}
