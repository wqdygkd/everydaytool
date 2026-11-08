# tweb-cache 模块记忆（tweb 前端的 Telegram 归档）

> 本文记「实现落点 + 为什么这么放 + 升级 tweb 时怎么重放」。

## 0. 一句话

`tweb-cache` 是**独立工具**（独立卡片 / 路由 / 后端 / 端口 34200 / IPC `twebCache` / 分区
`persist:tweb-cache` / 数据 `<assets>/tweb-cache`），页面端是 **tweb（Telegram Web K，Solid.js）**，
归档引擎自包含在 `tools/tweb-cache/backend/archive/`。页面侧在 `tweb/src/helpers/edt/**` 加一层归档客户端，
并在 tweb 源码中保留少量单点接线。

## 1. 页面侧客户端（tweb/src/helpers/edt/）

| 文件 | 职责 | 要点 |
| --- | --- | --- |
| `types.ts` | HTTP 契约类型 | 与 `shared/media-archive.ts` 的归档 HTTP 契约对齐 |
| `env.ts` | 双上下文引导 + `edtFetch` | 页面读注入的 `window.__EDT__`；worker / SW 通过一次性 query 重取 `/edt-bootstrap.js`；**401 时自动换 query 刷新 token**（tweb 的 SW 对带扩展名同源 URL 是 cache-first，`no-store` 头救不了它） |
| `api.ts` | 5 条归档 HTTP（prepare/append/commit/status/delete/reveal） | peer 是**字符串数字**（tweb 的 PeerId = 带符号 number，`String()` 后即归档命名空间） |
| `statusStore.ts` | 状态 Map + SSE + 订阅 | 120ms 批量拉取 / 150ms SSE 合流 |
| `archive.ts` | `cacheMessageToArchive` 流水线 | 全局最多 2 个归档任务并发（可取消 FIFO 队列），同一消息同时只跑一个任务；≤20 MiB 走 `appDownloadManager.downloadMedia`（整份 Blob）；更大走 SW `stream/` 路由按 Range 分块（45s 超时、断点续传靠后端 `.part`）；照片必须选最大可用 `PhotoSize` 并作为 `thumb` 传入，否则 tweb 会拒绝下载；`getServerMessageId(mid)` 一律先转服务端 id；成功后清理原媒体的 `cachedFiles` / `cachedStreamChunks` |
| `bridge.ts` | `window.__EDT_JUMP_TO_MESSAGE__` | `apiManagerProxy.getPeer` 判空；频道 / 超级群把服务端 id 转为 `MESSAGE_ID_OFFSET + id` → `appImManager.setInnerPeer({peerId, lastMsgId})`；会话没加载返回 `false` |
| 取消 / 删除 | `cancelArchiveFor` + `__EDT_CANCEL_ARCHIVE__` | 活跃归档用 `AbortController`；影库删除和右键移除先取消，再做后端 trash/delete，避免删除后被 append 重建 |
| 缩略图补齐 | `__EDT_BACKFILL_THUMBNAILS__` | 工具页把缺少缩略图的 complete 条目传给 tweb；tweb reload 对应消息、下载原始 thumbnail、POST `/archive/thumbnail`；按 peer/mid 去重，消息不可达时跳过 |
| `ui/badge.ts` | 时间行角标 | 挂在 `MessageRender.setTime` 的产物上（`.time` 与 `.time-inner` 各一份）；statusStore 任何变更全量重刷活着的时间行（内容比对去抖） |
| `ui/mediaBadge.ts` | 媒体角标 | 挂在照片 / 视频气泡（`.attachment`）与相册单块（`.album-item[data-mid]`）右上角：绿勾 / 转圈 / 暂停条 / 时钟 / 叹号；`pointer-events: none`，不挡点击与播放 |
| `ui/menu.ts` | 右键菜单 3 项 | 纯工厂（`setButtons()` 每次重建）；verify 为假会被静默过滤，可读状态在这里判 |
| `archiveStatus.ts` | 归档状态 + 本地 Range | 页面 / SharedWorker / ServiceWorker 共用；`/api/media/status` 正向命中缓存 5 分钟、未命中只缓存 2 秒；归档完成 / 删除经 `BroadcastChannel('edt-archive-media')` 主动失效；`/media/<mediaKey>` 支持 Range/206 |
| `archivedMedia.ts` | **requestFilePart 兜底短路** | `apiFileManager.requestFilePart` 在 shared worker 执行（`index.worker-*.js`）；已归档 → 从 `archiveStatus` 读本地 Range 并合成 `upload.file`；视频只认全尺寸 location，照片可复用最大尺寸归档；任何错误回落 Telegram |
| `index.ts` | `startEdt()` 入口 | 装跳转桥 + 角标 + 归档媒体追踪；**一次性把 tweb 的 `cacheTTL` 置 0**（tweb 默认 7 天自动清媒体缓存，`config/state.ts:607`；`localStorage` 标记防止重复覆盖） |

