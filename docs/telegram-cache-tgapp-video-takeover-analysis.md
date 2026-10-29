# 参考实现分析：tgapp 如何"接管视频"

> 对象：`D:\project\tgapp`（Tauri 2 + 定制 telegram-tt + Rust `tgcache` 媒体库）
> 目的：回答"它的视频接管是怎么做的、我们 everydaytool/telegram-cache 能不能照搬"。
> **v4 更新**：我们已改为 telegram-tt 源码形态（submodule），因此本文中"接管原生查看器"的整段建议
> 对当前方案不再适用——源码形态下媒体 URL 在 `mediaLoader` 内就被替换，不需要碰查看器 DOM。
> 仍然有效的结论：loopback HTTP + Range 的播放链路、稳定媒体键、状态探测协议、去重的引用计数教训。
> 结论先行：**它没有做注入式接管，而是改了自己的前端源码**——在媒体加载层把"页面要的媒体 URL"
> 直接换成本地 HTTP 服务地址。这个前提我们不具备，但它的播放链路和若干工程选择可以移植。

## 1. 结论

tgapp 的视频"接管"发生在 **React 之前**：

```
useMedia / useMediaWithLoadProgress
  → mediaLoader.fetch(url, ApiMediaFormat.Progressive)
    → resolveLibraryOrRemoteUrl()        // tgapp 新增
      → HEAD http://127.0.0.1:<port>/media/<mediaKey>
         ├─ hit  → 返回本地 URL
         └─ miss → 回落到 Telegram 自己的 ./progressive/<hash>（Service Worker）
  → <video src={返回的字符串}>
```

播放器拿到的永远只是一个字符串 URL。命中本地时它是 `http://127.0.0.1:<port>/media/document_456`；
未命中时是 Telegram 原生的 Service Worker progressive URL。**没有 DOM 注入、没有查看器接管**。

## 2. 证据链（按一次播放的生命周期）

### 2.1 媒体层入口与替换点

| 步骤 | 代码 | 说明 |
| --- | --- | --- |
| 1 | `telegram-tt/src/hooks/useMedia.ts:18-21` | `Progressive` 格式时直接返回 `mediaLoader.getProgressiveUrl(hash)` |
| 2 | `telegram-tt/src/util/mediaLoader.ts:61-79` | tgapp 在 `Progressive` / `DownloadUrl` 分支调用 `resolveLibraryOrRemoteUrl(url, 原生URL)` |
| 3 | `telegram-tt/src/util/mediaLoader.ts:185-199` | 最多 3 次 HEAD 探测本地服务；`miss` 时顺手清掉过期的缓存白名单 |
| 4 | `telegram-tt/src/util/tauri/mediaCache.ts:137-167` | `HEAD /media/<key>`：`x-tgcache-status: downloading` + `x-tgcache-received` + `x-tgcache-expected` → partial；2xx → hit；404 → miss |
| 5 | `telegram-tt/src/util/tauri/mediaCache.ts:97-99` | 本地 URL 形态：`http://127.0.0.1:${port}/media/${encodeURIComponent(cacheKey)}` |
| 6 | `telegram-tt/src/components/mediaViewer/VideoPlayer.tsx:350-373` | 查看器就是 `<video id="media-viewer-video" src={url}>`，没有任何 MSE/自定义传输 |

**关键旁证**：`telegram-tt/src/hooks/useStreaming.ts:19` 的 MSE 分支只在 `IS_SAFARI` 时启用。
Windows/Linux/Chromium 下视频永远是普通 `src`。这意味着"把 src 换成别的 URL"在播放器层面是安全的
（进度条、全屏、画中画、音量都由元素自身负责）。

### 2.2 本地服务（Range / 状态 / 来源决策）

