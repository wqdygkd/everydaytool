// telegram-cache 域：M3-B MTProto 消息媒体下载（客户端用 grammers，Rust 原生）。
//
// 硬约束（与 Electron 版一致）：
// - 凭据只从 .env / 环境变量读（TG_API_ID / TG_API_HASH），**不落盘、不进诊断包**；
// - 会话文件加密落盘（session_store：Windows DPAPI / Unix 0600）；
// - 只下载**单条消息**的媒体；相册 / 批量不做；
// - 下载走内容寻址提交 + 归档副本 + `message.json`（正文 + 媒体清单）。
use super::types::*;
use super::session_store;
use super::store;
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

/// 上游消息链接解析结果（t.me / tg://，拒绝邀请链接）
#[derive(Debug, Clone, PartialEq)]
pub enum MessageLink {
    Public { username: String, message_id: i64 },
    Private { channel_id: i64, message_id: i64 },
}

pub fn parse_message_link(raw: &str) -> Result<MessageLink, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("消息链接为空".into());
    }
    let lower = trimmed.to_lowercase();
    // 邀请链接 / 加入频道的链接一律拒绝：它们不是「单条消息」
    if lower.contains("t.me/+") || lower.contains("t.me/joinchat/") || lower.contains("tg://join") {
        return Err("不支持邀请链接（只接受单条消息链接）".into());
    }

    let normalized = if let Some(rest) = lower.strip_prefix("tg://resolve/?domain=") {
        format!("https://t.me/{rest}")
    } else if let Some(rest) = lower.strip_prefix("https://t.me/") {
        format!("https://t.me/{rest}")
    } else if let Some(rest) = lower.strip_prefix("t.me/") {
        format!("https://t.me/{rest}")
    } else if let Some(rest) = lower.strip_prefix("https://telegram.me/") {
        format!("https://t.me/{rest}")
    } else {
        return Err("无法识别的消息链接（支持 t.me/<频道>/<消息号> 与 tg://resolve）".into());
    };

    let path = normalized
        .strip_prefix("https://t.me/")
        .ok_or("无法识别的消息链接")?;
    let mut parts = path.split(['?', '#']).next().unwrap_or("").split('/');
    let first = parts.next().unwrap_or("").trim();
    let second = parts.next().unwrap_or("").trim();

    // 私有频道形式 t.me/c/<内部ID>/<消息号>
    if first == "c" {
        let channel_id = second.parse::<i64>().map_err(|_| "私有频道 ID 非法")?;
        let message_id = parts
            .next()
            .unwrap_or("")
            .trim()
            .parse::<i64>()
            .map_err(|_| "私有频道消息号非法")?;
        if message_id <= 0 {
            return Err("消息号必须为正整数".into());
        }
        return Ok(MessageLink::Private {
            channel_id,
            message_id,
        });
    }

    let username = first
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect::<String>();
    if username.is_empty() || username != first {
        return Err("频道用户名非法".into());
    }
    let message_id: i64 = second
        .trim()
        .parse()
        .map_err(|_| "消息号非法（链接需形如 t.me/<频道>/<消息号>）")?;
    if message_id <= 0 {
        return Err("消息号必须为正整数".into());
    }
    Ok(MessageLink::Public {
        username,
        message_id,
    })
}

#[derive(Default)]
pub struct MtprotoRuntime {
    pub active: Option<MtprotoTask>,
    pub last_task: Option<MtprotoTask>,
    pub cancel: Option<Arc<AtomicBool>>,
    pub error: Option<String>,
}

static ENV_CACHE: LazyLock<Mutex<Option<(Option<i32>, Option<String>)>>> =
    LazyLock::new(|| Mutex::new(None));