## 2. 工具壳与右栏（tools/tweb-cache/**）

| 文件 | 职责 |
| --- | --- |
| `backend/services/site-service.ts` | 起独立回环站点；固定端口 / origin；`tweb/dist` 缺失只影响本工具 |
| `backend/archive/**` | 站点托管、消息级缓存、影库、回收站与媒体解析（归档默认 `<assets>/tweb-cache/`，可单独自定义） |
| `backend/ipc/{channels,handlers}.ts` | `twebCache` 独立 IPC；只做参数校验并转调本工具归档引擎 |
| `renderer/stores/twebCacheStore.ts` | 站点 / 影库 / 回收站状态；订阅 `EVENT_LIBRARY`，已有条目就地更新，新条目 400ms 防抖重扫 |
| `renderer/pages/TwebCachePage.vue` | webview + 概览 / 影库 / 回收站；影库列顺序 `会话 / 消息 → 消息 ID → 预览 → 大小 → 状态 → 操作`，会话列按组 `rowspan` 合并；表格 `max-height: min(560px, calc(100vh - 300px))`；消息号与「定位」按钮跳转消息；右栏可拖拽调宽并缓存开合 / 宽度 |
| `renderer/ipc.ts` | 唯一 `createIpcHelpers('twebCache')` 实例 |

影库右栏不复制播放器：播放统一在左侧 tweb 会话内完成，避免第二套媒体 UI 和 token 暴露面。

归档事件由 `tools/tweb-cache/backend/archive/api.ts` 统一推送到 `tweb-cache:event:library`。

### 2.1 归档目录单独自定义

- 默认位置仍是 `<assets>/tweb-cache`；概览页「本地归档」可点「更改…」选择任意空目录。
- 自定义值存在 `<config>/tweb-cache/config.json` 的 `archiveDir`（绝对路径，`null` = 默认）。
- 只有 `messages/` 与 `trash/` 跟着走；`media-index.json` / `messages-index/` 仍在配置层，
  `objects/` / `tmp/` / `diagnostics/` 仍在缓存层，索引里的相对路径不变。
- 切换时整体迁移两个目录（跨盘退化为复制成功后才删源）；任一步失败会回滚已移动条目，
  配置只在全部成功后才写入。目标必须为空，不会覆盖已有文件。
- 「恢复默认」把归档迁回 `<assets>/tweb-cache`；目标里有同名非空目录时拒绝合并。
- 自定义目录不再位于资产根下，因此备份包的资产清单不会收录它（清单只遍历 `getAssetsRoot()`）。

### 2.2 转发 / 同内容副本的已缓存识别

消息缓存仍按 `(peerId, messageId)` 各存一份，但「已缓存」判定会把内容等价的消息合并：

- **精确转发链接**：频道帖 / 收藏消息的 `fwd_from` 带源 peer 与源消息 id，
  缓存任意一侧后，另一侧都返回 `complete`，并带回实际承载缓存的 `resolved`。
- **内容签名**：排序后的媒体 key（`photo_<id>` / `document_<id>`）+ 正文字符数。
  转发不会改变 photo/document id，所以用户之间的转发（协议不提供源消息 id）也能互相命中；
  只有带媒体的消息参与签名，纯文本消息仅靠精确链接，避免同长度文本误判。
