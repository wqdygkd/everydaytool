# telegram-cache 模块记忆（v4：自托管 telegram-tt）

> 「Telegram 网络优化」工具的开发记忆。**改动相关文件前先读对应小节。**
> 架构版本：**v4 自托管 telegram-tt**（不再包装 `web.telegram.org`，不再注入 / CDP 捕获 / 接管查看器）。
> 方案：[telegram-cache-message-cache-plan.md](./telegram-cache-message-cache-plan.md)、
> [telegram-cache-telegram-tt-integration.md](./telegram-cache-telegram-tt-integration.md)。
> 播放与缓存复用的实现说明（归档续传 / 本地命中 / 复用矩阵 / 为什么不再边播边回写）：
> [telegram-cache-playback-reuse.md](./telegram-cache-playback-reuse.md)。
> 旧版原站包装的记忆见 git 历史；本文只描述 v4 目标形态与当前实现进度。

## 1. 定位与形态

- **前端**：`telegram-tt` 作为 git submodule（`telegram-tt/`，上游 `Ajaxy/telegram-tt`，pin `6002824b6`，12.0.48）。
  构建产物 `telegram-tt/dist/` 由主进程托管；页面 origin 是 `http://127.0.0.1:<确定端口>/`（端口落盘后固定，见 §5）。
- **接入方式**：源码层接入——`src/util/mediaLoader.ts`（媒体 URL）＋ `src/util/edt/**`（缓存/归档客户端）。
  **不做**：DOM 注入、CDP 捕获、自定义 scheme、查看器接管、对原站的 `protocol.handle` 本地响应。
- **后端**：复用对象库 / 单飞 / 配额 / SHA；新增消息目录（`messages/`）、回收站、媒体索引、影库、本地媒体服务。
- **分发**：本仓库不对外分发 → GPL-3.0 的分发义务不触发；若将来分发必须先定许可证（整仓 GPL / 独立组件）。

## 2. 一屏架构

```
telegram-tt (submodule, dist)  ←→  主进程 site-server (127.0.0.1:<确定端口>, 随机 token)
  mediaLoader.fetch: 命中本地 → /media/<mediaKey>              ├─ GET /            dist/index.html（注入 /edt-bootstrap.js）
  SW progressive 分片: 纯直通 GramJS（不查本地、不回写）        ├─ /edt-bootstrap.js  window.__EDT__={token,api,media}
  MessageContextMenu: 缓存/在文件夹中显示/移除                   ├─ /api/archive/*    prepare/append/commit/status/delete/reveal
  MessageMeta 角标: statusStore(批量 + SSE)                     ├─ /api/media/status, /api/trash/*, /events(SSE)
                                                                └─ /media/<key>?t=   本地文件流 Range/206/416
                                                      后端: message-store / trash-service / message-library / media-resolver
                                                           objects/（硬链去重） · config 索引 · assets messages/ + trash/
```

## 3. 文件地图

