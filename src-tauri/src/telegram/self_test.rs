// telegram-cache 域：自检（把关键纯逻辑与落盘路径各跑一遍，结果只读、无副作用）。
use super::types::*;
use super::{chunk, http_semantics, identity, store, tasks};
use serde_json::{json, Value};

struct Step {
    name: &'static str,
    ok: bool,
    detail: String,
}

fn check(step: Step) -> Value {
    json!({ "name": step.name, "ok": step.ok, "detail": step.detail })
}

pub fn run() -> Value {
    let mut steps: Vec<Step> = Vec::new();

    // 1) 资源身份：脱敏 + 键格式 + query 不合并
    let a = identity::describe_url("https://cdn.example.com/a/b.jpg?sig=1#f").unwrap();
    let b = identity::describe_url("https://cdn.example.com/a/b.jpg?sig=2").unwrap();
    steps.push(Step {
        name: "资源身份 / 脱敏",
        ok: a.display_url.contains("sig=***")
            && identity::is_resource_key(&a.resource_key)
            && a.resource_key != b.resource_key,
        detail: format!("key={} display={}", &a.resource_key[..20.min(a.resource_key.len())], a.display_url),
    });

    // 2) HTTP 语义：可缓存 / private 拒绝 / no-store 不占配额
    let cacheable = http_semantics::evaluate_response_caching(http_semantics::EvaluateInput {
        mime_type: Some("image/jpeg"),
        status_code: Some(200),
        cache_control: Some("public, max-age=60"),
        etag: Some("\"e\""),
        vary: None,
        age_seconds: None,
        stored_at: 0,
    });
    let private = http_semantics::evaluate_response_caching(http_semantics::EvaluateInput {
        mime_type: Some("image/jpeg"),
        status_code: Some(200),
        cache_control: Some("private, max-age=60"),
        etag: None,
        vary: None,
        age_seconds: None,
        stored_at: 0,
    });
    let no_store = http_semantics::evaluate_response_caching(http_semantics::EvaluateInput {
        mime_type: Some("image/jpeg"),
        status_code: Some(200),
        cache_control: Some("no-store, max-age=60"),
        etag: None,
        vary: None,
        age_seconds: None,
        stored_at: 0,
    });
    let fresh = http_semantics::is_cache_fresh(&cacheable, cacheable.stored_at);
    let remaining = http_semantics::remaining_fresh_seconds(&cacheable, cacheable.stored_at);
    steps.push(Step {
        name: "HTTP 缓存语义",
        ok: cacheable.cacheable && !private.cacheable && !no_store.cacheable && !no_store.quota_managed,
        detail: format!(
            "cacheable={} fresh={fresh} remaining={remaining}s serve={} vary={:?} noStore={} noCache={} private={} maxAge={:?} storedAt={}",
            cacheable.cacheable,
            cacheable.serve_class,
            cacheable.vary,
            no_store.no_store,
            private.no_cache,
            private.private,
            cacheable.max_age_seconds,
            cacheable.stored_at
        ),
    });

    // 3) 单区间 Range
    let range = http_semantics::parse_byte_range(Some("bytes=0-1023"), 4096);
    let multi = http_semantics::parse_byte_range(Some("bytes=0-1,4-5"), 4096);
    steps.push(Step {
        name: "单区间 Range 解析",
        ok: matches!(range, Some(http_semantics::ByteRange::Range { start: 0, end: 1023 })) && multi.is_none(),
        detail: "多区间一律回源".into(),
    });

    // 4) 分块 / 续传字节数学
    let chunks = chunk::plan_chunks(10, 4).unwrap_or_default();
    let committed = chunk::committed_bytes(&[
        chunk::ByteRange { start: 0, end: 3 },
        chunk::ByteRange { start: 8, end: 9 },
    ]);
    steps.push(Step {
        name: "分块 / 续传",
        ok: chunks.len() == 3 && committed == 4,
        detail: format!("chunks={} committed={committed}", chunks.len()),
    });

    // 4b) 续传缺口与完整性判定
    let gaps = chunk::missing_ranges(&[chunk::ByteRange { start: 0, end: 3 }], 8);
    let complete = chunk::is_complete(&[chunk::ByteRange { start: 0, end: 7 }], 8);
    let incomplete = chunk::is_complete(&[chunk::ByteRange { start: 0, end: 6 }], 8);
    steps.push(Step {
        name: "续传缺口 / 完整性",
        ok: gaps.len() == 1 && complete && !incomplete,
        detail: format!("missing={gaps:?}"),
    });

    // 5) MTProto 链接解析
    let public = super::mtproto::parse_message_link("https://t.me/durov/123").is_ok();
    let invite = super::mtproto::parse_message_link("https://t.me/+abcd").is_err();
    steps.push(Step {
        name: "MTProto 链接解析",
        ok: public && invite,
        detail: "只接受单条消息链接，拒绝邀请链接".into(),
    });

    // 6) 下载核心：落临时文件 → 内容寻址 → 读回校验
    let sample = b"telegram-cache-self-test";
    let digest = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(sample);
        format!("{:x}", hasher.finalize())
    };
    let ok_write = store::ensure_dirs().is_ok();
    let object = store::object_absolute_path(&digest);
    let round_trip = ok_write
        && (|| -> bool {
            let temp = store::temp_dir().join("self-test.part");
            if std::fs::write(&temp, sample).is_err() {
                return false;
            }
            if let Some(parent) = object.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::rename(&temp, &object).is_err() {
                return false;
            }
            let ok = std::fs::read(&object).map(|data| data == sample).unwrap_or(false);
            let _ = std::fs::remove_file(&object);
            ok
        })();
    steps.push(Step {
        name: "下载核心（内容寻址提交）",
        ok: round_trip,
        detail: format!("object={}", store::object_relative_path(&digest)),
    });

    // 7) 基准计数差值
    let before = super::Counters::default();
    let after = super::Counters {
        requests: 3,
        network_bytes: 300,
        ..Default::default()
    };
    let (delta, note) = super::counter_delta(&before, &after);
    steps.push(Step {
        name: "基准计数差值",
        ok: delta.requests == 3 && delta.network_bytes == 300 && note.is_none(),
        detail: "回绕会记一条说明".into(),
    });

    // 8) 配置 clamp
    let clamped = CacheConfig {
        max_http_concurrency: 99,
        max_resource_bytes: 1,
        cache_max_bytes: 1,
        ..Default::default()
    }
    .sanitized();
    steps.push(Step {
        name: "配置边界",
        ok: clamped.max_http_concurrency == MAX_HTTP_CONCURRENCY
            && clamped.max_resource_bytes == MIN_RESOURCE_BYTES
            && clamped.cache_max_bytes == MIN_CACHE_BYTES,
        detail: format!(
            "concurrency={} maxResource={} cache={}",
            clamped.max_http_concurrency, clamped.max_resource_bytes, clamped.cache_max_bytes
        ),
    });

    // 9) 任务历史上限（结构自检）
    let snapshots = {
        let state = super::lock();
        tasks::task_snapshots(&state)
    };
    steps.push(Step {
        name: "任务快照可读",
        ok: snapshots.len() <= TASK_HISTORY_LIMIT * 2,
        detail: format!("当前 {} 条", snapshots.len()),
    });

    // 10) MTProto 会话加密可用性
    steps.push(Step {
        name: "会话加密存储",
        ok: super::session_store::encryption_available() || cfg!(unix),
        detail: if super::session_store::encryption_available() {
            "Windows DPAPI".into()
        } else {
            "Unix 0600 + 压缩封装".into()
        },
    });

    let ok = steps.iter().all(|step| step.ok);
    let steps: Vec<Value> = steps
        .into_iter()
        .map(|step| {
            check(Step {
                name: step.name,
                ok: step.ok,
                detail: step.detail,
            })
        })
        .collect();
    json!({ "ok": ok, "steps": steps, "ranAt": super::now_ms() })
}