- 索引在 `<config>/tweb-cache/archive-alias.json`，随提交 / 删除 / 回收站恢复增量维护，
  `normalizeLibrary` 时按完整 manifest 全量重建（旧归档首次打开即可补齐）。
- 状态接口为 `POST /api/archive/status`，页面附带 `forwardSource` / `mediaKeys` / `textChars`；
  返回的 `via` 为 `direct | source | forward | media`，`resolved` 指向真实缓存目录。
- 角标文案仍是「已缓存」，悬停提示说明来源；等价命中时右键「在文件夹中显示」打开真实副本，
  「移除缓存」只对本条自己的目录开放，避免误删别人的缓存。
- 已知边界：转发的源消息在转发后被编辑（尤其替换媒体）不会自动追踪；
  纯文本的用户间转发没有源消息 id，无法与原文关联。

影库展示：

- 列顺序固定为 `会话 / 消息 → 消息 ID → 预览 → 大小 → 状态 → 操作`。第一列是合并列（`UiTable` 的 `span-method`）：同一 `groupedId` 只渲染一次群名，多行时副标题为「相册 · N 条」；组内每行仍显示自己的消息 ID，定位 / 删除按行生效。
- 缩略图优先读 manifest 里保存的 `thumb_<mediaKey>`；旧照片回退到主媒体，视频没有独立缩略图时不回退主文件。
- 进入影库时自动补齐旧视频缩略图；成功后刷新影库，消息不可达 / 无 thumbnail 的条目跳过。
- 完成时间 `savedAt` 与转发来源只存在 manifest / message.md，不在表格里重复展示；表格只保留分组、消息 ID、预览、大小、状态、操作。

右栏宽度与开合：

- `ToolSideInspector` 的拖拽条落在面板内侧边缘，命中区 8px、可见线 2px；键盘 `←` / `→` 微调 16px，`Shift` 为 48px。
- 宽度范围 `320–720px`，默认 `360px`；同时受主工作区 `280px` 最小宽度约束，窗口变窄时显示宽度自动收敛，但不会覆盖已保存的偏好。
- 开合状态与宽度缓存在 `localStorage` 的 `twebCache.inspector`：`{ open, width }`。首次打开且无记录时，概览页默认收起，影库 / 回收站默认展开；之后以用户最后一次开合为准。

### 2.2.1 缓存状态语义（`partial` ≠ 正在缓存）

- `downloading` 只存在于本次进度事件（prepare 推送 + 页面 `reportProgress` / SSE），**不落盘**；
  `messages-index` 与 `archive.meta.json` 里从来不会有这个状态。prepare 之后立刻就推
  `downloading`，否则 blob 下载（首片 append 之前）会一直停在「部分缓存」。
- `partial` 是「未完成」：上次中断、已写部分字节、或 commit 时附件没齐。App 被杀掉后重启，
  状态查询只会返回 `partial`（若有正文/附件快照）或 `queued`，不会凭空继续显示在下载。
- 所以两个 UI 的文案必须分开：`downloading` → 缓存中 x%（tweb 角标 `Caching %s%%`），
  `partial` → 部分缓存 x%（tweb 角标 `Partially cached %s%%`）。把 `partial` 说成「缓存中」
  会让「App 突然关闭」后的残留状态永远显示成正在缓存。
- 影库「继续缓存」按钮走 `window.__EDT_RESUME_CACHE__(peerId, mid)`：tweb 取本地消息
  （没有就 `reloadMessage`）重跑 `cacheMessageToArchive`，prepare 会带 `.part` 已写字节数，
  下载从该偏移继续；tweb 右键菜单在 `partial` 时文案同样变成「继续缓存」。
- 影库「全部暂停」走 `window.__EDT_PAUSE_ALL_ARCHIVE__`：abort 页面里所有活跃 Controller，
  `.part` / meta 原样保留（之后可继续缓存）；同时清掉还没开始的「排队中」角标，
  并阻止相册批次继续启动下一条。工具侧收到结果后清空「正在下载」集合、重扫影库。