```
telegram-tt/（submodule）
  src/util/edt/env.ts              window.__EDT__ 读取 / 校验
  src/util/edt/cacheApi.ts         /api/*、/media/* fetch 封装（Range/分块）
  src/util/edt/pageCache.ts        读页面已下载字节（cacheApi + getFromMemory）
  src/util/edt/mediaBridge.ts      媒体键解析 / 命中本地 URL / SW 分片写回
  src/util/edt/archive.ts          归档编排（prepare→分块下载→commit）；缓存/移除/显示
  src/util/edt/statusStore.ts      消息状态（合批查询 + SSE EventSource + 乐观更新）
  src/util/edt/jump.ts             window.__EDT_JUMP_TO_MESSAGE__（影库链接→跳到该消息；启动时挂载）
  src/hooks/useEdtMessageStatus.ts 消息角标 hook
  src/util/mediaLoader.ts          接入点（Progressive/DownloadUrl/BlobUrl + SW 分片）
  src/components/middle/message/MessageContextMenu.tsx / ContextMenuContainer.tsx / MessageMeta.tsx
  src/assets/localization/fallback.strings + src/types/language.d.ts  新增 9 个 key

tools/telegram-cache/backend/
  services/site-server.ts          loopback 托管（静态 + SW 头 + /api + /media + /events + token）
  services/site-service.ts         站点生命周期（dist 检测、启动/停止、导航放行）
  services/message-store.ts        消息目录 / manifest / message.md / 硬链 / 媒体索引 / per-peer 索引
  services/archive-api.ts          归档 / 删除 / 显示 / 回收站 API
  services/trash-service.ts        回收站（移入 / 列表 / 恢复 / 清理到期）
  services/message-library.ts      影库扫描（只读）
  services/media-resolver.ts       /media/<key> 解析
  services/{observation,probe,snapshot,self-test,mtproto,…}.ts   保留；observation 自 1.8.0 起不再挂载（见 §15）
  utils/paths.ts                   messages/trash 资产层路径 + media-index
  ipc/{channels,handlers}.ts       + SITE_INFO / MSG_LIBRARY_* / TRASH_*

tools/telegram-cache/renderer/
  components/LibraryPanel.vue      影库 + 回收站 + 内置播放 + 消息链接/本地目录（library 子路由）
  pages/TelegramCachePage.vue      只加载本地站点；dist 缺失显示「未就绪」；消费 pendingJump（webview 内跳转）
  stores/telegramCacheStore.ts     + library/trash/libraryMedia 状态与动作；EVENT_LIBRARY 实时回填；pendingJump
  tabs.ts / index.ts               + library 子路由

scripts/build-telegram-tt.mjs      Node 24 检测 + npm ci + build + 产物校验
package.json                       + telegram:check / telegram:build
```

## 4. 数据模型

- 双键：`messageKey = peer:mid`（目录/角标/影库组织）；`mediaKey = photo_<id> | document_<id>`（本地 URL/去重）；
  `sha256`（完整性/对象库物理去重）。
- 目录：`<assets>/telegram-cache/messages/<peer-<peerId>>/<mid 补零 15 位>/`
  `manifest.json`（完成标记）+ `message.md`（群名/id/时间/发送者抬头 + 正文快照）+ `media/<mediaKey>.<ext>`。
- 「群 id / 消息 id / 消息内容」三级语义：前两级是目录（`peer-<群 id>`、15 位补零的消息 id），
  第三级是 `message.md`（正文与元信息快照）与 `media/<mediaKey>.<ext>`（内容按 mediaKey 命名，
  不再是 `001.jpg` 这类序号；旧目录里的序号名在下次 prepare 或影库首次加载时自动 `rename` 迁移到 mediaKey 名）。
- **没有账号层**：早期 v4 预留过 `messages/acc-<scope>/`（多 Telegram 账号隔离，`/api/archive/bind` 从未接线），
  实际永远只有一个 `acc-default`。现已删除该层：加载影库或 prepare 时 `migrateTelegramAccountLayout()`
  把 `messages/acc-*/peer-*` 上移一级并重写 media-index / messages-index 里的相对路径（幂等）。
- 进行中：`archive.meta.json` + `media/<mediaKey>.<ext>.part`（只维护连续前缀，跳写丢弃）。
- 完成：`rename` → SHA-256 → 对象库 `objects/<ab>/<sha>` 硬链（跨卷退回复制）→ 媒体索引。
- 回收站：`trash/<时间戳毫秒>_peer-<peerId>_<mid>/` + `trash.json`（原路径/删除时间/到期）。
- 索引：`config/telegram-cache/media-index.json`、`config/telegram-cache/messages-index/<peerId>.json`。
- 状态：`missing | queued | partial | complete | failed`（manifest 存在才算 complete，否则 partial）。

## 5. 托管与安全

