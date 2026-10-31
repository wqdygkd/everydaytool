# tweb-cache 模块记忆（tweb 前端的 Telegram 归档）

> 方案与验收清单见 [tweb-cache-plan.md](./tweb-cache-plan.md)；归档目录格式 / HTTP 协议见
> [telegram-cache.md](./telegram-cache.md)。本文记「实现落点 + 为什么这么放 + 升级 tweb 时怎么重放」。

## 0. 一句话

`tweb-cache` 是**独立工具**（独立卡片 / 路由 / 后端 / 端口 34200 / IPC `twebCache` / 分区
`persist:tweb-cache` / 数据 `<assets>/tweb-cache`），页面端是 **tweb（Telegram Web K，Solid.js）**，
通过平台层契约 `backend/telegram-archive/engine.ts` 复用 telegram-cache 注册的归档引擎（同一份存储代码，
按 scope 各写各的目录）。页面侧在 `tweb/src/helpers/edt/**` 加一层归档客户端，并在 tweb 源码中保留少量单点接线。

## 1. 页面侧客户端（tweb/src/helpers/edt/）

| 文件 | 职责 | 要点 |
| --- | --- | --- |
| `types.ts` | HTTP 契约类型 | 与 telegram-cache 的归档 HTTP 契约对齐 |
| `env.ts` | 双上下文引导 + `edtFetch` | 页面读注入的 `window.__EDT__`；worker / SW 通过一次性 query 重取 `/edt-bootstrap.js`；**401 时自动换 query 刷新 token**（tweb 的 SW 对带扩展名同源 URL 是 cache-first，`no-store` 头救不了它） |
| `api.ts` | 5 条归档 HTTP（prepare/append/commit/status/delete/reveal） | peer 是**字符串数字**（tweb 的 PeerId = 带符号 number，`String()` 后即归档命名空间） |
| `statusStore.ts` | 状态 Map + SSE + 订阅 | 120ms 批量拉取 / 150ms SSE 合流（与 telegram-tt 同参） |
| `archive.ts` | `cacheMessageToArchive` 流水线 | ≤20 MiB 走 `appDownloadManager.downloadMedia`（整份 Blob）；更大走 SW `stream/` 路由按 Range 分块（45s 超时、断点续传靠后端 `.part`）；照片必须选最大可用 `PhotoSize` 并作为 `thumb` 传入，否则 tweb 会拒绝下载；`getServerMessageId(mid)` 一律先转服务端 id；成功后清理原媒体的 `cachedFiles` / `cachedStreamChunks` |
| `bridge.ts` | `window.__EDT_JUMP_TO_MESSAGE__` | `apiManagerProxy.getPeer` 判空；频道 / 超级群把服务端 id 转为 `MESSAGE_ID_OFFSET + id` → `appImManager.setInnerPeer({peerId, lastMsgId})`；会话没加载返回 `false` |
| 取消 / 删除 | `cancelArchiveFor` + `__EDT_CANCEL_ARCHIVE__` | 活跃归档用 `AbortController`；影库删除和右键移除先取消，再做后端 trash/delete，避免删除后被 append 重建 |
| 缩略图补齐 | `__EDT_BACKFILL_THUMBNAILS__` | 工具页把缺少缩略图的 complete 条目传给 tweb；tweb reload 对应消息、下载原始 thumbnail、POST `/archive/thumbnail`；按 peer/mid 去重，消息不可达时跳过 |
| `ui/badge.ts` | 时间行角标 | 挂在 `MessageRender.setTime` 的产物上（`.time` 与 `.time-inner` 各一份）；statusStore 任何变更全量重刷活着的时间行（内容比对去抖） |
| `ui/menu.ts` | 右键菜单 3 项 | 纯工厂（`setButtons()` 每次重建）；verify 为假会被静默过滤，可读状态在这里判 |
| `archiveStatus.ts` | 归档状态 + 本地 Range | 页面 / SharedWorker / ServiceWorker 共用；`/api/media/status` 正向命中缓存 5 分钟、未命中只缓存 2 秒；归档完成 / 删除经 `BroadcastChannel('edt-archive-media')` 主动失效；`/media/<mediaKey>` 支持 Range/206 |
| `archivedMedia.ts` | **requestFilePart 兜底短路** | `apiFileManager.requestFilePart` 在 shared worker 执行（`index.worker-*.js`）；已归档 → 从 `archiveStatus` 读本地 Range 并合成 `upload.file`；视频只认全尺寸 location，照片可复用最大尺寸归档；任何错误回落 Telegram |
| `index.ts` | `startEdt()` 入口 | 装跳转桥 + 角标 + 归档媒体追踪；**一次性把 tweb 的 `cacheTTL` 置 0**（tweb 默认 7 天自动清媒体缓存，`config/state.ts:607`；`localStorage` 标记防止重复覆盖） |