- 影库的「正在下载」是渲染层事件集合（`twebCacheStore` 的 `activeArchives`）：扫描结果本身
  只有 `partial`，重扫时用集合覆盖；45s 没新进度自动回落 `partial`，避免失败后一直显示缓存中。
- 归档任务全局最多 2 个并发：`archive.ts` 在进入 prepare 前排队，超出的任务保持 `queued`；
  「全部暂停」、单条删除和工具关闭都会 abort 排队中的任务。该上限只约束 EDT 归档，不影响正常播放下载。

### 2.3 群目录名（username + peer id）

`messages/` 下的第一级目录名由 `backend/archive/peer-dirs.ts` 决定，只有两种形态：

- 有 username：`<username>-peer-<peerId>`，例如 `https://t.me/wqdyasmr` →
  `wqdyasmr-peer--1234567890/`（频道 peerId 是负数，所以 `peer-` 后面会出现两个横线）；
- 没有 username（私聊 / 私有群 / 收藏夹）：`peer-<peerId>/`。

username 只用于浏览时辨认，**真实身份永远是 peer id**：

- 映射存在 `<config>/tweb-cache/peer-dirs.json`
  （`{ schemaVersion, peers: { [peerId]: { dir, username, title } } }`）；
  状态查询、删除、回收站恢复只拿得到 peer id，必须靠这张表离线定位目录。
- **username 变化会跟着改名**（`old-peer--123` → `new-peer--123`）。因为名字里带 peer id，
  改名不会撞到别的会话；改名只做一次目录 `rename` + 重写 `media-index.json`，**不再逐条改写 manifest**。
- manifest / `archive.meta.json` 里的附件路径是**相对消息目录**的 `media/<file>`；
  旧归档里的完整 `messages/<peerDir>/<mid>/media/<file>` 仍可解析，`normalizeLibrary` 会顺手改成短路径。
- 目录名不再加 `-2` / `-n<id>` 之类后缀：不同 peer 的目录名不可能相同。
- **旧归档自动迁移**：`peer-<id>`、早期 username-only（`wqdyasmr/`）、标题 slug、手工改名目录，
  首次 `prepare` / `normalizeLibrary` 时收敛到规范名；多个目录并存则逐消息合并，
  同名消息保留规范目录那份，空目录删除。`acc-<scope>/` 上移时也直接落到已登记的目录名。
- 极端情况：规范目录已存在但内容属于另一个 peer（手工复制 / 冲突）时不合并，退回裸 `peer-<id>`
  并写 warn 日志。
- 影库扫描不再只认 `peer-*`：目录名先经登记表 / `peer-` 前缀 / manifest 反查得到 peer id。
- 回收站目录名仍是 `<时间>_peer-<id>_<mid>`（内部标识，按 peer id 去重恢复，与可读目录名无关）。

## 3. tweb 源码触点（升级时的重放清单）