- 同源：页面、`/api`、`/media` 同一个 `http://127.0.0.1:<port>`；CSP `default-src 'self'` 已放行，无需改 CSP。
- **确定性端口**（不是随机端口）：首选 `TELEGRAM_SITE_PORT_BASE` = 34100，在 `TELEGRAM_SITE_PORT_RANGE` = 16 个候选内
  **直接 bind**（「先探测空闲再绑定」有 TOCTOU 窗口：探测与绑定之间端口可能被抢走，origin 就又变了），
  只有 `EADDRINUSE` 才顺延到下一个，其它错误（端口越界、权限）立即抛出；实际端口写回
  `config/telegram-cache/config.json` 的 `sitePort`，下次启动从它起步。
  原因：origin 含端口 → 端口变化 = 换 origin，页面的 localStorage 登录态（GramJS auth key）、IndexedDB、
  Cache Storage、Service Worker 注册全部作废（等于每次启动重新登录 + 缓存归零）。真的发生顺延时
  `site.originChanged` / `site.portNote` 会在页面顶部与诊断面板提示「登录态已重置」。
- SW：对 `*service.worker*.js` 响应加 `Service-Worker-Allowed: /`（当前产物在 dist 根，加头防上游改路径）。
- token：32 字节随机，写进 `/edt-bootstrap.js`（`window.__EDT__`）；`/api/*` 校验 `x-edt-token`，
  `/media/<key>?t=` 校验 query token；Host/外部 Origin 校验；只绑 127.0.0.1；`Cache-Control: no-store`。
- 导航闸：只放行本地 origin + telegram 域名；外部 http(s) 走系统浏览器；webview 仍无 preload。
- 路径安全：静态路径 realpath 留在 `dist/` 内；媒体只认索引内的 mediaKey，不认路径。

## 6. 归档流程（prepare / append / commit）

1. `POST /api/archive/prepare`：幂等建目录/补齐 meta，返回逐附件 `received/expected/complete`。
2. 页面分块下载（优先页面已下载字节 → GramJS `downloadMedia(start,end)`），`POST /api/archive/append?peer=&mid=&index=&offset=`。
3. `.part` 只接受连续前缀；`complete` 或 `received>=expected` 时 finalize：rename → SHA → 对象库硬链 → 媒体索引。
4. `POST /api/archive/commit`：全部 complete 才写 `manifest.json` + `message.md`（最后一步=完成标记），清 meta/.part，更新 per-peer 索引。
5. 相册：右键任一张 → `cacheMessagesToArchive` 逐条归档（每条一个目录/manifest，`groupedId` 一致）。
6. 保护：`noforwards`/受保护消息不显示缓存入口。

## 7. 播放与复用

> 完整说明（三条通路、复用矩阵、为什么不再边播边回写、已知缺口）见
> [telegram-cache-playback-reuse.md](./telegram-cache-playback-reuse.md)。

- `mediaLoader.fetch(Progressive/DownloadUrl)`：先 `resolveEdtMediaUrl` 命中本地 → 返回 `/media/<mediaKey>?t=`；否则原 progressive。
  探测结果按 mediaKey 记住（命中永不过期，未命中 15s 后重试），所以滚动/重开不会每次渲染都发请求。
- `BlobUrl`（图片）：先 `fetchEdtBlob`（内部复用同一份探测结果，未缓存不发 GET），未命中再走 GramJS。
- **SW `requestPart` 不再碰归档**：播放/拖动只走原生 GramJS 分片（`fetchEdtPart` / `writeEdtPart` 已删除）。
  原因：本地只保存整份已完成附件，`.part` 不能按 Range 复用；且 `/media/append` 从未实现（404），
  等于每个 4MB 分片都白付一次本地往返 + 一次整块上传，同一个 origin 的连接池也被搅乱——
  这是「消息里的视频播放很卡」的直接原因。要恢复「边播边回写」需要先做 mediaKey→消息 的索引
  （只有用户主动缓存的消息才回写），属于 backlog，不要直接加回 mediaLoader。
