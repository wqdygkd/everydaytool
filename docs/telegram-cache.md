# telegram-cache 模块记忆（v4：自托管 telegram-tt）

> 「Telegram 网络优化」工具的开发记忆。**改动相关文件前先读对应小节。**
> 架构版本：**v4 自托管 telegram-tt**（不再包装 `web.telegram.org`，不再注入 / CDP 捕获 / 接管查看器）。
> 方案：[telegram-cache-message-cache-plan.md](./telegram-cache-message-cache-plan.md)、
> [telegram-cache-telegram-tt-integration.md](./telegram-cache-telegram-tt-integration.md)。
> 旧版原站包装的记忆见 git 历史；本文只描述 v4 目标形态与当前实现进度。

## 1. 定位与形态

- **前端**：`telegram-tt` 作为 git submodule（`telegram-tt/`，上游 `Ajaxy/telegram-tt`，pin `6002824b6`，12.0.48）。
  构建产物 `telegram-tt/dist/` 由主进程托管；页面 origin 是 `http://127.0.0.1:<随机端口>/`。
- **接入方式**：源码层接入——`src/util/mediaLoader.ts`（媒体 URL）＋ `src/util/edt/**`（缓存/归档客户端）。
  **不做**：DOM 注入、CDP 捕获、自定义 scheme、查看器接管、对原站的 `protocol.handle` 本地响应。
- **后端**：复用对象库 / 单飞 / 配额 / SHA；新增消息目录（`messages/`）、回收站、媒体索引、影库、本地媒体服务。
- **分发**：本仓库不对外分发 → GPL-3.0 的分发义务不触发；若将来分发必须先定许可证（整仓 GPL / 独立组件）。

## 2. 一屏架构

```
telegram-tt (submodule, dist)  ←→  主进程 site-server (127.0.0.1:0, 随机 token)
  mediaLoader.fetch: 命中本地 → /media/<mediaKey>              ├─ GET /            dist/index.html（注入 /edt-bootstrap.js）
  SW progressive 分片: 先查本地 Range, 否则 GramJS, 写回 .part   ├─ /edt-bootstrap.js  window.__EDT__={token,api,media}
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
  src/hooks/useEdtMessageStatus.ts 消息角标 hook
  src/util/mediaLoader.ts          接入点（Progressive/DownloadUrl/BlobUrl + SW 分片）
  src/components/middle/message/MessageContextMenu.tsx / ContextMenuContainer.tsx / MessageMeta.tsx
  src/assets/localization/fallback.strings + src/types/language.d.ts  新增 9 个 key

tools/telegram-cache/backend/
  services/site-server.ts          loopback 托管（静态 + SW 头 + /api + /media + /events + token）
  services/site-service.ts         站点生命周期（dist 检测、启动/停止、导航放行）
  services/message-store.ts        消息目录 / manifest / text.md / 硬链 / 媒体索引 / per-peer 索引
  services/archive-api.ts          归档 / 删除 / 显示 / 回收站 API
  services/trash-service.ts        回收站（移入 / 列表 / 恢复 / 清理到期）
  services/message-library.ts      影库扫描（只读）
  services/media-resolver.ts       /media/<key> 解析
  services/{observation,probe,snapshot,self-test,mtproto,…}.ts   保留（mtproto 降级为 headless）
  utils/paths.ts                   messages/trash 资产层路径 + media-index
  ipc/{channels,handlers}.ts       + SITE_INFO / MSG_LIBRARY_* / TRASH_*

tools/telegram-cache/renderer/
  components/LibraryPanel.vue      影库 + 回收站 + 内置播放（library 子路由）
  pages/TelegramCachePage.vue      只加载本地站点；dist 缺失显示「未就绪」
  stores/telegramCacheStore.ts     + library/trash/libraryMedia 状态与动作
  tabs.ts / index.ts               + library 子路由

scripts/build-telegram-tt.mjs      Node 24 检测 + npm ci + build + 产物校验
package.json                       + telegram:check / telegram:build
```

## 4. 数据模型

- 双键：`messageKey = peer:mid`（目录/角标/影库组织）；`mediaKey = photo_<id> | document_<id>`（本地 URL/去重）；
  `sha256`（完整性/对象库物理去重）。
- 目录：`<assets>/telegram-cache/messages/<acc-default>/<peer-<peerId>>/<mid 补零 15 位>/`
  `manifest.json`（完成标记）+ `text.md` + `media/00N.<ext>`。
- 进行中：`archive.meta.json` + `media/00N.<ext>.part`（只维护连续前缀，跳写丢弃）。
- 完成：`rename` → SHA-256 → 对象库 `objects/<ab>/<sha>` 硬链（跨卷退回复制）→ 媒体索引。
- 回收站：`trash/<时间戳毫秒>_peer-<peerId>_<mid>/` + `trash.json`（原路径/删除时间/到期）。
- 索引：`config/telegram-cache/media-index.json`、`config/telegram-cache/messages-index/<acc>/<peerId>.json`。
- 状态：`missing | queued | partial | complete | failed`（manifest 存在才算 complete，否则 partial）。

## 5. 托管与安全