| 文件 | 改动 |
| --- | --- |
| `src/index.ts` | `DOMContentLoaded` 钩子里 `rootScope.managers = getProxiedManagers()` 之后：`void import('@helpers/edt/index').then((edt) => { edt.startEdt(); }).catch(noop)` —— fire-and-forget，不推迟首帧 |
| `src/components/chat/contextMenu.ts` | ①顶部 `import {getEdtCacheMenuButtons} from '@helpers/edt/ui/menu'`；②`setButtons()` 的普通消息分支里，`Message.Context.Selection.Delete` 项之后、`...getSponsoredMessageButtons({` 之前插入 `...getEdtCacheMenuButtons({getMessage, getGroupedMessages, getIsProtected, getQueueId})` |
| `src/components/chat/messageRender.ts` | ①顶部 `import {edtApplyCacheBadge} from '@helpers/edt/ui/badge'`；②`setTime` 末尾 `return timeSpan;` 之前一行 `edtApplyCacheBadge(timeSpan, message, options.middleware)` |
| `src/components/chat/bubbles.ts` | ①顶部 `import {edtApplyMediaCacheMarks} from '@helpers/edt/ui/mediaBadge'`；②`renderMessage` 里媒体开关结束、`if(noAttachmentDivNeeded)` 之后：`context.attachmentDiv` 存在且 `messageMedia` 是 photo / document 时调 `edtApplyMediaCacheMarks(context.attachmentDiv, message as MyMessage, middleware)`（相册按 `data-mid` 分块挂，圆形视频在模块内排除） |
| `src/lib/appManagers/apiFileManager.ts` | ①顶部 `import {edtInterceptFilePart} from '@helpers/edt/archivedMedia'`；②`requestFilePart` 方法体整体包进 `const request = () => {...}`（原 downloadRequest 路径原样保留），结尾 `return edtInterceptFilePart(location, offset, limit, request)`。**注意**：回落必须在 hook 链内调用 fallback（不能让 hook resolve 成 undefined 再在调用方判断——那会把所有全尺寸媒体短路成空结果） |
| `src/components/mediaViewer/base.ts` | ①顶部 import `isArchivedDocument`；②视频 `load()` 在计算 `isHlsStream` 前检查原始 document 是否已归档，命中则清空 HLS 质量菜单并强制走普通 `stream/`；原始文件归档后绝不能继续请求转码 document |
| `src/components/mediaPeek/renderMedia.ts` | 同上：视频 peek 在 `wrapVideo` 前检查归档态，命中时 `hlsStreaming: false` |
| `src/lib/serviceWorker/stream.ts` | 普通 `stream/` 在 Cache Storage miss 后、MTProto 前调用 `readArchivedMediaRangeForLocation`；本地命中直接返回字节，不写 `cachedStreamChunks`（归档资产已是持久副本），仍保留 `tryPatchMp4` |
| `src/lang.ts` | 末尾新增 14 个 `TelegramCache.*` 键（占位符是 `%s`） |
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

- **PeerId 空间**：tweb 的 `PeerId = number`（`global.d.ts:128`），频道/群是负数（没有 `-100` 前缀），
  用户是正数。归档目录名里的 `peer-<id>` 用这套 PeerId；跳转桥 `Number(peerId)` 直接当 PeerId 用。
  **消息 id 不能直接透传**：归档保存服务端 id，而 tweb 的频道 / 超级群内部 mid 是
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

当前只有 tweb 一个归档前端（origin 34200），不需要跨工具共享层。

工具侧配套（`TwebCachePage.vue` 概览「tweb 媒体缓存」卡片）：

- **用量**：`executeJavaScript` 遍历 `caches.open('cachedFiles' / 'cachedStreamChunks' / 'cachedHlsQualityFiles' / 'cachedHlsStreamChunks')`，按响应的 `Content-Length` 头求和（控制器 `save()` 一定写该头）；
- **清理**：逐条 `cache.delete(key)`——**不要整桶 `caches.delete`**（`CacheStorageController` 缓存了 `openDbPromise`，桶被删后旧 handle 会失效）；
- **TTL**：edt 启动时一次性把 `settings.cacheTTL` 置 0（tweb 默认 86400×7 秒自动清），清理节奏由用户手动控制。

## 7. 验收对应关系（与 plan §8 的差异）

- 影库数据固定落在 `<assets>/tweb-cache/`，右栏只读本工具的库。
- 新增验收项：**已归档的消息断网后仍能在 tweb 页面直接查看 / 播放**。视频归档后必须禁用 HLS、请求原始 document 的普通 `stream/`；播放期间 `upload.getFile` 为 0，`cachedStreamChunks` 不因本地命中而增长。
- 归档成功后原媒体的浏览器整文件 / stream 分块缓存会被清理；HLS 转码缓存保留（内容不同，不能替代归档）。
- 影库删除进行中的条目会先取消归档任务；取消后不会继续 append。
- 影库自动更新：归档 API 的 `ArchiveLibraryEvent` 统一推送到 `tweb-cache:event:library`；tweb store 已有条目就地更新状态、大小、
  进度，新条目 400ms 防抖后重扫一次列表。影库行点击消息号或「定位」都会换算 mid 后跳到左侧消息。
- `tweb 媒体缓存` 用量每 5 秒静默统计一次（页面不可见时暂停）；手动清理后立即重算。
- 其余 12 条验收通用；`pnpm tweb:check` 对应 plan Step 0 的完成判据。
