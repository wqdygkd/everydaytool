# telegram-cache 播放与缓存复用实现说明

> 对应代码：`telegram-tt/src/util/mediaLoader.ts`、`telegram-tt/src/util/edt/{mediaBridge,cacheApi,pageCache,archive}.ts`、
> `tools/telegram-cache/backend/services/{message-store,media-resolver,site-server}.ts`
>
> 一句话结论：**归档是「主动把整份媒体复制到本地」，播放是「按需从 Telegram 流式拉取」**。
> 两者共用同一套 `mediaKey` 命名与 SHA-256 对象库，但**只有已完成归档的整份媒体**才会被播放命中本地；
> 播放到一半的字节不会被归档复用，除非它们已经作为 `.part` 落在磁盘上。

## 1. 三条通路

| 通路 | 触发 | 数据来源 | 落盘 |
| --- | --- | --- | --- |
| 播放（Progressive / DownloadUrl） | 页面自己播放音视频 | `resolveEdtMediaUrl` 命中 → `/media/<mediaKey>?t=`；否则 GramJS 直连 CDN | 不落盘（只在渲染进程媒体缓冲 / Chromium HTTP 缓存里） |
| 播放（BlobUrl：图片/贴纸缩略图） | 页面显示图片 | `fetchEdtBlob` 命中 → `/media/<mediaKey>?t=`；否则 GramJS | 不落盘 |
| 归档（右键「缓存此消息」） | 用户显式操作 | 页面已下载字节（可选）→ GramJS 分块 `downloadMedia` | `messages/<peerId>/<mid>/media/<mediaKey>.<ext>` + 对象库硬链 |

本地媒体服务（`site-server` 的 `/media/<mediaKey>?t=`）**只服务 `media-index.json` 里已 finalize 的整份附件**，
支持 HEAD / 206 / 416（单区间）。`.part` 不在索引里，所以永远无法通过 `/media` 读出来。

## 2. 归档：prepare → append → commit

1. `POST /api/archive/prepare`：幂等建目录、合并 peer/message 快照、写 `archive.meta.json`；
   **同时把盘上已有的 `<mediaKey>.<ext>.part` 大小读回来当 `received`** —— 这是「断点续传」的唯一入口。
2. 页面拿 `received` 当起点，按 4MB 分片下载：
   - 先尝试页面已下载的整份 blob（见 §3），能覆盖多少就 append 多少；
   - 不足部分走 `callApi('downloadMedia', { mediaFormat: Progressive, start, end })`；
   - 每片 `POST /api/archive/append?peer=&mid=&index=&offset=`，header `x-edt-complete: 1` 表示末片。
3. 主进程只维护**连续前缀**：`offset > 当前长度` 的分片直接丢弃并回传当前长度，页面据此重对齐。
4. `complete` 或 `received >= expected` → finalize：`rename` → SHA-256 → 对象库 `objects/<ab>/<sha>` 硬链 →
   写 `media-index.json`（**这一刻该媒体才对 `/media` 可见**）。
5. `POST /api/archive/commit`：所有附件都 complete 才写 `message.md` + `manifest.json`（唯一完成标记），
   删 meta 与残留 `.part`，更新 per-peer 索引。任一片没完成就只返回 `partial`，不写 manifest。

写盘节流：分片追加不再逐片 `fsync`；`archive.meta.json` 与 per-peer 索引按 `META_WRITE_INTERVAL_MS = 700` 节流，
完成时仍立即写。原因见 §5。

## 3. 播放：本地命中是「记忆化的一次探测」

```
mediaLoader.fetch(url, Progressive)
  └─ resolveEdtOrFallback(url, getProgressiveUrl(url))
       └─ resolveEdtMediaUrl(url)                 // mediaBridge.ts
            ├─ 命中缓存（complete）→ /media/<mediaKey>?t=<token>
            └─ 未命中 → HEAD /media/<mediaKey>?t=  → 404 记 15s miss
                                                   → 200 记永久命中
```

- 探测结果按 `mediaKey` 记忆化：命中永不过期（文件只会变得更完整，不会消失），未命中 `MISS_TTL_MS = 15s` 后重试；
  同一 key 的并发探测合并成一个 Promise（`pendingProbe`）。