- 同源：页面、`/api`、`/media` 同一个 `http://127.0.0.1:<port>`；CSP `default-src 'self'` 已放行，无需改 CSP。
- SW：对 `*service.worker*.js` 响应加 `Service-Worker-Allowed: /`（当前产物在 dist 根，加头防上游改路径）。
- token：32 字节随机，写进 `/edt-bootstrap.js`（`window.__EDT__`）；`/api/*` 校验 `x-edt-token`，
  `/media/<key>?t=` 校验 query token；Host/外部 Origin 校验；只绑 127.0.0.1；`Cache-Control: no-store`。
- 导航闸：只放行本地 origin + telegram 域名；外部 http(s) 走系统浏览器；webview 仍无 preload。
- 路径安全：静态路径 realpath 留在 `dist/` 内；媒体只认索引内的 mediaKey，不认路径。

## 6. 归档流程（prepare / append / commit）

1. `POST /api/archive/prepare`：幂等建目录/补齐 meta，返回逐附件 `received/expected/complete`。
2. 页面分块下载（优先页面已下载字节 → GramJS `downloadMedia(start,end)`），`POST /api/archive/append?peer=&mid=&index=&offset=`。
3. `.part` 只接受连续前缀；`complete` 或 `received>=expected` 时 finalize：rename → SHA → 对象库硬链 → 媒体索引。
4. `POST /api/archive/commit`：全部 complete 才写 `manifest.json` + `text.md`（最后一步=完成标记），清 meta/.part，更新 per-peer 索引。
5. 相册：右键任一张 → `cacheMessagesToArchive` 逐条归档（每条一个目录/manifest，`groupedId` 一致）。
6. 保护：`noforwards`/受保护消息不显示缓存入口。

## 7. 播放与复用

- `mediaLoader.fetch(Progressive/DownloadUrl)`：先 `resolveEdtMediaUrl` 命中本地 → 返回 `/media/<mediaKey>?t=`；否则原 progressive。
- `BlobUrl`（图片）：先 `fetchEdtBlob` 读后端，未命中再走 GramJS。
- SW `requestPart`：先 `fetchEdtPart`（Range），未命中再 GramJS，下载后 `writeEdtPart` 写回 `.part`。
- 页面缓存复用：`pageCache.getExistingBlob`（Cache Storage + memory blob）。
- 影库内置播放：`MSG_LIBRARY_MEDIA` 返回带 token 的媒体 URL，`LibraryPanel` 用 `UiDialog` 内 `<video>/<img>/<audio>` 播放。

## 8. 状态与角标

- `statusStore`：`ensureMessageStatuses(peerId, mids)` 合批（120ms）→ `getMessageArchiveStatus`；模块内订阅。
- `MessageMeta` 用 `useEdtMessageStatus` 渲染 `archive-filled`/`archive` 角标（complete/partial/downloading/queued）。
- SSE：后端 `archive-api` 在 prepare/append/commit/delete/restore 时广播 `msg-status`；`statusStore` 用 `EventSource('/events')` 订阅，断线重连；缓存/移除后本地乐观更新。
- 菜单三态：未缓存 →「缓存此消息」；已缓存 →「在文件夹中显示」+「移除」。

## 9. 影库与回收站

- 影库：`MSG_LIBRARY_LIST` → `message-library` 扫描 `messages/`（只读，不访问网络），返回 peer/mid/state/大小/正文预览。
- 回收站：删除 = `MSG_LIBRARY_DELETE` 移入 trash；`TRASH_LIST/RESTORE/EMPTY` 列表/恢复/清理到期；恢复重建媒体索引。
- `library` 子路由：搜索、播放、打开目录、删除；回收站列表/恢复/清理到期。

## 10. IPC（新增，全部窄接口）

`SITE_INFO` / `MSG_LIBRARY_LIST` / `MSG_LIBRARY_MEDIA` / `MSG_LIBRARY_DELETE` / `MSG_LIBRARY_OPEN_DIR` /
`TRASH_LIST` / `TRASH_RESTORE` / `TRASH_EMPTY`。
页面侧（telegram-tt）不经 IPC，走同源 `/api/*`；两者共用主进程校验。

## 11. 数据目录分层

```
<assets>/telegram-cache/messages/<acc>/<peer>/<mid>/…   资产层（clean: never）
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
2. 右键缓存「图片+视频+长文」：目录/manifest/text.md/媒体齐全；相册整组逐条。
3. 同一媒体两条消息：`objects/` 一份；硬链磁盘增量≈0。
4. 播放已缓存视频：`<video src>` 指向 `/media/...`；进度条正常；无 CDN 请求。
5. 断网重启：已缓存可播放；影库可浏览；角标不丢。
6. 删除 → 回收站 → 恢复 → 可播放；清空到期释放。
7. 本地服务：无 token/外部 Origin/越界路径 → 401/403/404；Range 越界 → 416。
8. 切换账号不串号；关闭「保存正文」不写 text.md。

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

验证：`pnpm typecheck`、`pnpm check:ui`、`pnpm data-layers:check`、`node scripts/build-telegram-tt.mjs --check` 全绿。