## 2. 工具壳与右栏（tools/tweb-cache/**）

| 文件 | 职责 |
| --- | --- |
| `backend/services/site-service.ts` | 起独立回环站点；固定端口 / origin；`tweb/dist` 缺失只影响本工具 |
| `backend/ipc/{channels,handlers}.ts` | `twebCache` 独立 IPC；只做参数校验并转调平台归档引擎，固定 `scope='tweb-cache'` |
| `renderer/stores/twebCacheStore.ts` | 站点 / 影库 / 回收站状态；订阅 `EVENT_LIBRARY`，已有条目就地更新，新条目 400ms 防抖重扫 |
| `renderer/pages/TwebCachePage.vue` | webview + 概览 / 影库 / 回收站；媒体缓存用量在概览页每 5 秒静默刷新；消息号与「定位」按钮跳转消息 |
| `renderer/ipc.ts` | 唯一 `createIpcHelpers('twebCache')` 实例 |

影库右栏不复制播放器：播放统一在左侧 tweb 会话内完成，避免第二套媒体 UI 和 token 暴露面。

归档事件由 `tools/telegram-cache/backend/services/archive-api.ts` 按 `currentArchiveToolId()` 分流到
`telegram-cache:event:library` / `tweb-cache:event:library`，两个工具不会收到对方的事件。

影库展示：

- 同一 `groupedId` 的相册按消息组合并第一列，组内行仍可单独定位 / 删除。
- 缩略图优先读 manifest 里保存的 `thumb_<mediaKey>`；旧照片回退到主媒体，视频没有独立缩略图时不回退主文件。
- 进入影库时自动补齐旧视频缩略图；成功后刷新影库，消息不可达 / 无 thumbnail 的条目跳过。
- 显示 `savedAt`（完成时间）和转发来源；转发来源保存在 manifest / message.md。

## 3. tweb 源码触点（升级时的重放清单）

| 文件 | 改动 |
| --- | --- |
| `src/index.ts` | `DOMContentLoaded` 钩子里 `rootScope.managers = getProxiedManagers()` 之后：`void import('@helpers/edt/index').then((edt) => { edt.startEdt(); }).catch(noop)` —— fire-and-forget，不推迟首帧 |
| `src/components/chat/contextMenu.ts` | ①顶部 `import {getEdtCacheMenuButtons} from '@helpers/edt/ui/menu'`；②`setButtons()` 的普通消息分支里，`Message.Context.Selection.Delete` 项之后、`...getSponsoredMessageButtons({` 之前插入 `...getEdtCacheMenuButtons({getMessage, getGroupedMessages, getIsProtected, getQueueId})` |
| `src/components/chat/messageRender.ts` | ①顶部 `import {edtApplyCacheBadge} from '@helpers/edt/ui/badge'`；②`setTime` 末尾 `return timeSpan;` 之前一行 `edtApplyCacheBadge(timeSpan, message, options.middleware)` |
| `src/lib/appManagers/apiFileManager.ts` | ①顶部 `import {edtInterceptFilePart} from '@helpers/edt/archivedMedia'`；②`requestFilePart` 方法体整体包进 `const request = () => {...}`（原 downloadRequest 路径原样保留），结尾 `return edtInterceptFilePart(location, offset, limit, request)`。**注意**：回落必须在 hook 链内调用 fallback（不能让 hook resolve 成 undefined 再在调用方判断——那会把所有全尺寸媒体短路成空结果） |
| `src/components/mediaViewer/base.ts` | ①顶部 import `isArchivedDocument`；②视频 `load()` 在计算 `isHlsStream` 前检查原始 document 是否已归档，命中则清空 HLS 质量菜单并强制走普通 `stream/`；原始文件归档后绝不能继续请求转码 document |
| `src/components/mediaPeek/renderMedia.ts` | 同上：视频 peek 在 `wrapVideo` 前检查归档态，命中时 `hlsStreaming: false` |
| `src/lib/serviceWorker/stream.ts` | 普通 `stream/` 在 Cache Storage miss 后、MTProto 前调用 `readArchivedMediaRangeForLocation`；本地命中直接返回字节，不写 `cachedStreamChunks`（归档资产已是持久副本），仍保留 `tryPatchMp4` |
| `src/lang.ts` | 末尾新增 10 个 `TelegramCache.*` 键（占位符是 `%s`） |
| `src/scss/style.scss` + `partials/_edtCache.scss` | `@use "partials/edtCache";`（badge 样式，逻辑属性保 RTL） |