- 绑定：`src-tauri/src/player/stream.rs:28-31` `TcpListener::bind("127.0.0.1:0")`，随机端口；`lib.rs:486-489` 启动后把端口写进 `CacheManager`。
- 路由：`GET/HEAD/PUT/OPTIONS /media/:media_id`、`GET /viewer`、`GET /health`（`stream.rs:38-48`）。
- Range：`parse_range`（`stream.rs:108-130`）支持 `start-end` / `start-` / `-suffix`；命中区间返回 `206 + Content-Range`（`stream.rs:364-393`）。
- 状态：`downloading` 时 `HEAD` 返回 200 + `x-tgcache-status/received/expected`，`GET` 返回 404（`stream.rs:327-345`）——这就是前端"缓存中 x%"的数据来源。
- 来源决策：`manager.rs:832-866` `open_stream` 先本地文件，再 WebDAV（并触发后台拉回），都没有才报错。
- 缓存语义：响应统一 `Cache-Control: no-store`（`stream.rs:338,377`），避免 WebView 自己再缓存一层。

### 2.3 "边看边存"

Telegram 原生播放会由 Service Worker 按 0.5MB 分片请求（`telegram-tt/src/serviceWorker/progressive.ts:33-136`）。
tgapp 在页面的 `requestPart` 处理里插了一层：

1. 先向 Rust 要这段区间：`rustCacheFetchPart(url, start, end)` → `GET /media/<key>` 带 `Range`（`mediaLoader.ts:346-347`）；
2. 本地没有才走 MTProto 下载（`mediaLoader.ts:354`）；
3. 下载到的分片写回 `.part`：`rustCacheWritePart` → `PUT` + `x-tgcache-offset`（`mediaLoader.ts:373-375`）；
4. 若整个文件 ≤ 200MB，再排一个后台全量 ingest（`mediaLoader.ts:34, 377-383`）。

Rust 侧只接受**连续前缀**：`append_bytes` 遇到 `offset > current` 直接丢弃（`manager.rs:308-316`），
所以播放跳读不会制造空洞；完整性最终靠 `x-tgcache-complete` 或全量 ingest，**不靠"播放过"推断**。

### 2.4 UI 标记（源码内改组件，不是注入）

- 右键菜单：`ContextMenuContainer.tsx:731-763`（缓存/取消缓存，单条消息里的单个媒体）；
- 角标：`useIsLibraryCached` 用 HEAD 探测（`hooks/useCacheProgress.ts:38-77`），`Video.tsx:346-349` 渲染一个 `check` 图标，`Video.tsx:332-357` 渲染进度环/百分比；
- 列表/查看器：`player/viewer.html`（独立窗口）+ `/media/<id>` 播放，`tgcacheApi.ts:96-119` 拼 URL 打开。

### 2.5 存储与去重

- 目录：`media/<mediaId 前两位>/<mediaId>/<fileName>`（`manager.rs:179-183`，`local.rs:24-42` 逐段拼接并过滤 `..`）。
- 媒体键：`photo_123` / `document_456`（`mediaCache.ts:63-81`）——**Telegram 实体 id，跨会话稳定**，不是 URL 哈希。
- 去重：写完后异步算 SHA-256；若已有同内容，删除新文件并把本行指针改到对方（`manager.rs:483-512`）。
- LRU：优先淘汰"已有 WebDAV 远端副本"的行，其次最久未用；只清本地文件并标记 `remote`/`missing`，不删索引行（`manager.rs:694-734`）。

## 3. 它为什么能这么做，我们不能

| 条件 | tgapp | everydaytool/telegram-cache |
| --- | --- | --- |
| 前端源码 | **自己的 fork**（telegram-tt） | 远程站点 `web.telegram.org/a/`，不可改 |
| 页面 ↔ 原生 | 自己的 Tauri IPC 与 `window.tauri` | webview preload 被平台剥离，只能用注入 + 自定义通道 |
| 媒体 URL 决策点 | `mediaLoader.fetch` 内部 | 只能从 DOM 外部改 `src`，或拦截网络层 |
| 网络层可拦截性 | 不需要（源码内替换） | progressive 视频由 **Service Worker** 合成 206，不经过网络栈 → `protocol.handle` / `webRequest` 都看不到 |

结论：**tgapp 的方案不可直接复制，但它验证了"本地 HTTP + Range + `<video src>`"这条播放链路在 WebView 里成立**。

## 4. 可以移植的结论