- 页面缓存复用：`pageCache.getExistingBlob`（Cache Storage + memory blob）。
- 影库内置播放：`MSG_LIBRARY_MEDIA` 返回带 token 的媒体 URL，`LibraryPanel` 用 `UiDialog` 内 `<video>/<img>/<audio>` 播放。
- 归档侧 IO：分片追加不再逐片 fsync；`archive.meta.json` + per-peer 索引按 ~700ms 节流落盘（700ms 常量
  `META_WRITE_INTERVAL_MS`，完成仍立即写），避免缓存大视频时把磁盘 IO 打满拖慢同时进行的播放。

## 8. 状态与角标

- `statusStore`：`ensureMessageStatuses(peerId, mids)` 合批（120ms）→ `getMessageArchiveStatus`；模块内订阅。
- `MessageMeta` 用 `useEdtMessageStatus` 渲染「图标 + 文案」角标：`complete` → `archive-filled` +「Cached」；
  `partial`/`downloading`/`queued` → `archive` +「Caching xx%」（无进度时「Queued」）。文案来自
  `ContextCachedMessage` / `ContextCacheProgress` / `ContextCacheQueued` / `ContextCacheStarted`。
- 右键缓存：先把整组消息置 `queued` 并提示「Caching to local library」，结束后成功提示
  「Cached to local library」、失败提示「… (n/m)」并回落 `partial`；完成后角标随 SSE/乐观更新转「Cached」。
- SSE：后端 `archive-api` 在 prepare/append/commit/delete/restore 时广播 `msg-status`；`statusStore` 用 `EventSource('/events')` 订阅，
  事件先攒 150ms（`SSE_COALESCE_MS`）再统一通知订阅者——4MB 一片的推送逐条通知会让整列表重渲染掉帧；缓存/移除后本地乐观更新。
- 同一份状态同时以 IPC `EVENT_LIBRARY` 推给主窗口渲染层（见 §9），影库列表因此实时刷新，不必手点刷新。
- 菜单三态：未缓存 →「缓存此消息」；已缓存 →「在文件夹中显示」+「移除」。

## 9. 影库与回收站

- 影库：`MSG_LIBRARY_LIST` → `message-library` 扫描 `messages/`（只读，不访问网络），返回 peer/mid/state/大小/正文预览；
  另带 `progress`（缓存中百分比）、`senderName`、`messageLink`（`https://t.me/<用户名>/<mid>` 或
  `https://t.me/c/<内部 id>/<mid>`，私聊回落 `tg://openmessage`）、`localDir`（消息目录绝对路径）。
- 回收站：删除 = `MSG_LIBRARY_DELETE` 移入 trash；`TRASH_LIST/RESTORE/EMPTY` 列表/恢复/清理到期；恢复重建媒体索引。
- `library` 子路由表格列：时间 / 会话（第二行发送者）/ 消息 + 链接 / 状态（「已缓存」「缓存中 42%」「排队中」）/
  大小 / 附件 / 正文 / 本地目录 / 操作（播放、打开文件夹、复制链接、删除）。
- 消息链接点击 =「跳到聊天页面那条消息」：`LibraryPanel` 只调 `store.requestJump(peerId, mid)`，
  `TelegramCachePage` 监听 `pendingJump` 后用 `webview.executeJavaScript` 调页面侧
  `window.__EDT_JUMP_TO_MESSAGE__(peerId, mid)`（`src/util/edt/jump.ts` 在启动时挂载，内部
  `actions.openPrivateChannel({ id, messageId })`；会话没在页面上加载过时返回 false，界面提示先打开该会话）。
  不用 `location.hash`：`routing.ts` 只在启动时消费一次初始 hash，运行时改它不会跳转。
- 打开本地目录：列里的目录按钮 + 操作列「打开文件夹」都走 `MSG_LIBRARY_OPEN_DIR`（`shell.showItemInFolder`），
  hover 显示 `localDir` 绝对路径。