升级 tweb 后：按上表重放源码触点（都是局部 import + 单点调用，冲突面较小）；
跑 `pnpm tweb:build` 后用 `git -C tweb diff` 核对触点仍在。

## 4. 构建与托管

- **构建**：`pnpm tweb:build`（`scripts/build-tweb.mjs`）。engines `^22.18 || >=24.11`——脚本自动在
  fnm 目录里找可用 Node（本机 v24.15.0），用 Node 自带的 `corepack.js` 起 pnpm 11.16（`packageManager`
  钉死，系统 pnpm 10 会被拒）。`--check` 只查状态与 dist 是否落后于 src 的 mtime。
- **托管**：`tools/tweb-cache/backend/services/site-service.ts` 起引擎站点（`rootDir=tweb/dist`，
  `extraRootDir=tweb/public`——tweb 的 dist 不含字体/wasm/assets，两个静态根都要挂）。端口落盘在
  `<config>/tweb-cache/config.json`，origin 变化会清空 tweb 登录态，所以端口一旦分配就固定。
- **懒启动**：站点不随 app 启动拉起。页签挂载时 store 经 `SITE_ACQUIRE` 触发 `ensureTwebCacheSiteStarted()`
  （引用计数 +1），卸载时 `SITE_RELEASE` 归零后闲置 5 分钟停站点；重开页签会取消闲置停机。端口固定
  策略保证停/启不换 origin，登录态不受影响。app 退出时 `disposeTwebCacheSite()` 兜底停站点。
- **bootstrap 注入**：站点服务往 HTML 的 `</head>` 前插 `<script src="/edt-bootstrap.js">`（no-store），
  内容是 `window.__EDT__ = {token, api, media}`。SW 对它 cache-first 是已知坑 → env.ts 的 401 重取兜底。

## 5. 已知的边界与坑（源码勘察结论，行号以 2026-10-31 的 tweb 为准）

- **PeerId 空间**：tweb 的 `PeerId = number`（`global.d.ts:128`），频道/群是负数（**没有** telegram-tt
  那种 `-100` 前缀），用户是正数。所以 tweb-cache 的归档目录名与 telegram-cache 的**不同空间**——
  数据本来就按 scope 分目录（`<assets>/tweb-cache/messages`），互相对不上也无妨；跳转桥 `Number(peerId)`
  直接当 PeerId 用。**消息 id 不能直接透传**：归档保存服务端 id，而 tweb 的频道 / 超级群内部 mid 是
  `MESSAGE_ID_OFFSET + serverId`（例如 `128` → `4294967424`）；`bridge.ts` 必须按 peer 类型换算后再
  `setInnerPeer`，否则只会打开会话、不会滚到消息。
- **`.time` 结构**：`MessageRender.setTime` 把 `args` 塞进 `.time`（隐藏占位）再**克隆**进 `.time-inner`
  （可见层）。角标不能走 `args`（会被克隆成两份失步的状态），要走 badge.ts 的「就地增删」——对
  `.time` 和 `.time-inner` 各查 `:scope > .tweb-edt-cache` 增删改。