- `BlobUrl` 走 `fetchEdtBlob`，内部复用同一份探测结果：**未缓存不会发 GET**，直接回落 GramJS。
- Service Worker 的 `requestPart`（渐进式分片）现在**纯直通 GramJS**，不做本地 Range 探测、也不回写归档。

## 4. 复用矩阵（实际会发生什么）

| 场景 | 是否复用已有字节 | 说明 |
| --- | --- | --- |
| 播放到一半，点「缓存此消息」 | **部分复用**：只看得到 `.part` | 起点 = `.part` 长度。渲染进程媒体缓冲里的那些字节拿不回来（它们不是文件，也不在 Cache Storage 里） |
| 缓存中断（关页面 / 断网），稍后再点缓存 | **复用** | `prepare` 读 `.part` 大小 → 从断点续传 |
| 页面 Cache Storage 里有整份 blob（图片/贴纸） | **复用** | `pageCache.getExistingBlob` + `readPageBlob`：只接受 `blob.size >= expected` 的整份副本，按 4MB 切片 append；`REUSE_MIN_BYTES = 64KB` 以下直接跳过（短的多半是预览图，不能当连续前缀） |
| 已完整归档，再播放 | **零流量** | `resolveEdtMediaUrl` 命中 → `/media` 流式 206 |
| 已完整归档，再点「缓存」 | **零流量** | `prepare` 直接返回 `complete`，页面识别为 `already:true` |
| 同一媒体在另一条消息里播放 | **零流量**（若已 complete） | 复用与消息无关，只认 `mediaKey` |
| 边播边缓存（自动回写） | **已移除** | 见 §5 |

## 5. 为什么不再「边播边回写」

1.7.x 的实现里，SW 每个 4MB 分片会：

1. 先 `fetchEdtPart` 打一次本地 Range 探测（`.part` 不进索引 → **必然 404**）；
2. 再从 GramJS 拿到分片后，把**同一份字节**转成 Blob `POST /api/media/append`——而这条路由**从未实现**（同样 404）；
3. 主进程侧每片还要 `fsync` + 重写 `archive.meta.json` + 重写 per-peer 索引；
4. 每条 SSE `msg-status` 都会让所有消息角标重渲染。

净效果：每个分片白付两次本地往返、一次整块上传、一次大 Buffer 拷贝，还在同一个 origin 上搅乱连接池——
这就是「消息里的视频播放很卡」的直接原因。现在全部删除（`fetchEdtPart` / `writeEdtPart` /
`fetchMediaPart` / `appendMedia` / `putMedia` 均已不存在）。

要恢复这个能力，三个前提缺一不可：

1. `mediaKey → (peerId, messageId)` 索引（**只回写用户主动缓存过的消息**，否则等于替所有人偷偷存全量）；
2. `.part` 支持 Range 读，且请求体流式落盘（不能先 `readBuffer` 到内存）；
3. 分片回写与播放做背压隔离（回写队列独立、可丢帧），避免 IO 反过来卡住播放。

## 6. 已知缺口

- **中断的大文件不会自动收尾**：`.part` 停在 478MB 的 822MB 视频不会自己继续，只有再次点「缓存」才会续传；
  也没有过期清理（`trash` 只处理已删除消息）。
- **播放器 Range 粒度由 Chromium 决定**（常见 1–4MB）：本地 `/media` 支持单区间 206/416，多区间请求会被
  `parseByteRange` 判为非法而回退整份响应，拖动进度条时可能重复读盘。
- **没有「部分可播」**：`media-index` 只在 finalize 时写入，所以「下载了 60% 的媒体」既不能播也不能 Range 复用。
- **观测类统计不再产生**（1.8.0 起不再挂载 webRequest 观测），历史 `stats` 字段保留在快照里但恒为 0。

## 7. 手工验收

1. 找一个 100MB+ 视频：播放到 ~30% → 右键「缓存此消息」→ 完成后看 `archive.meta.json` 的 `received`
   应跳变到接近已下载量而不是 0（续传生效）。
2. 缓存中断（关页面）→ 重新打开 → 再点缓存 → 观察日志 offset 从断点继续。
3. 完整归档后断网 → 再播放 → 仍能播（`/media` 本地流）。
4. 同一张图片分别归档到两条消息 → `objects/` 下只有一份 sha256 文件（另见 `linkMode: hardlink`）。
5. 影库「消息 / 链接」列点链接 → 左侧 webview 跳到该消息；「本地目录」列点一下 → 资源管理器打开该消息目录。
