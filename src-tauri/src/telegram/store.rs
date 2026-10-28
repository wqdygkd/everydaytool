// telegram-cache 域：数据目录布局 + JSON 文档（config.json / registry.json /
// archives.json / benchmarks.json）+ 内容对象（objects/<sha256 前缀>/<sha256>）。
//
// 配额与 LRU：只有 `quota_managed` 的条目计入配额；淘汰按 `updated_at` 由旧到新，
// 归档副本（archive/ 下）不参与淘汰。
use super::types::{ArchiveEntry, BenchmarkRecord, CacheConfig, RegistryEntry};
use crate::appearance::{resolve_data_dir, write_json_atomic};
use std::path::{Path, PathBuf};

pub fn root_dir() -> PathBuf {
    resolve_data_dir().join("telegram-cache")
}

pub fn config_path() -> PathBuf {
    root_dir().join("config.json")
}

pub fn registry_path() -> PathBuf {
    root_dir().join("registry.json")
}

pub fn archives_path() -> PathBuf {
    root_dir().join("archives.json")
}

pub fn benchmarks_path() -> PathBuf {
    root_dir().join("benchmarks.json")
}

pub fn objects_dir() -> PathBuf {
    root_dir().join("objects")
}

pub fn archive_dir() -> PathBuf {
    root_dir().join("archive")
}

pub fn temp_dir() -> PathBuf {
    root_dir().join("tmp")
}

pub fn session_file() -> PathBuf {
    root_dir().join("telegram-session.bin")
}

pub fn ensure_dirs() -> Result<(), String> {
    for dir in [root_dir(), objects_dir(), archive_dir(), temp_dir()] {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("创建 {} 失败：{error}", dir.display()))?;
    }
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<T>(&raw).ok())
        .unwrap_or_default()
}

fn write_json<T: serde::Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let body = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    write_json_atomic(path, &format!("{body}\n"))
}

pub fn read_config() -> CacheConfig {
    let raw = std::fs::read_to_string(config_path()).ok();
    let config = raw
        .and_then(|raw| serde_json::from_str::<CacheConfig>(&raw).ok())
        .unwrap_or_default();
    config.sanitized()
}

pub fn write_config(config: &CacheConfig) -> Result<(), String> {
    write_json(&config_path(), config)
}

pub fn read_registry() -> Vec<RegistryEntry> {
    read_json::<Vec<RegistryEntry>>(&registry_path())
}

pub fn write_registry(entries: &[RegistryEntry]) -> Result<(), String> {
    write_json(&registry_path(), entries)
}

pub fn read_archives() -> Vec<ArchiveEntry> {
    read_json::<Vec<ArchiveEntry>>(&archives_path())
}

pub fn write_archives(entries: &[ArchiveEntry]) -> Result<(), String> {
    write_json(&archives_path(), entries)
}

pub fn read_benchmarks() -> Vec<BenchmarkRecord> {
    read_json::<Vec<BenchmarkRecord>>(&benchmarks_path())
}

pub fn write_benchmarks(records: &[BenchmarkRecord]) -> Result<(), String> {
    write_json(&benchmarks_path(), records)
}

/// 内容对象路径（相对数据根目录），内容寻址：同一份字节只存一次
pub fn object_relative_path(sha256: &str) -> String {
    format!("objects/{}/{}", &sha256[..2.min(sha256.len())], sha256)
}

pub fn object_absolute_path(sha256: &str) -> PathBuf {
    root_dir().join(object_relative_path(sha256))
}

/// 配额记账 + LRU 淘汰：返回被淘汰的条目键（调用方负责删文件）。
pub fn evict_for_quota(entries: &mut Vec<RegistryEntry>, max_bytes: u64) -> Vec<String> {
    let mut total: u64 = entries
        .iter()
        .filter(|entry| entry.stored.as_ref().is_some_and(|stored| stored.quota_managed))
        .map(|entry| entry.stored.as_ref().map(|stored| stored.size).unwrap_or(0))
        .sum();
    if total <= max_bytes {
        return Vec::new();
    }

    let mut candidates: Vec<(usize, u64)> = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let stored = entry.stored.as_ref()?;
            // 已归档的条目即使 no-store 也不淘汰：它是用户明确保留的
            if !stored.quota_managed || stored.archived {
                return None;
            }
            Some((index, stored.updated_at))
        })
        .collect();
    candidates.sort_by_key(|(_, updated_at)| *updated_at);

    let mut evicted = Vec::new();
    for (index, _) in candidates {
        if total <= max_bytes {
            break;
        }
        if let Some(stored) = entries[index].stored.take() {
            total = total.saturating_sub(stored.size);
            evicted.push(entries[index].resource_key.clone());
        }
    }
    entries.retain(|entry| entry.stored.is_some());
    evicted
}