/// 凭据来源：进程环境变量优先，其次数据目录下的 `.env`（键值行）
fn credentials() -> (Option<i32>, Option<String>) {
    if let Some(cached) = ENV_CACHE.lock().ok().and_then(|cache| cache.clone()) {
        return cached;
    }
    let mut api_id = std::env::var("TG_API_ID").ok().and_then(|value| value.trim().parse::<i32>().ok());
    let mut api_hash = std::env::var("TG_API_HASH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if api_id.is_none() || api_hash.is_none() {
        let env_path = crate::appearance::resolve_data_dir().join("telegram-cache").join(".env");
        if let Ok(raw) = std::fs::read_to_string(&env_path) {
            for line in raw.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let Some((key, value)) = line.split_once('=') else {
                    continue;
                };
                let value = value.trim().trim_matches('"');
                match key.trim() {
                    "TG_API_ID" | "API_ID" => {
                        api_id = api_id.or_else(|| value.parse::<i32>().ok());
                    }
                    "TG_API_HASH" | "API_HASH" => {
                        if api_hash.is_none() && !value.is_empty() {
                            api_hash = Some(value.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let result = (api_id, api_hash);
    if let Ok(mut cache) = ENV_CACHE.lock() {
        *cache = Some(result.clone());
    }
    result
}

pub fn status() -> MtprotoStatus {
    let (api_id, api_hash) = credentials();
    let mut missing = Vec::new();
    if api_id.is_none() {
        missing.push("TG_API_ID".to_string());
    }
    if api_hash.is_none() {
        missing.push("TG_API_HASH".to_string());
    }
    let session_path = store::session_file();
    let has_session = session_store::has_session(&session_path);
    let state = super::lock();
    MtprotoStatus {
        configured: missing.is_empty(),
        has_session,
        connected: has_session && missing.is_empty(),
        account: state.mtproto.active.as_ref().and_then(|_| None),
        missing,
        lib_version: Some(format!("grammers-client {}", GRAMMERS_VERSION)),
        session_source: if has_session {
            "secure".to_string()
        } else {
            "none".to_string()
        },
        encryption_available: session_store::encryption_available(),
        error: state.mtproto.error.clone(),
        active: state.mtproto.active.clone(),
        last_task: state.mtproto.last_task.clone(),
    }
}

const GRAMMERS_VERSION: &str = "0.11";

fn finish_task(app: &tauri::AppHandle, task: MtprotoTask) {
    if let Ok(mut state) = super::STATE.lock() {
        state.mtproto.active = None;
        state.mtproto.last_task = Some(task);
        state.mtproto.cancel = None;
    }
    super::emit_mtproto(app);
}

fn update_task(app: &tauri::AppHandle, patch: impl FnOnce(&mut MtprotoTask)) {
    if let Ok(mut state) = super::STATE.lock() {
        if let Some(task) = state.mtproto.active.as_mut() {
            patch(task);
            task.updated_at = super::now_ms();
        }
    }
    super::emit_mtproto(app);
}

pub fn start_download(app: &tauri::AppHandle, link: &str) -> Result<serde_json::Value, String> {
    let parsed = parse_message_link(link)?;
    {
        let state = super::lock();
        if state.mtproto.active.is_some() {
            return Err("已有 MTProto 下载在进行中".into());
        }
    }
    let (api_id, api_hash) = credentials();
    let (Some(api_id), Some(api_hash)) = (api_id, api_hash) else {
        return Err("缺少 TG_API_ID / TG_API_HASH（在 .env 或环境变量里配置）".into());
    };
    if !store::session_file().is_file() {
        return Err("缺少 MTProto 会话：请先导入已登录会话（会话由桌面壳加密保存）".into());
    }

    let now = super::now_ms();
    let task = MtprotoTask {
        task_id: format!("mt-{now}"),
        phase: "resolving".into(),
        link: link.to_string(),
        message_id: match &parsed {
            MessageLink::Public { message_id, .. } => Some(*message_id),
            MessageLink::Private { message_id, .. } => Some(*message_id),
        },
        file_name: None,
        mime_type: None,
        bytes: 0,
        total_bytes: None,
        resumed_from: 0,
        sha256: None,
        archive_relative_path: None,
        error: None,
        started_at: now,
        updated_at: now,
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut state = super::lock();
        state.mtproto.active = Some(task.clone());
        state.mtproto.cancel = Some(cancel.clone());
        state.mtproto.error = None;
    }
    super::emit_mtproto(app);

    let app_clone = app.clone();
    let link_owned = link.to_string();
    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                finish_task(
                    &app_clone,
                    MtprotoTask {
                        phase: "failed".into(),
                        error: Some(format!("运行时创建失败：{error}")),
                        updated_at: super::now_ms(),
                        ..task
                    },
                );
                return;
            }
        };
        let outcome = runtime.block_on(download_media(
            &app_clone,
            api_id,
            &api_hash,
            &link_owned,
            parsed,
            cancel,
        ));
        match outcome {
            Ok(result) => finish_task(&app_clone, result),
            Err(error) => {
                let cancelled = error == "已取消";
                let mut state_ok = false;
                if let Ok(mut state) = super::STATE.lock() {
                    if let Some(mut task) = state.mtproto.active.take() {
                        task.phase = if cancelled { "cancelled" } else { "failed" }.into();
                        task.error = if cancelled { None } else { Some(error.clone()) };
                        task.updated_at = super::now_ms();
                        state.mtproto.last_task = Some(task);
                        state.mtproto.cancel = None;
                        if !cancelled {
                            state.mtproto.error = Some(error);
                        }
                        state_ok = true;
                    }
                }
                if state_ok {
                    super::emit_mtproto(&app_clone);
                }
            }
        }
    });

    Ok(json!({
        "taskId": super::lock().mtproto.active.as_ref().map(|task| task.task_id.clone()),
        "status": serde_json::to_value(status()).unwrap_or(serde_json::Value::Null),
    }))
}

pub fn cancel_download(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let cancel = super::lock().mtproto.cancel.clone();
    match cancel {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            super::emit_mtproto(app);
            Ok(json!(true))
        }
        None => Ok(json!(false)),
    }
}

fn session_file() -> PathBuf {
    store::session_file()
}

/// 把当前会话（SessionData 的 JSON 表示）加密落盘
fn load_session() -> Result<super::session::FileSession, String> {
    super::session::FileSession::load(session_file())
}

/// 用已保存的会话连上 Telegram，下载单条消息的媒体
async fn download_media(
    app: &tauri::AppHandle,
    api_id: i32,
    api_hash: &str,
    link: &str,
    parsed: MessageLink,
    cancel: Arc<AtomicBool>,
) -> Result<MtprotoTask, String> {
    use grammers_client::media::Media;
    use grammers_client::Client;
    use grammers_mtsender::SenderPool;
    use std::sync::Arc as StdArc;

    let session = StdArc::new(load_session()?);
    let SenderPool { runner, handle, .. } = SenderPool::new(StdArc::clone(&session), api_id);
    let client = Client::new(handle);
    let runner_task = tokio::spawn(runner.run());

    let result = async {
        if !client
            .is_authorized()
            .await
            .map_err(|error| format!("会话不可用：{error}"))?
        {
            return Err("会话未授权：请重新导入已登录会话".to_string());
        }
        let _ = api_hash;

        update_task(app, |task| task.phase = "resolving".into());
        let peer = match &parsed {
            MessageLink::Public { username, .. } => client
                .resolve_username(username)
                .await
                .map_err(|error| format!("解析频道失败：{error}"))?
                .ok_or_else(|| format!("找不到频道 @{username}"))?,
            MessageLink::Private { channel_id, .. } => {
                let peer_id = grammers_session::types::PeerId::channel(*channel_id)
                    .ok_or("私有频道 ID 非法")?;
                // 私有频道没有用户名：用「环境引用」+ 会话里的访问密钥解析
                client
                    .resolve_peer(peer_id.to_ambient_ref())
                    .await
                    .map_err(|error| format!("解析私有频道失败：{error}"))?
            }
        };
        // Peer → PeerRef：后面取消息要用引用形态（get_messages_by_id 的入参）
        let peer_ref = peer
            .to_ref()
            .await
            .map_err(|error| format!("解析频道引用失败：{error}"))?
            .ok_or("无法解析频道引用（会话里缺少该频道的访问密钥）")?;

        let message_id = match &parsed {
            MessageLink::Public { message_id, .. } => *message_id as i32,
            MessageLink::Private { message_id, .. } => *message_id as i32,
        };
        let messages = client
            .get_messages_by_id(peer_ref, &[message_id])
            .await
            .map_err(|error| format!("读取消息失败：{error}"))?;
        let message = messages
            .into_iter()
            .flatten()
            .next()
            .ok_or("消息不存在或无访问权限")?;
        let media: Media = message.media().ok_or("该消息不含可下载媒体")?;
        let caption = message.text().to_string();
        let total_size = media.size().map(|size| size as u64);
        let file_name = media_file_name(&media);
        let mime_type = media_mime_type(&media);

        update_task(app, |task| {
            task.phase = "downloading".into();
            task.file_name = file_name.clone();
            task.mime_type = mime_type.clone();
            task.total_bytes = total_size;
        });

        // 断点续传：已提交字节 → 跳过整块
        let chunk_size: i32 = 512 * 1024;
        let target = store::temp_dir().join(format!(
            "mtproto-{}.part",
            crate::iso_time::now_iso().replace([':', '.'], "-")
        ));
        std::fs::create_dir_all(store::temp_dir()).map_err(|error| error.to_string())?;
        let resumed_from = std::fs::metadata(&target).map(|meta| meta.len()).unwrap_or(0);
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target)
            .map_err(|error| format!("创建临时文件失败：{error}"))?;

        let mut download = client.iter_download(&media).chunk_size(chunk_size);
        if resumed_from > 0 {
            let skip = (resumed_from / chunk_size as u64) as i32;
            download = download.skip_chunks(skip);
        }
        let mut bytes = resumed_from;
        let mut hasher = <sha2::Sha256 as sha2::Digest>::new();
        use std::io::Write;
        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&target);
                return Err("已取消".to_string());
            }
            let next = download
                .next()
                .await
                .map_err(|error| format!("下载分块失败：{error}"))?;
            let Some(chunk) = next else { break };
            // 续传时第一块可能包含已下载前缀：按偏移裁掉
            let already = bytes.saturating_sub(resumed_from) as usize;
            let payload = if already < bytes as usize && resumed_from > 0 && bytes == resumed_from {
                &chunk[(resumed_from % chunk_size as u64) as usize..]
            } else {
                &chunk[..]
            };
            if payload.is_empty() {
                continue;
            }
            file.write_all(payload)
                .map_err(|error| format!("写入失败：{error}"))?;
            sha2::Digest::update(&mut hasher, payload);
            bytes += payload.len() as u64;
            update_task(app, |task| task.bytes = bytes);
        }
        file.flush().map_err(|error| format!("写入失败：{error}"))?;
        drop(file);

        let sha256 = format!("{:x}", sha2::Digest::finalize(hasher));
        update_task(app, |task| {
            task.phase = "verifying".into();
            task.sha256 = Some(sha256.clone());
        });

        update_task(app, |task| task.phase = "archiving".into());
        let object_path = store::object_absolute_path(&sha256);
        if let Some(parent) = object_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        if std::fs::rename(&target, &object_path).is_err() {
            std::fs::copy(&target, &object_path).map_err(|error| format!("提交内容对象失败：{error}"))?;
            let _ = std::fs::remove_file(&target);
        }

        // 归档副本 + message.json（正文 + 媒体清单）
        let archive_dir = store::archive_dir();
        std::fs::create_dir_all(&archive_dir).map_err(|error| error.to_string())?;
        let stamp = super::now_ms();
        let base = format!("tg-{stamp}-{sha}", sha = &sha256[..16]);
        let archive_file = archive_dir.join(format!("{base}.bin"));
        std::fs::copy(&object_path, &archive_file)
            .map_err(|error| format!("归档复制失败：{error}"))?;
        let meta = json!({
            "link": link,
            "messageId": message_id,
            "caption": caption,
            "fileName": file_name,
            "mimeType": mime_type,
            "size": bytes,
            "sha256": sha256,
            "savedAt": crate::iso_time::now_iso(),
            "media": [{ "type": media_kind(&media), "name": file_name }],
        });
        let meta_path = archive_dir.join(format!("{base}.message.json"));
        crate::appearance::write_json_atomic(
            &meta_path,
            &format!("{}\n", serde_json::to_string_pretty(&meta).unwrap_or_default()),
        )?;

        // 会话可能因新 DC 授权而变化：结束时再落盘一次（FileSession 的 set_dc_option 也各自落盘）
        let _ = session.persist();

        Ok(MtprotoTask {
            task_id: String::new(),
            phase: "completed".into(),
            link: link.to_string(),
            message_id: Some(message_id as i64),
            file_name,
            mime_type,
            bytes,
            total_bytes: total_size,
            resumed_from,
            sha256: Some(sha256),
            archive_relative_path: Some(format!("telegram-cache/archive/{base}.bin")),
            error: None,
            started_at: 0,
            updated_at: super::now_ms(),
        })
    }
    .await;

    runner_task.abort();
    // 把 active 任务里的标识补回结果，便于 UI 展示
    let result = result.map(|mut task| {
        if let Ok(state) = super::STATE.lock() {
            if let Some(active) = state.mtproto.active.as_ref() {
                task.task_id = active.task_id.clone();
                task.started_at = active.started_at;
            }
        }
        task
    });
    result
}