- 旧目录正名：影库首次挂载调一次 `MSG_LIBRARY_NORMALIZE`（`normalizeTelegramLibrary`），把 `media/001.jpg` 改成
  `media/<mediaKey>.jpg`、`text.md` 改写成带抬头的 `message.md`，并回写 manifest/meta 的 `relativePath`；
  幂等、只改文件名与快照、不动媒体字节，`changed > 0` 时自动重扫列表。

## 10. IPC（新增，全部窄接口）

`SITE_INFO` / `MSG_LIBRARY_LIST` / `MSG_LIBRARY_MEDIA` / `MSG_LIBRARY_DELETE` / `MSG_LIBRARY_OPEN_DIR` /
`MSG_LIBRARY_NORMALIZE` / `TRASH_LIST` / `TRASH_RESTORE` / `TRASH_EMPTY`；主进程→渲染层推送：`EVENT_LIBRARY`（`telegram-cache:event:library`，
归档状态变化时随 `msg-status` 一起广播，供影库实时更新）。
页面侧（telegram-tt / tweb）不经 IPC，走同源 `/api/*`；`archive-api` 的 `publishStatus` 同时使用
当前站点实例的 `context.broadcast('msg-status')` 与按 scope 分流的 `broadcastToWindows(EVENT_LIBRARY)`。

## 11. 数据目录分层

```
<assets>/telegram-cache/messages/<peer>/<mid>/…           资产层（clean: never）
<assets>/telegram-cache/trash/…                          资产层
<cache>/telegram-cache/objects/<ab>/<sha>                缓存层（可再生，硬链去重）
<cache>/telegram-cache/{tmp,diagnostics}/…
<config>/telegram-cache/{config,registry,media-index,messages-index,benchmarks,telegram-session.bin}
<session>/Partitions/telegram-cache/                      Chromium 会话（登录态/IndexedDB）
```

## 12. 登录、凭据与构建

- 页面登录：telegram-tt 自带登录（手机号/验证码/二步），会话存 `<session>/Partitions/telegram-cache`；`127.0.0.1` 下 passkey 不可用。
- 构建凭据：`telegram-tt/.env` 的 `TELEGRAM_API_ID/HASH`（不进 git）。
- MTProto `.env` 会话：与页面登录独立，降级为可选 headless 补档。
- 构建：`pnpm telegram:check/build`（`scripts/build-telegram-tt.mjs`），要求 Node 24/26（fnm `v24.15.0`/`v26.10.0`）。

## 13. 手工验收清单

1. 构建/托管：页面加载、登录、重启仍登录；SW 作用域 `/`。
2. 右键缓存「图片+视频+长文」：目录/manifest/message.md/媒体齐全；媒体文件名是 `<mediaKey>.<ext>`；相册整组逐条。
3. 同一媒体两条消息：`objects/` 一份；硬链磁盘增量≈0。
4. 播放已缓存视频：`<video src>` 指向 `/media/...`；进度条正常；无 CDN 请求。
5. 断网重启：已缓存可播放；影库可浏览；角标不丢。
6. 删除 → 回收站 → 恢复 → 可播放；清空到期释放。
7. 本地服务：无 token/外部 Origin/越界路径 → 401/403/404；Range 越界 → 416。
8. 切换账号不串号；关闭「保存正文」时 `message.md` 只留抬头与「（无正文）」。
9. 角标文案：缓存中显示「Caching xx%」，完成后显示「Cached」；右键通知先「Caching…」后「Cached to local library」。
10. 影库：状态列实时变化（不点刷新）；消息链接点击跳到聊天页面该消息；本地目录/打开文件夹按钮能在资源管理器定位目录。

## 14. 旧模块退役清单（G20）

已退役（v4 源码形态不再需要；文件已清空为占位，后续 git 删除）：

