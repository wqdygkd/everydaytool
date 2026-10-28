// MTProto 分块 / 续传的**库无关字节数学**（M3-B 前置脚手架）。
// 约定：区间都是闭区间 [start, end]，单位字节；文件大小 0 表示空文件。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkPlan {
    pub index: u64,
    pub offset: u64,
    pub limit: u64,
}

/// 把文件按 chunk_size 切成顺序分块（最后一块可能更小）
pub fn plan_chunks(total_size: u64, chunk_size: u64) -> Result<Vec<ChunkPlan>, String> {
    if chunk_size == 0 {
        return Err("chunkSize 必须是正整数".into());
    }
    let mut chunks = Vec::new();
    let mut offset = 0u64;
    let mut index = 0u64;
    while offset < total_size {
        let limit = chunk_size.min(total_size - offset);
        chunks.push(ChunkPlan {
            index,
            offset,
            limit,
        });
        offset += chunk_size;
        index += 1;
    }
    Ok(chunks)
}

/// 合并重叠 / 相邻区间，返回按起点升序的规范区间
pub fn merge_ranges(ranges: &[ByteRange]) -> Vec<ByteRange> {
    let mut sorted: Vec<ByteRange> = ranges
        .iter()
        .copied()
        .filter(|range| range.end >= range.start)
        .collect();
    sorted.sort_by_key(|range| (range.start, range.end));
    let mut merged: Vec<ByteRange> = Vec::new();
    for range in sorted {
        match merged.last_mut() {
            None => merged.push(range),
            Some(last) => {
                if range.start > last.end.saturating_add(1) {
                    merged.push(range);
                } else if range.end > last.end {
                    last.end = range.end;
                }
            }
        }
    }
    merged
}

/// 已提交（可安全续传）的字节数：只有从 0 开始**连续**的区间才算数。
/// 中间有洞时，洞后面的数据即使收到过也不能跳过——续传必须从第一个洞重新开始。
pub fn committed_bytes(ranges: &[ByteRange]) -> u64 {
    let merged = merge_ranges(ranges);
    let Some(first) = merged.first() else {
        return 0;
    };
    if first.start != 0 {
        return 0;
    }
    let mut committed = 0u64;
    for range in merged {
        if range.start > committed {
            break;
        }
        committed = committed.max(range.end + 1);
    }
    committed
}

/// 还缺哪些区间（用于续传请求）
pub fn missing_ranges(ranges: &[ByteRange], total_size: u64) -> Vec<ByteRange> {
    if total_size == 0 {
        return Vec::new();
    }
    let merged = merge_ranges(ranges);
    let mut missing = Vec::new();
    let mut cursor = 0u64;
    for range in merged {
        if range.end < cursor {
            continue;
        }
        if range.start > cursor {
            missing.push(ByteRange {
                start: cursor,
                end: (range.start - 1).min(total_size - 1),
            });
        }
        cursor = cursor.max(range.end + 1);
        if cursor >= total_size {
            break;
        }
    }
    if cursor < total_size {
        missing.push(ByteRange {
            start: cursor,
            end: total_size - 1,
        });
    }
    missing
}

/// 是否所有字节都已连续覆盖（完整性前置条件；SHA-256 仍需在完整文件上另算）
pub fn is_complete(ranges: &[ByteRange], total_size: u64) -> bool {
    total_size == 0 || committed_bytes(ranges) == total_size
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_sequential_chunks() {
        let chunks = plan_chunks(10, 4).unwrap();
        assert_eq!(
            chunks.iter().map(|c| (c.offset, c.limit)).collect::<Vec<_>>(),
            vec![(0, 4), (4, 4), (8, 2)]
        );
        assert!(plan_chunks(0, 4).unwrap().is_empty());
        assert!(plan_chunks(4, 0).is_err());
    }

    #[test]
    fn merges_and_commits_contiguous_ranges() {
        assert_eq!(
            merge_ranges(&[
                ByteRange { start: 0, end: 3 },
                ByteRange { start: 4, end: 7 },
                ByteRange { start: 10, end: 12 },
            ]),
            vec![ByteRange { start: 0, end: 7 }, ByteRange { start: 10, end: 12 }]
        );
        assert_eq!(
            committed_bytes(&[
                ByteRange { start: 0, end: 3 },
                ByteRange { start: 8, end: 9 },
            ]),
            4,
            "中间有洞时只认连续前缀"
        );
        assert_eq!(committed_bytes(&[ByteRange { start: 5, end: 9 }]), 0);
        assert_eq!(committed_bytes(&[]), 0);
    }

    #[test]
    fn reports_missing_ranges_and_completeness() {
        assert_eq!(
            missing_ranges(&[ByteRange { start: 0, end: 9 }], 20),
            vec![ByteRange { start: 10, end: 19 }]
        );
        assert_eq!(
            missing_ranges(&[ByteRange { start: 0, end: 4 }, ByteRange { start: 10, end: 19 }], 20),
            vec![ByteRange { start: 5, end: 9 }]
        );
        assert!(is_complete(&[ByteRange { start: 0, end: 19 }], 20));
        assert!(!is_complete(&[ByteRange { start: 0, end: 18 }], 20));
        assert!(is_complete(&[], 0));
    }
}
