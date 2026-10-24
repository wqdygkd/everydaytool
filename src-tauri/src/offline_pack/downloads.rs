// offline-pack 域：下载目录 / 任务取消注册表 / 进度事件 / CRX→ZIP 转换 / 统一下载。
use crate::appearance::resolve_data_dir;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;

static CANCELED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn register(task_id: &str) {
    if let Ok(mut canceled) = CANCELED.lock() {
        canceled.remove(task_id);
    }
}

pub fn unregister(task_id: &str) {
    if let Ok(mut canceled) = CANCELED.lock() {
        canceled.remove(task_id);
    }
}

pub fn is_cancelled(task_id: &str) -> bool {
    CANCELED
        .lock()
        .map(|c| c.contains(task_id))
        .unwrap_or(false)
}

pub fn cancel(task_id: &str) -> bool {
    // 只有注册过且未完成的任务才可能出现在“已请求取消”集合之外；
    // 直接标记取消，下载循环在下一块读取时退出。
    if let Ok(mut canceled) = CANCELED.lock() {
        canceled.insert(task_id.to_string());
        true
    } else {
        false
    }
}

pub fn download_dir() -> PathBuf {
    resolve_data_dir().join("offline-pack").join("downloads")
}

pub fn ensure_download_dir() -> Result<PathBuf, String> {
    let dir = download_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    Ok(dir)
}

#[allow(clippy::too_many_arguments)]
pub fn emit_progress(
    app: &tauri::AppHandle,
    task_id: &str,
    kind: &str,
    status: &str,
    downloaded: u64,
    total: u64,
    message: Option<String>,
    layer: Option<(usize, usize)>,
) {
    let mut payload = json!({
        "taskId": task_id,
        "kind": kind,
        "status": status,
        "downloadedBytes": downloaded,
        "totalBytes": total,
    });
    if let Some(message) = message {
        payload["message"] = json!(message);
    }
    if let Some((index, total_layers)) = layer {
        payload["layerIndex"] = json!(index);
        payload["totalLayers"] = json!(total_layers);
    }
    let _ = app.emit(
        "edt:event",
        json!({
            "channel": "offline-pack:event:progress",
            "payload": payload,
        }),
    );
}

pub fn emit_error(app: &tauri::AppHandle, task_id: &str, kind: &str, cancelled: bool, error: &str) {
    let _ = app.emit(
        "edt:event",
        json!({
            "channel": "offline-pack:event:progress",
            "payload": {
                "taskId": task_id,
                "kind": kind,
                "status": if cancelled { "cancelled" } else { "error" },
                "downloadedBytes": 0,
                "totalBytes": 0,
                "error": if cancelled { Value::Null } else { json!(error) },
            },
        }),
    );
}

/// CRX2 / CRX3 → ZIP：先按头解析，非 Cr24 魔数时在前 1KB 内找 ZIP 魔数
pub fn convert_crx_to_zip(crx: &[u8]) -> Result<Vec<u8>, String> {
    if crx.len() < 16 {
        return Ok(crx.to_vec());
    }
    if &crx[..2] == b"PK" {
        return Ok(crx.to_vec());
    }
    let zip_offset = if &crx[..4] == b"Cr24" {
        let version = u32::from_le_bytes([crx[4], crx[5], crx[6], crx[7]]);
        match version {
            3 => {
                let header_size = u32::from_le_bytes([crx[8], crx[9], crx[10], crx[11]]) as usize;
                12 + header_size
            }
            2 => {
                let pub_key = u32::from_le_bytes([crx[8], crx[9], crx[10], crx[11]]) as usize;
                let signature = u32::from_le_bytes([crx[12], crx[13], crx[14], crx[15]]) as usize;
                16 + pub_key + signature
            }
            other => return Err(format!("不支持的 CRX 版本: {other}")),
        }
    } else {
        let limit = (crx.len().saturating_sub(2)).min(1024);
        let mut found = 0;
        for index in 0..limit {
            if &crx[index..index + 2] == b"PK" {
                found = index;
                break;
            }
        }
        if found == 0 {
            return Ok(crx.to_vec());
        }
        found
    };
    if zip_offset >= crx.len() {
        return Err("ZIP 数据偏移量超出文件范围".into());
    }
    let zip = &crx[zip_offset..];
    if zip.len() < 4 || &zip[..2] != b"PK" {
        return Err("提取的数据不是有效的 ZIP 格式".into());
    }
    Ok(zip.to_vec())
}

/// 下载单个 URL 到 downloads 目录；convertToZip 时先落临时文件再转换
pub fn download_simple_file(
    app: &tauri::AppHandle,
    task_id: &str,
    kind: &str,
    url: &str,
    filename: &str,
    headers: &[(&'static str, String)],
    convert_to_zip: bool,
) -> Result<Value, String> {
    register(task_id);
    let result: Result<Value, String> = (|| {
        let dir = ensure_download_dir()?;
        // convertToZip 时最终文件名 .crx → .zip
        let lower = filename.to_lowercase();
        let final_path = if convert_to_zip && lower.ends_with(".crx") {
            dir.join(format!("{}.zip", &filename[..filename.len() - 4]))
        } else {
            dir.join(filename)
        };
        let tmp_path = dir.join(format!("{filename}.part"));
        let message = format!("正在下载 {filename}");
        let control = super::http::DownloadControl {
            headers,
            is_cancelled: &|| is_cancelled(task_id),
            on_progress: &|downloaded, total| {
                emit_progress(
                    app,
                    task_id,
                    kind,
                    "downloading",
                    downloaded,
                    total,
                    Some(message.clone()),
                    None,
                );
            },
        };

        emit_progress(
            app,
            task_id,
            kind,
            "downloading",
            0,
            0,
            Some(format!("正在下载 {filename}")),
            None,
        );
        super::http::download_to_file(url, &tmp_path, &control)?;

        if convert_to_zip {
            emit_progress(
                app,
                task_id,
                kind,
                "processing",
                0,
                0,
                Some("正在转换为 ZIP".into()),
                None,
            );
            let crx = std::fs::read(&tmp_path).map_err(|e| format!("读取下载文件失败：{e}"))?;
            let zip = convert_crx_to_zip(&crx)?;
            std::fs::write(&final_path, zip).map_err(|e| format!("写入 ZIP 失败：{e}"))?;
            let _ = std::fs::remove_file(&tmp_path);
        } else {
            std::fs::rename(&tmp_path, &final_path)
                .map_err(|e| format!("保存下载文件失败：{e}"))?;
        }

        emit_progress(
            app,
            task_id,
            kind,
            "completed",
            0,
            0,
            Some("下载完成".into()),
            None,
        );
        let saved = final_path.to_string_lossy().to_string();
        let final_filename = final_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        super::history::add_history(kind, &final_filename, &saved)?;
        Ok(json!({ "taskId": task_id, "savedPath": saved, "filename": final_filename }))
    })();
    unregister(task_id);
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            let _ = std::fs::remove_file(download_dir().join(format!("{filename}.part")));
            let cancelled = is_cancelled(task_id);
            emit_error(app, task_id, kind, cancelled, &error);
            Err(error)
        }
    }
}