| 模块 | 处置 |
| --- | --- |
| `page-capture-service.ts` | ✅ 已退役（config `enablePageCapture`、能力字段、snapshot/benchmark/handlers/index 引用已移除） |
| `local-response-service.ts` | ✅ 已退役（config `localResponseEnabled`/`localMediaRangeEnabled`、能力字段、snapshot/handlers/index 引用已移除） |
| `feasibility-service.ts` + `telegram-media-adapter.ts` | ✅ 已退役（`M3_REPORT`、`TelegramFeasibilityReport` 类型、诊断面板 M3 段与 store `m3Report` 已移除） |
| `archive-service.ts`（`archive/resources/` 内容寻址归档 + MTProto 归档） | ✅ 已退役（HTTP「归档」动作、`ARCHIVE_LIST/OPEN_DIR`、`archiveRefs`、`TelegramArchiveEntry`、`archiveCount`、`archived`、`hasTelegramArchiveCopy`、`getTelegramArchiveRoot/IndexPath`、`shared/data-layers.ts` 的 `telegram-cache.archive` 与 `archive-index` 条目已全部移除；`TelegramResourceKind` 收敛为 `'cache'`） |

仍待收尾（无害残留，非阻断）：

| 模块 | 说明 |
| --- | --- |
| `cache-manager` 的本地响应计量（`servedBytes/localHits/revalidations/…`）与 benchmark/self-test 对应字段 | 本地响应已删，计量归零保留；可一并收敛为只保留观测 + 淘汰计量 |
| `TelegramServeClass`/`cacheable`/`freshUntil`（HTTP 本地复用元数据） | 无本地复用后仅作展示，无害；可保留或清除 |

验证：`pnpm typecheck`、`pnpm data-layers:check`、`node scripts/build-telegram-tt.mjs --check` 全绿。

## 15. 界面瘦身（1.8.0）

归档化之后，右侧控制台里大量 M2 时期的观测/探测界面已经没有对应能力，1.8.0 一次性清掉：

- 页签收敛为 **概览 / 进度 / 诊断 / 影库**（删掉「资源」页签与 `ResourcesPanel`；该 `.vue` 文件保留为空壳占位，
  因为本机删除受限，任何地方都不 import 它，Vite 不会打包）。原「任务」页改造为「进度」：不再展示单飞协调器的
  `tasks`（入口已随资源面板一起删掉，表永远为空），改为列影库里还没归档完的消息（`state !== 'complete'`）——
  会话 / 消息（可跳转）/ 状态 / 进度条 + 已收字节 / 正文预览 / 打开文件夹，数据来自 `EVENT_LIBRARY` 实时推送。
- 删掉的界面：诊断页的「页面能力探测」「任务协调器自检」「基准测试（M2 验收）」；概览页的
  「观测总览」「能力矩阵」「资源类型分布」「主机分布」「最近请求」，以及顶栏的「观测」开关。
- 概览页重写为三块：本地站点 / 归档概况（条数、体积、完成率、打开数据目录）/ 媒体对象库（占用、配额、淘汰、清缓存）。
  诊断页只剩 MTProto 消息下载（实验）+ 数据与配置（站点 origin、缓存配额、登录缓存目录、MTProto 会话、导出诊断包）。
- 渲染层 store 同步删掉 `traffic/resources/probe/selfTest/benchmark/tasks/observationEnabled/capabilities/stats` 及
  `setObservationEnabled/clearObservation/probePage/acquire/runSelfTest/cancelTask/start|stop|clearBenchmarks`，
  也不再订阅 `EVENT_TRAFFIC` / `EVENT_TASK` / `EVENT_BENCHMARK`（后端通道保留，只是没有消费者）。
- **后端不再挂载观测**：`backend/index.ts` 去掉了 `attachTelegramObservation()` / `setTelegramObservationEnabled()` /
  `detachTelegramObservation()`，因此不再注册 webRequest 钩子、不再产生 traffic 事件、快照里的 `stats` 恒为 0。
  服务文件（observation / probe / self-test / benchmark / download / cache-manager / resource-registry）保留，
  耦合太深、删干净收益低；将来要恢复观测只需重新接线这三处调用。
- `/media/append`、`/media/put` 这类从未实现的页面侧回写路由，已在 1.7.2 随 `mediaBridge` 重写一起删除（见 §7）。