fn media_kind(media: &grammers_client::media::Media) -> &'static str {
    use grammers_client::media::Media;
    match media {
        Media::Photo(_) => "photo",
        Media::Document(_) => "document",
        Media::Sticker(_) => "sticker",
        _ => "other",
    }
}

fn media_file_name(media: &grammers_client::media::Media) -> Option<String> {
    use grammers_client::media::Media;
    match media {
        Media::Document(document) => document.name().map(str::to_string),
        _ => None,
    }
}

fn media_mime_type(media: &grammers_client::media::Media) -> Option<String> {
    use grammers_client::media::Media;
    match media {
        Media::Document(document) => document.mime_type().map(str::to_string),
        Media::Photo(_) => Some("image/jpeg".to_string()),
        _ => None,
    }
}

/// 会话迁移 / 清理（命令入口）
pub fn migrate_session(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    // 本项目把会话直接存在数据目录（已是加密文件）；这里做一次「读出来再写回去」的自检，
    // 同时把可能存在的明文 .env 会话提示给用户。
    let data = load_session()?;
    data.persist()?;
    super::emit_mtproto(app);
    Ok(serde_json::to_value(status()).unwrap_or(serde_json::Value::Null))
}

pub fn clear_session(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    session_store::clear(&session_file())?;
    if let Ok(mut state) = super::STATE.lock() {
        state.mtproto.error = None;
    }
    super::emit_mtproto(app);
    Ok(serde_json::to_value(status()).unwrap_or(serde_json::Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telegram::chunk;

    #[test]
    fn parses_public_and_private_links() {
        assert_eq!(
            parse_message_link("https://t.me/durov/123").unwrap(),
            MessageLink::Public {
                username: "durov".into(),
                message_id: 123
            }
        );
        assert_eq!(
            parse_message_link("t.me/some_channel/42?single=1").unwrap(),
            MessageLink::Public {
                username: "some_channel".into(),
                message_id: 42
            }
        );
        assert_eq!(
            parse_message_link("https://t.me/c/1234567890/7").unwrap(),
            MessageLink::Private {
                channel_id: 1_234_567_890,
                message_id: 7
            }
        );
    }

    #[test]
    fn rejects_invites_and_garbage() {
        assert!(parse_message_link("https://t.me/+abcdef").is_err());
        assert!(parse_message_link("https://t.me/joinchat/abc").is_err());
        assert!(parse_message_link("https://example.com/x/1").is_err());
        assert!(parse_message_link("https://t.me/durov").is_err());
        assert!(parse_message_link("https://t.me/durov/0").is_err());
        assert!(parse_message_link("").is_err());
    }

    #[test]
    fn chunk_math_prefers_contiguous_prefix() {
        let ranges = [chunk::ByteRange { start: 0, end: 99 }];
        assert_eq!(chunk::committed_bytes(&ranges), 100);
    }
}