- **菜单 verify 静默过滤**：右键项消失先怀疑 verify 返回了假值。
- **oxlint 的 keyword-spacing 覆写**：tweb 要求 `} catch{`（catch 后不留空格）、`if(`（if 后不留空格），
  见 `.oxlintrc.json` 的 `style/keyword-spacing` overrides。
- **存量 typecheck 错误**：tweb HEAD 上 `src/tests/prepareRichMediaUpload.test.ts` 有一处
  `createElement`/`WebviewTag` 的报错（与 edt 无关，上游问题）。
- **仓库里遗留的 `.graphify_*` / `graphify-out/`**：用户对 tweb 跑过 graphify 代码分析（27852 节点图），
  属于分析工件，不参与构建。

## 6. 媒体缓存策略（2026-10-31 定稿：不用自建 tmp-media）

曾评估在 `<cache>/` 下自建一层「实时临时缓存」（tee 页面媒体字节、归档时 seed/mirror、LRU 可配），
**最终取消**，理由：tweb 浏览器侧已原生具备同等能力——

- `cachedStreamChunks`（Cache Storage，SW `stream.ts`）：流式视频分块持久缓存，键 `账号-文档id?offset=…&limit=…` 跨会话稳定；回源分块经 `saveChunkToCache` 自动沉淀，播放与归档的 stream 路径都先查它；**归档原文件命中本地 `/media` 时不写这层**，避免同一份字节重复占盘；
- `cachedFiles`（Cache Storage，≤20 MiB 整文件，`MAX_FILE_SAVE_SIZE` 门控）：`downloadMedia` 自动命中；
- 归档实现（Blob 路径走 `downloadMedia`、大文件走 stream 路由）天然骑在这两层上——**看过的部分归档不重下、补下的字节自动沉淀**，无需任何自建层。

若考虑跨工具共享（telegram-tt origin 34100 与 tweb origin 34200 的浏览器缓存互相隔离），才需要自建共享层——当前明确不做。

工具侧配套（`TwebCachePage.vue` 概览「tweb 媒体缓存」卡片）：

- **用量**：`executeJavaScript` 遍历 `caches.open('cachedFiles' / 'cachedStreamChunks' / 'cachedHlsQualityFiles' / 'cachedHlsStreamChunks')`，按响应的 `Content-Length` 头求和（控制器 `save()` 一定写该头）；
- **清理**：逐条 `cache.delete(key)`——**不要整桶 `caches.delete`**（`CacheStorageController` 缓存了 `openDbPromise`，桶被删后旧 handle 会失效）；
- **TTL**：edt 启动时一次性把 `settings.cacheTTL` 置 0（tweb 默认 86400×7 秒自动清），清理节奏由用户手动控制。

## 7. 验收对应关系（与 plan §8 的差异）

- plan 里「影库互通（同一份数据）」已按 2026-10-31 的架构修订改为**各存一份**
  （`<assets>/telegram-cache/` 与 `<assets>/tweb-cache/`）；两个工具的右栏各自读自己的库。
- 新增验收项：**已归档的消息断网后仍能在 tweb 页面直接查看 / 播放**。视频归档后必须禁用 HLS、请求原始 document 的普通 `stream/`；播放期间 `upload.getFile` 为 0，`cachedStreamChunks` 不因本地命中而增长。
- 归档成功后原媒体的浏览器整文件 / stream 分块缓存会被清理；HLS 转码缓存保留（内容不同，不能替代归档）。
- 影库删除进行中的条目会先取消归档任务；取消后不会继续 append。
- 影库自动更新：归档 API 的 `TelegramLibraryEvent` 按当前 scope 分别推送到
  `telegram-cache:event:library` / `tweb-cache:event:library`；tweb store 已有条目就地更新状态、大小、
  进度，新条目 400ms 防抖后重扫一次列表。影库行点击消息号或「定位」都会换算 mid 后跳到左侧消息。
- `tweb 媒体缓存` 用量每 5 秒静默统计一次（页面不可见时暂停）；手动清理后立即重算。
- 其余 12 条验收通用；`pnpm tweb:check` 对应 plan Step 0 的完成判据。
