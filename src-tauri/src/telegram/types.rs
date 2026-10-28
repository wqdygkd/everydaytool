// telegram-cache 域：与渲染层共享的数据契约（camelCase 序列化，字段与
// shared/telegram-cache.ts 一一对应）。
use serde::{Deserialize, Serialize};

pub const RESOURCE_LIMIT: usize = 300;
pub const TRAFFIC_LIMIT: usize = 300;
pub const TASK_HISTORY_LIMIT: usize = 50;

pub const MIN_RESOURCE_BYTES: u64 = 1024 * 1024;
pub const MAX_RESOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const DEFAULT_RESOURCE_BYTES: u64 = 512 * 1024 * 1024;

pub const MIN_HTTP_CONCURRENCY: u32 = 1;
pub const MAX_HTTP_CONCURRENCY: u32 = 8;
pub const DEFAULT_HTTP_CONCURRENCY: u32 = 3;

pub const TASK_MAX_ATTEMPTS: u32 = 3;

pub const MIN_CACHE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_CACHE_BYTES: u64 = 20 * 1024 * 1024 * 1024;
pub const DEFAULT_CACHE_BYTES: u64 = 3 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CacheConfig {
    /// 观测开关：关闭后仍保持订阅，但不再记录（可快速重开）
    pub observation_enabled: bool,
    pub max_http_concurrency: u32,
    pub max_resource_bytes: u64,
    /// 缓存配额：超过后按 LRU 淘汰（归档副本不受影响）
    pub cache_max_bytes: u64,
    /// 图片本地响应开关（默认关；本项目**无 protocol.handle 等价能力**，见 docs/telegram-cache.md）
    pub local_response_enabled: bool,
    /// 音视频单区间 Range 本地响应开关（默认关，同上）
    pub local_media_range_enabled: bool,
    /// 页面数据捕获开关（默认关；本项目无 CDP 客户端，见 docs/telegram-cache.md）
    pub enable_page_capture: bool,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            observation_enabled: true,
            max_http_concurrency: DEFAULT_HTTP_CONCURRENCY,
            max_resource_bytes: DEFAULT_RESOURCE_BYTES,
            cache_max_bytes: DEFAULT_CACHE_BYTES,
            local_response_enabled: false,
            local_media_range_enabled: false,
            enable_page_capture: false,
        }
    }
}

impl CacheConfig {
    /// 配置落盘前统一 clamp：误填 4GB / 0 不该把工具带崩
    pub fn sanitized(mut self) -> Self {
        self.max_http_concurrency = self
            .max_http_concurrency
            .clamp(MIN_HTTP_CONCURRENCY, MAX_HTTP_CONCURRENCY);
        self.max_resource_bytes = self
            .max_resource_bytes
            .clamp(MIN_RESOURCE_BYTES, MAX_RESOURCE_BYTES);
        self.cache_max_bytes = self.cache_max_bytes.clamp(MIN_CACHE_BYTES, MAX_CACHE_BYTES);
        self
    }
}

/// 已落库（内容对象）的资源信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredInfo {
    pub size: u64,
    pub sha256: String,
    pub completeness: String,
    pub verification: String,
    pub archived: bool,
    pub relative_path: String,
    pub updated_at: u64,
    pub cacheable: bool,
    pub serve_class: String,
    pub quota_managed: bool,
    pub fresh_until: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
}

/// 资源索引条目（registry.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub resource_key: String,
    pub display_url: String,
    pub host: String,
    pub path: String,
    pub resource_type: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    pub size: u64,
    pub size_known: bool,
    pub requests: u64,
    pub from_cache: bool,
    #[serde(default)]
    pub status_code: Option<u16>,
    pub last_seen_at: u64,
    pub downloadable: bool,
    #[serde(default)]
    pub stored: Option<StoredInfo>,
}

/// 页面观测上报（渲染层子 Webview 注入的只读采集脚本 → 这里）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationReport {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub resource_type: Option<String>,
    #[serde(default)]
    pub status_code: Option<u16>,
    #[serde(default)]
    pub from_cache: bool,
    #[serde(default)]
    pub transfer_bytes: Option<u64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub task_id: String,
    pub resource_key: String,
    pub display_url: String,
    pub host: String,
    pub status: String,
    pub priority: i64,
    pub consumers: u32,
    pub joined_consumers: u32,
    pub kinds: Vec<String>,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub queued_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub archive_id: String,
    pub resource_key: String,
    pub display_url: String,
    pub host: String,
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    pub saved_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCounters {
    pub requests: u64,
    pub completed: u64,
    pub failed: u64,
    pub from_cache: u64,
    pub network_bytes: u64,
    pub unknown_size_count: u64,
    pub cache_served_bytes: u64,
    pub local_hits: u64,
    pub local_misses: u64,
    pub revalidations: u64,
    pub revalidation_hits: u64,
    pub page_captured_bytes: u64,
}

impl Default for BenchmarkCounters {
    fn default() -> Self {
        Self {
            requests: 0,
            completed: 0,
            failed: 0,
            from_cache: 0,
            network_bytes: 0,
            unknown_size_count: 0,
            cache_served_bytes: 0,
            local_hits: 0,
            local_misses: 0,
            revalidations: 0,
            revalidation_hits: 0,
            page_captured_bytes: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkRecord {
    #[serde(flatten)]
    pub counters: BenchmarkCounters,
    pub id: String,
    pub label: String,
    pub started_at: u64,
    pub ended_at: u64,
    pub duration_ms: u64,
    pub network_bytes_per_request: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MtprotoAccount {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MtprotoTask {
    pub task_id: String,
    pub phase: String,
    pub link: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub resumed_from: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_relative_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub started_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MtprotoStatus {
    pub configured: bool,
    pub has_session: bool,
    pub connected: bool,
    pub account: Option<MtprotoAccount>,
    pub missing: Vec<String>,
    pub lib_version: Option<String>,
    pub session_source: String,
    pub encryption_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub active: Option<MtprotoTask>,
    pub last_task: Option<MtprotoTask>,
}