1. **本地播放用 loopback HTTP 服务最稳**：`<video>` 当普通 URL 处理，Range/seek/全屏/画中画都按标准走；不必碰自定义 scheme 的特权注册。自定义协议（`edt-tgcache://`）留作站点 CSP 阻止 loopback 时的兜底。
2. **接管窗口很明确**：查看器视频元素有稳定 id `media-viewer-video`，`src` 是普通属性；图片是查看器容器内的 `<img>`。在元素挂载、`src` 首次就绪后替换即可。
3. **React 只在 prop 变化时写 DOM**：`src={url}` 的 `url` 不变时，普通重渲染不会覆盖我们改的 `src`；但切换媒体、`url` 更新、元素重建会覆盖 → 需要 observer + 有限次重试，而不是无限守护。
4. **状态探测协议可借用**：`HEAD` + `x-*` 头表达"下载中/已接收/总大小"，比主进程推送更适合注入脚本自检与降级。
5. **稳定媒体键优于 URL 哈希**：`photo_<id>` / `document_<id>` 跨会话稳定，天然支持跨消息去重；我们应形成 `messageKey(peer:mid)` + `mediaKey(photo_id|document_id)` 双键模型。
6. **接管时机应在播放前**：在查看器挂载后立刻换 `src`，此时 `currentTime` 还是 0，不存在"进度归零"问题；只有中途替换才会重置。这一点消解了我们原先搁置的第 5 个问题。

## 5. 不能照搬的坑

| 坑 | tgapp 现状 | 我们的做法 |
| --- | --- | --- |
| 去重没有引用计数 | 删除新文件、把行指向对方；删任一行都会 `remove_cache_files` 带走共享文件（`manager.rs:483-512` + `630-638`） | 硬链（同卷）或引用计数，删除前判断 `objectSha256` 是否仍被引用 |
| 本地服务无鉴权 | `CORS *`、无 token（`stream.rs:58-88`），本机任意页面/进程可按 id 读取 | 随机 token + 校验 `Host`/`Origin` + 只读；端口随机且仅绑 127.0.0.1 |
| Range 越界返回整份 | `parse_range` 不可满足时返回 `None` → 回落 200 | 明确 416 + `Content-Range: bytes */size` |
| 状态语义非标准 | downloading 时 `HEAD 200`、`GET 404` | 沿用（对 `<video>` 友好），但在文档/诊断里写清 |
| 媒体键不含账号 | `photo_123` 全局唯一但跨账号可能语义相同 | 本地 URL 与索引带 account scope，或明确单账号前提 |
| 缓存白名单两处状态 | settings 里的 `cacheAllowMediaKeys` + 实际文件，靠 HEAD 校正 | 索引为唯一事实来源，UI 状态只做本地读 |

## 6. 对我们方案的修订建议（已回填到主方案）

1. **本地媒体传输改为 loopback HTTP 优先**：Node `http.createServer` 绑定 `127.0.0.1:0`，
   路由 `/media/<mediaKey>`，复用现有 `parseByteRange` 并补 416；`edt-tgcache://` 仅作兜底。
2. **双键模型**：消息目录用 `peer/mid`，本地播放与去重用 `mediaKey`，manifest 里同时记录两者。
3. **接管实现细化**：点击捕获（记 pending）→ 查看器出现 → `video#media-viewer-video` 挂载后立即换 `src`；
   observer 只监听 `src` 被改回（最多 3 次）；关闭/切换时还原。
4. **状态探测**：本地服务同时提供 `HEAD` 状态头（downloading/complete/missing），供注入脚本与诊断复用。
5. **安全**：token 化 URL + Origin 校验 + 只读，不接受任意路径。
6. **保留"本地播放 ≠ 零流量"的提示**：接管发生在 SW 已发起的 1–2 个分片之后，且页面可能继续后台拉流；
   我们只保证"从本地播放"，不承诺"完全无网络"。

## 7. 与需求 R5 的关系

tgapp 的做法天然满足"原消息不可用时本地仍可播"：它的查看器只认 `/media/<mediaKey>`，与消息是否存在无关。
我们的 `library` 子路由 + `messages/` 目录需要同样的性质：**播放路径不经过 Telegram、不校验远端**。
tgapp 的 `open_stream`（本地 → WebDAV → 报错）是这一点的参考实现；我们只做本地（+ 未来 StorageProvider）。
