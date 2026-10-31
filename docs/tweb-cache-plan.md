# tweb-cache 实现方案（以 tweb 为前端的 Telegram 归档工具）

> 目标读者：后续实现与验收的人（或下一轮 agent）。
> 关联文档：[telegram-cache.md](./telegram-cache.md)（现有工具：目录格式 / 归档协议 / 影库 / 验收）、
> [telegram-cache-playback-reuse.md](./telegram-cache-playback-reuse.md)（播放与复用语义）、
> [telegram-cache-telegram-tt-integration.md](./telegram-cache-telegram-tt-integration.md)（页面侧接法参照）。

## 0. 结论先行

新增工具 **`tweb-cache`**：页面端换成 **tweb（Telegram Web K，Solid.js，`D:\project\everydaytool\tweb`）**，
由主进程用**独立回环端口**托管其构建产物；页面侧在 `tweb/src/helpers/edt/**` 增加归档客户端、
播放本地化和 UI 触点。归档**实现**复用 telegram-cache 的引擎，**数据**按 scope 独立保存：

```
<assets>/tweb-cache/messages/<群 id>/<消息 id 补零 15 位>/{manifest.json,message.md,media/<mediaKey>.<ext>}
```

因此归档协议、目录格式、回收站和媒体解析复用同一套代码；影库内容与 telegram-cache 互不混合。

> ⚠️ 架构已按「两个工具必须相互独立」修订，见 **§0.1**：tweb-cache 是独立工具（独立首页卡片 / 路由 / 后端 / 端口 `34200` / IPC 命名空间 `twebCache` / 分区 `persist:tweb-cache` / 数据命名空间 `tweb-cache`），
> 只通过平台层契约 `backend/telegram-archive/engine.ts` 复用**归档实现**，不共享数据或后端进程内状态。

- 复用面：归档实现（prepare/append/commit + 对象库 + 索引）、`/media` 本地流、回收站、影库扫描（经平台层契约取用，数据按 scope 分开）。
- 新增面：tweb 站点托管（本工具自己的站点实例）、tweb 页面侧 edt 客户端、tweb 的右键项与角标、`tweb-cache` 工具壳与右栏。

## 0.1 架构修订（2026-10-31：两个工具必须独立）

用户明确要求「增加一个新的工具在首页，两个工具相互独立」，因此放弃 §4.1 的方案 A（单后端双站点），改为：

- **工具身份独立**：首页独立卡片、独立路由 `/tools/tweb-cache`、独立页签（概览 / 影库）、独立版本号；
- **后端独立**：`tools/tweb-cache/backend/**` 自带站点生命周期、配置（`config/tweb-cache/config.json`）与 IPC 命名空间 `twebCache`；
- **运行期独立**：独立回环端口（`TWEB_CACHE_SITE_PORT_BASE = 34200`）、独立 webview 分区 `persist:tweb-cache`；tweb `dist` 缺失只影响本工具；
- **数据也独立**（2026-10-31 二次确认）：tweb-cache 写自己的 `<assets>/tweb-cache/messages`、`<assets>/tweb-cache/trash`、`<cache>/tweb-cache/{objects,tmp,diagnostics}`，配置在 `<config>/tweb-cache/config.json`；两个工具的影库互不串味。
- **唯一共享**：归档的**写入逻辑**（同一份代码，不同存储命名空间）。为不违反「工具之间不互相 import backend」，用**平台层契约 + 注册表 + 作用域**：

```
backend/telegram-archive/engine.ts     平台层：ArchiveEngine 接口（每个方法带 scope）+ 注册表
backend/telegram-archive/scope.ts      作用域：AsyncLocalStorage + 串行队列（runInArchiveScope / runSyncInArchiveScope）
tools/telegram-cache/backend/services/archive-engine.ts
                                       实现并在 initialize 时注册
tools/telegram-cache/backend/utils/paths.ts
                                       toolId() = 当前作用域（默认 telegram-cache）→ 同一套存储代码服务两个命名空间
tools/tweb-cache/backend/**            每次调用传 scope='tweb-cache'
electron/tool-registry.ts              telegramCacheBackend 必须排在 twebCacheBackend 之前（先注册引擎）
```

  为什么用 AsyncLocalStorage 而不是全局变量：作用域按异步调用链传递，`tweb-cache` 的操作不会把
  `telegram-cache` 正在跑的任务带到错目录；同步路径拼接用 `runSyncInArchiveScope`（不进队列）。
  `site-server.ts` 新增 `extraRootDir`（tweb 的 `public/` 是 dist 之外的第二个静态根），站点实例内的
  `resolveMedia` / `getMediaStatus` / `handleApi` 都在建站时的 scope 里执行。

## 0.2 实施进度

| 步骤 | 状态 |
| --- | --- |
| Step 0 tweb 构建产物（`pnpm install` + `vite build`） | ✅ `scripts/build-tweb.mjs`（fnm 自动找满足 engines 的 Node + corepack pnpm 11.16；`pnpm tweb:check` / `tweb:build`） |
| Step 1 shared 常量 / 分区 / 数据层 | ✅ `shared/tweb-cache.ts`、`shared/webview.ts`、`shared/data-layers.ts` |
| Step 2 后端（独立站点 + IPC + 引擎注册） | ✅ `backend/telegram-archive/engine.ts`、`tools/telegram-cache/backend/services/archive-engine.ts`、`tools/tweb-cache/backend/**`、`electron/{ipc-namespaces,tool-registry}.ts` |
| Step 3 tweb 页面侧归档客户端 `src/helpers/edt/**` | ✅ `tweb/src/helpers/edt/{types,env,api,statusStore,archive,bridge,index}.ts` + `ui/{badge,menu}.ts`；typecheck 零新增 / oxlint 0 错误 / vite build 通过 |
| Step 4 tweb UI 触点（右键 / 角标 / 文案 / 图标） | ✅ `contextMenu.ts` 插入 3 项、`messageRender.ts` 挂角标、`lang.ts` 10 键、`scss/partials/_edtCache.scss` |
| Step 5 跳转桥 `window.__EDT_JUMP_TO_MESSAGE__` | ✅ `bridge.ts`（`apiManagerProxy.getPeer` 判空 + `hotReloadGuard.appImManager.setInnerPeer`）+ `index.ts` 启动挂载 |
| Step 6 工具壳与右栏 | ✅ 首页卡片 + 页面（webview + 概览 / 影库 / 回收站） |
| Step 7 构建脚本 / 打包 / 模块记忆 | ✅ `scripts/build-tweb.mjs` + `pnpm tweb:{check,build}` + `docs/tweb-cache.md` + AGENTS.md 定位表 |
| Step 8 验收 | ✅ 核心链路已实测：登录持久化、归档、照片 / 视频、离线本地流、影库定位、自动刷新、事件进度；12 条清单保留作回归 |

## 1. 目标与不变量

| 维度 | 约束 |
| --- | --- |
| 工具身份 | 新工具 id `tweb-cache`，独立首页卡片 / 页签 / 路由（`/tools/tweb-cache`）；**不改动 `telegram-cache` 的对外行为** |
| 实现单一 | 归档代码只保留一份；manifest / `media-index` / `messages-index` 由同一存储层按 tool scope 分别维护 |
| 前端隔离 | tweb 独占一个回环端口 + `persist:tweb-cache` 分区：两个 PWA 的 SW scope 都是 `/`，同源会互相接管 fetch；origin 变化还会清空登录态 |
| 页面侧改动受控 | 只在 tweb 内新增 `src/helpers/edt/**`，核心渲染 / MTProto / 存储代码只做必要单点接线（触点清单见 §3） |
| 数据分层 | 配置、归档、对象库、临时目录均落在 `tweb-cache.*` 数据层条目下 |

## 2. 现有实现里「哪些能直接复用」

| 能力 | 现有实现 | tweb-cache 是否复用 |
| --- | --- | --- |
| 本地站点（静态 + `/api` + `/media` + `/events` + token + 206/416） | `tools/telegram-cache/backend/services/site-server.ts` | ✅ 复用，起第二个实例（不同 rootDir / port） |
| 归档协议 | `services/archive-api.ts`（prepare/append/commit/status/delete/reveal + trash） | ✅ 原样复用（同源 HTTP，与前端无关） |
| 目录 / manifest / message.md / 对象库硬链 | `services/message-store.ts` | ✅ 原样复用 |
| 影库扫描（含 `messageLink` / `localDir` / `progress`） | `services/message-library.ts` | ✅ 原样复用 |
| 回收站 | `services/trash-service.ts` | ✅ 原样复用 |
| 本地媒体流 | `services/media-resolver.ts` | ✅ 原样复用 |
| 归档 IPC 契约 | `telegram-cache/ipc/{channels,handlers}.ts` | ✅ 参照实现，落到 `tweb-cache` 自己的通道与 scope |
| 渲染层右栏（影库 / 进度 / 概览） | `telegram-cache/renderer/{components,stores}` | ⚠️ **移植为 tweb-cache 自己的 store/page**，不跨工具 import 组件 |
| 页面侧归档客户端 | `telegram-tt/src/util/edt/**` | ⚠️ **移植到 `tweb/src/helpers/edt/**`**：HTTP 契约不变，取数与 UI 换成 tweb API |

> 结论：后端几乎零新增（只多一个站点实例和一条 IPC），工作量集中在 **tweb 页面侧** 与 **新工具壳**。

## 3. tweb 源码分析与触点

> 行号以 2026-10-30 的本地克隆为准。tweb 的 `AGENTS.md` 有几条硬规矩会直接影响这几处改动（§3.9）。

### 3.1 消息渲染：角标插在哪

消息的「时间/元数据行」是 DOM 拼装，唯一出口是：

```ts
// tweb/src/components/chat/messageRender.ts:226
export namespace MessageRender {
  export const setTime = (options: {chat, chatType, message, groupedMessagesCount?, reactionsMessage?, isOut, middleware, loadPromises?}) => {
    const args: (HTMLElement | string)[] = [];   // :239  ← 这里 push 进去的每个节点都进时间行
    ...
    const timeSpan = document.createElement('span');
    timeSpan.classList.add('time');               // :374-377
    timeSpan.append(...args);
    const inner = document.createElement('div');
    inner.classList.add('time-inner');            // :379-381
```

- **注意两处副本**：`args`（:239）会被 append 到 `.time`（隐藏占位，撑宽度），随后在 :407-414 **克隆**一份 append 到 `.time-inner`（真正可见）。所以往 `args` 里塞节点是错的 —— 会被克隆成两份状态副本。
- **正确做法（照抄 tweb 自己的角标写法）**：写一个 `setBubbleCacheStatus(bubble, status | undefined)`，对 `.time, .time-inner` 各做一次就地增删：

```ts
// 模板：src/components/chat/bubbles.ts:8449-8463  setBubblePinned（同样的形状还有 :8419 setBubbleSendingStatus、:8465 setBubbleRepliesCount）
bubble.querySelectorAll('.time, .time-inner').forEach((element) => {
  const badge = element.querySelector(':scope > .tweb-edt-cache');
  if(!status) { badge?.remove(); return; }
  if(!badge) {
    const span = document.createElement('span');
    span.classList.add('tweb-edt-cache');
    span.append(Icon(status.state === 'complete' ? 'archive_filled' : 'archive', 'time-icon'), status.text);
    (element.querySelector(':scope > .time-replies') || element).after(span);   // 或 prepend
  } else { badge.replaceChildren(...); }
});
```
- **拿到 bubble**：`chat.bubbles.getBubble(peerId, mid)`（`bubbles.ts:8034-8043`，按 `makeFullMid(peerId, mid)` 查 `this.bubbles`）。
- **重渲染兜底**：时间行会在消息更新时整体重建（`bubbles.ts:8840` 再调 `MessageRender.setTime`，`:10236-10252` 重新挂载），而 tweb 自用的重挂载钩子 `appendBubbleTime` / `bubble.timeAppenders` 是**模块私有**（`bubbles.ts:761`，不在 `:299-531` 的导出表里）。因此外部注入只有两条路：①patch `ChatBubbles.prototype` 的相关方法；②在 `.bubble` 上挂 `MutationObserver`（观察 `childList`），重建后补回 badge。**不要**指望 `setTime` 里塞节点能持久。
- **样式**：`.time` 内的元素尺寸受气泡尾部排版约束，badge 用 `display: inline-flex; align-items: center; gap: 0.125rem; font-size: 0.75rem`，与 `.time-icon` 同级即可；SCSS 走 `src/scss/partials/` 而不是内联样式（tweb 不用 CSS-in-JS）。
- **不要**改成 Solid 组件：`.time` 行是纯 DOM，混入 JSX 要改渲染管线（`bubbles.ts` 里 `renderMessage`）。

### 3.2 右键菜单：怎么加一项

消息右键菜单是 `src/components/chat/contextMenu.ts` 的 `ContextMenu` 类，条目就是一个数组：

```ts
// tweb/src/components/chat/contextMenu.ts:798  setButtons()
private setButtons() {
  ...
  this.buttons = [{
    icon: 'download',
    text: 'DownloadMedia',            // LangPackKey
    onClick: () => {...},
    verify: () => !!getMediaFromMessage(this.messageFromLog)   // 可见性判定（可 async）
  }, ...];
}
// :746 filterButtons() 会 await 每个 button 的 verify()
```

- **插入点**：`setButtons()` 的「普通消息」分支是 `this.buttons = [ ... ]`（`:968` 开始，`:1531` 结束），把我们的 3 项插在 `Message.Context.Selection.Delete` 之后、`...getSponsoredMessageButtons({` 之前（`contextMenu.ts:1498-1519` 之间）。
- 菜单项可用字段（`ChatContextMenuButton = ButtonMenuItemOptions & {verify, notDirect?, withSelection?, isSponsored?}`，`contextMenu.ts:109-118`；基类型 `src/components/buttonMenu.ts:35-70`）：`{icon, text: LangPackKey, onClick, verify, className?}`。
- 处理器可读的现成字段（`prepareForMessage` 在 `init()` 前已填好）：`this.peerId`（:219）、`this.mid`（:220）、`this.message`（:221）、`this.bubble`（:254）。
- `verify` **必须返回真值**否则整项被静默过滤（`filterButtons` → `verifyMenuItem`），且只在主线程跑，可以读页面侧缓存状态。

### 3.3 身份与身份转换：peer / message / 媒体

| 要什么 | tweb 里怎么拿 |
| --- | --- |
| 消息对象 | 菜单里是 `this.message`（`Message.message`）；`MessageRender.setTime` 里是 `options.message`；气泡 DOM 上可通过 `bubbles.contexts` 取回 |
| 会话 id | `message.peerId`（number）。`peer_id._` 为 `peerChannel` / `peerChat` / `peerUser` |
| 消息 id | `message.mid`。**归档/链接一律用 `getServerMessageId(mid)`**（`src/lib/appManagers/utils/messageId/getServerMessageId.ts`）——tweb 的内部 `mid` 对本地/待发消息有偏移，直接存会与 Telegram 对不上 |
| 媒体 | `getMediaFromMessage(message, true, index)`（`src/lib/appManagers/utils/messages/getMediaFromMessage.ts:5`）；返回 `Photo.photo` 或 `Document.document` |
| 媒体 key | `getThumbKey(media)` → `'photo'+id` / `'document'+id`（`src/lib/storages/utils/thumbs/getThumbKey.ts:7`）；与归档的 `photo_<id>` / `document_<id>` 差一个下划线，转一下即可 |
| 尺寸 / mime / 文件名 | `media.size`、`media.mime_type`、`media.file_name`；照片取 `media.sizes` 里最大项 |

**归档用的 peerId（带符号，与现有 telegram-cache 目录同名）由 tweb 的 PeerId 换算**（`src/helpers/peerIdPolyfill.ts:25-32`）：

| tweb 侧 | 归档侧 `peerId` |
| --- | --- |
| `peerChannel`，`chatId = peerId.toChatId()` | `-100${chatId}` |
| `peerChat`（普通群），`chatId` | `-${chatId}` |
| `peerUser`，`userId` | `${userId}`（正数） |

反算（影库点「消息链接」跳回来时）：`-100…` → `-Number(slice(4))`；其它负数 → 原值；正数 → 原值。
tweb 的 `PeerId` 正是这个空间（`toPeerId(isChat)` = `-Math.abs(id)`，`toChatId()` = 绝对值），所以反算结果可直接喂 `appImManager`。

### 3.4 深链跳转：怎么「跳到某条消息」

```ts
// tweb/src/lib/appImManager.ts:2131
public async open(options: {peerId: PeerId, lastMsgId?: number, threadId?: number, commentId?: number, ...}) { ... this.op(...) }
```

- **触点**：页面侧 `bridge.ts` 挂 `window.__EDT_JUMP_TO_MESSAGE__ = (peerId, mid) => {...}`，内部调 `hotReloadGuard.appImManager.setInnerPeer({peerId, lastMsgId})`（`src/lib/appImManager.ts:3706`，选项类型 `ChatSetInnerPeerOptions` 在 `:230-233`；**不能直接 import `@lib/appImManager`**，见 §3.9）。
- 等价写法（都用得上）：`open({peerId, lastMsgId})`（`:2131`）、`openThread({peerId, lastMsgId, threadId})`（`:2271`）；hash 路由形式是 `#/im?p=<peerId>&message=<mid>&thread=<threadId>`（解析 `:2035-2076`，构造 `appDialogsManager.ts:1825-1840`）——若哪天需要「新标签打开」可以复用它。
- 运行期全局已存在：`window.appImManager` / `window.rootScope` / `window.apiManagerProxy` / `window.I18n`（`MOUNT_CLASS_TO`，`src/config/debug.ts:15-16`），调试时可直接在 console 验证跳转。
- 会话没被加载过时 `open()` 会自己拉 chat，不需要额外预热；找不到 peer 时它静默返回，所以桥接函数要自己先 `apiManagerProxy.getPeer(peerId)` 判空，返回 `false` 让宿主（Electron 侧）提示「该会话还没有在 Telegram 里加载」。
- 与 a 版（telegram-tt）不同：tweb 的 `open()` 是**运行时函数调用**，不依赖 location hash，因此 IPC → `executeJavaScript` 的链路与现有 `TelegramCachePage.vue` 的 `runJump()` 完全同构。

### 3.5 媒体字节：怎么把一个 Message 的媒体完整下载下来

两条路，按大小分流（关键：**tweb 的 `downloadMedia` 返回整份 `Blob`，且 > 20 MiB 不落 `cachedFiles`**）：

```ts
// 小文件（≤ MAX_FILE_SAVE_SIZE = 20 MiB，src/lib/appManagers/constants.ts:18）
const p = appDownloadManager.downloadMedia({media, queueId});   // src/lib/appDownloadManager.ts:287
p.addNotifyListener((progress: Progress) => {...});             // {done, total, offset}，50ms 节流
const blob = await p;                                          // Blob，blob.type = mime

// 大文件：走 SW 的 stream 路由，边读边写（不整份进内存）
const url = getDocumentURL(doc);                                // 'stream/<urlencoded DownloadOptions>'
const res = await fetch(url, {headers: {Range: 'bytes=0-'}});
const reader = res.body.getReader();                            // tweb/src/lib/serviceWorker/stream.ts:216+ 支持 Range
```

- 归档实现：把读到的 chunk 直接喂 §5 的 `appendArchive(offset, chunk)`（4 MiB 一片），进度用 `progress.done / total` 推给角标。
- 取消：`p.cancel()`（`appDownloadManager.ts:107`）→ 抛 `DOWNLOAD_CANCELED`；我们的归档已在后端留 `.part`，下次点缓存自动续传。
- 优先级：`queueId` 传当前聊天的 `bubbles.lazyLoadQueue.queueId`，避免与可见媒体抢 DC 额度（每 DC 约 4.5 MiB 在飞，`apiFileManager.ts:97`）。
- 兜底：`appDownloadManager.downloadToDisc({media})` 走浏览器自己的下载器（`d/<id>` iframe + SW 流），但我们**不用**它 —— 归档要写自己的目录，只借用它的能力认知。

### 3.6 本地化与图标

- 文案：所有键在 `src/lang.ts`（6227 行，`const lang = {'Key': 'English text', …}`），键类型自动派生 —— `LangPackKey = keyof typeof lang | keyof typeof langSign`（`src/lib/langPack.ts:72`），所以**只改 `lang.ts` 就有类型**。用法 `i18n('Key', [args])`（返回 **`HTMLElement`**，直接 append，不是字符串）或 JSX `<I18nTsx key="…" />`。
- 新增 4 个键（建议名）：`'TelegramCache.Context.Cache': 'Cache this message'`、`'TelegramCache.Status.Cached': 'Cached'`、`'TelegramCache.Status.Caching': 'Caching %s%%'`、`'TelegramCache.Status.Queued': 'Queued'`。**占位符是 `%s`**（不是 `%percent%`），按顺序传数组。
- **不要手改** `src/scripts/out/langPack.strings`（`watch-lang.js` / `format_lang.js` 生成，`AGENTS.md` 明确禁止）；`langSign.ts` 只在需要签名时才动。
- 图标：`type Icon = keyof typeof Icons`（`src/global.d.ts:137`，源表 `src/icons.ts`），`Icon('archive', 'time-icon')` → `<span class="tgico …">`。可直接复用：`archive`（e915）、`archive_filled`（e916）、`folder`（e98a）、`cache_clear`（ea8b）、`download`（e973）、`delete`。新图标要进 `src/icons.ts` + 字体资源，成本高 → **优先复用**。
- RTL：tweb 有完整 RTL 层（`?rtl=1`），badge 用逻辑属性（`margin-inline-*`、`gap`），方向性图标走 `src/iconsReverse.ts`。

### 3.7 构建与托管：怎么出 dist、怎么注入 `window.__EDT__`

**构建**（tweb 目录）：

```bash
pnpm install                        # engines: node ^22.18 || >=24.11，pnpm 11.x（本机 node v22.15 低于地板，需先升级）
pnpm exec vite build                # 只要 dist/：跳过 test/typecheck/changelog/check-bundle
# pnpm build                        # CI 口径：test + tsc + changelog + build + bundle 校验
```

产物形状：`vite.config.ts:325` `base: ''` + `:342-367` `assetsDir: ''` → **全部相对路径、全部 chunk 在 dist 根**；`dist/index.html` 只有一个模块脚本 `<script src="src/index.ts" type="module">`（构建后变成 `<script type="module" crossorigin src="./index-<hash>.js">`）。
**`dist/` 不含 `public/`**：`public/`（assets/fonts/img/tgs、`decoderWorker.min.js`、wasm、`changelogs/`、`version`…）必须一起托管，否则没有字体与表情。

**托管**（复用 `site-server`，但 rootDir 要能落两个目录）：tweb 自己的 `server.js:18-31` 就是这么干的 —— `express.static('dist')` **再** `express.static('public')`，`GET /` 给 `dist/index.html`。
落到我们的 `site-server` 上：`rootDir` 变成有序列表 `[tweb/dist, tweb/public]`（或加一个 `fallbackRootDir`），其余（token 校验、`/api/*`、`/media/*`、`/events`、Range/206）完全复用。

**注入 `window.__EDT__`**（三选一，推荐第 1 个）：

1. **服务时注入 HTML**（零仓库改动，token 每次启动都新）：`GET /` 读到 `dist/index.html` 后，在第一个 `<script type="module"` 之前插入
   ```html
   <script>window.__EDT__={token:"…",api:"/api",media:"/media"}</script>
   <script>window.__EDT__&&import(`./edt/edt.js?v=${version}`)</script>
   ```
   经典脚本先于任何 `type="module"` 执行，全局必然就绪；`import()` 在经典脚本里按 document base 解析。
2. Vite 插件 `transformIndexHtml`（`vite.config.ts:252-273` 挂插件，参考 `scripts/dev-checks.mjs:106`）——把注入写进构建产物，token 只能用占位符 + 运行时替换。
3. 直接改 `index.html` —— 能做，但 token 是每次启动变的，只能注入「读全局的守卫脚本」，实际仍要方案 1 补 token。

**两个必须知道的坑**：

- **SW 缓存是 cache-first**（`src/lib/serviceWorker/cache.ts:17-43`，缓存桶 `cachedAssets`），服务器 `Cache-Control` 管不了它。注入的脚本要么**内联进 HTML**（`index.html` 没有扩展名、不在 SW 匹配的扩展名表里 → 永远走网络），要么**每次构建换 URL**（`edt.js?v=<hash>`）。**绝不能**用固定 URL 的外部 `edt.js`，否则改完永远加载旧的。
- **token 不要进 query string**：`src/config/modes.ts:84` 用 `location.search.indexOf(flag + '=1')` 判 flag，且 `makeWorkerURL`（`src/helpers/setWorkerProxy.ts:10-15`）会把页面 query 复制进每个 worker URL —— token 里出现 `noServiceWorker=1` 之类会翻转模式，还会漏到日志/缓存键里。

**启动钩子**（页面侧模块何时跑）：

```ts
// tweb/src/index.ts:451  document.addEventListener('DOMContentLoaded', async() => {
// :484  rootScope.managers = getProxiedManagers();
void import('@/helpers/edt/index').then(m => m.start(window.__EDT__));   // fire-and-forget，不能 await
```

- 放在 `:484` 之后：此时 managers 已就绪，且不会推迟聊天列表首帧（`AGENTS.md` 明说 `DOMContentLoaded` 里的 await 会拖慢首屏）。
- 模块**必须自己再判一次** `window.__EDT__`（经典脚本可能在 `#page-chats` 之前跑完），DOM 操作放 `DOMContentLoaded` 之后。

### 3.8 注入的现实约束（源码勘察结论）

| 约束 | 影响 | 对策 |
| --- | --- | --- |
| 消息气泡是命令式 DOM，没有 Solid 组件可挂 | 无法用 JSX「插入」角标 | DOM 后处理（§3.1），并接受「重渲染后再补」 |
| `appendBubbleTime` / `bubble.timeAppenders` 模块私有 | 官方的「持久 badge 钩子」用不上 | patch `ChatBubbles.prototype` 或用 `MutationObserver` 观察 `.bubble > .time` |
| 右键菜单每次打开都重建（`setButtons()`） | 不能「注册一次」 | 直接改 `setButtons()`（我们本来就要改源码） |
| 菜单项 `verify` 为假会被静默过滤 | 排查时「项消失了」很难定位 | `verify` 里先 `console.debug`（dev 构建）或统一返回 `true` 后再收敛 |
| 消息对象上没有媒体 URL | 缓存必须自己驱动下载 | `appDownloadManager.downloadMedia` / `getDocumentURL` + SW stream（§3.5） |
| `download_progress` 是全局事件 | 无法按消息订阅进度 | 用「本次归档自己的 `done/total`」推 SSE，或按 `docId` 过滤 |
| 相册一条消息渲染多个 `.bubble` | 角标可能出现在每一格 | 决定：**每格都显示**（信息一致），链接仍指向主消息 |
| `mid` 对本地消息有偏移 | 归档键会与 Telegram 对不上 | 一律 `getServerMessageId(mid)` |

### 3.9 tweb 的硬规矩（改动必须遵守）

| 规矩 | 我们的落点 |
| --- | --- |
| 别名优先，不写相对路径（`AGENTS.md:215`） | `src/helpers/edt/*` 内部一律 `@helpers/…`、`@lib/…` |
| `hotReloadGuard` 取顶层单例，**不许 import** `@lib/appImManager`（`AGENTS.md:390`） | `bridge.ts` / 菜单 / 角标都走 `hotReloadGuard.appImManager`、`hotReloadGuard.appDialogsManager` |
| 不许直接 `apiManager.invokeApi*`（`AGENTS.md` "App Managers"） | 只调 `appDownloadManager` / `appImManager` / 现有 manager 方法 |
| 不许手改 `langPack.strings`、`settingsSearch/generated.ts` | 只改 `src/lang.ts`（+ `langSign.ts`） |
| 代码风格：`if(`、无尾逗号、单引号、`return await` 只在 try/catch、2 空格 | 新文件全部照办；`pnpm lint`（oxlint）会拦 |
| 不加新依赖 | 归档客户端零依赖，只用 `fetch` + 既有 manager |
| 不自行 commit | 改完留给用户审 |
| 评审先给 Codex（`scripts/codex-review.sh`） | 实现完成后按此走 |

## 4. 架构

> 本节的「单后端双站点」是最初版本；**已按 §0.1 修订为独立工具**（下面保留作设计对照与取舍记录）。

```
Electron 主进程（telegram-cache 后端，单实例）
├─ site A  http://127.0.0.1:34100/   →  telegram-tt/dist（现有页面）
│    └─ /api/* /media/* /events /edt-bootstrap.js
├─ site B  http://127.0.0.1:34200/   →  tweb/dist（新页面）
│    └─ 同一套 /api/* /media/* /events（第二实例，共享同一归档引擎）
└─ 共享域：archive-api / message-store / message-library / trash / media-resolver / objects/

渲染层
├─ 页面 A：<webview partition="persist:telegram-cache" src=siteA.url>
└─ 页面 B：<webview partition="persist:tweb-cache"     src=siteB.url>
   共同的右栏面板 ──IPC（telegramCache:*）──▶ 上面的共享域
```

### 4.1 备选方案与取舍

| 方案 | 做法 | 代价 | 结论 |
| --- | --- | --- | --- |
| **A 单后端 + 双站点**（备选） | `site-service` 支持多实例；两工具共用归档引擎 | 后端要做「多站点」参数化；数据与右栏边界模糊 | ⏸ 不采用 |
| B 双后端 + 引擎提取 | 把归档引擎提到 `backend/telegram-archive/`，两工具各自注册 IPC | 移动 ~1500 行 + 双份 IPC/事件通道 | ⏸ 备选：将来若要求「关掉一个工具的页签不影响另一个」再做 |
| C 复制一份引擎 | 新工具自带走私 `tools/tweb-cache/backend/**` | 两份目录格式/迁移逻辑必须永远同步 | ❌ 不做 |

> 采用 A 的前提条件（必须满足，否则退回 B）：站点实例化只依赖 `(rootDir, port, handlers)`；
> 归档引擎不读「当前工具」的全局状态（现状检查：`message-store` / `message-library` / `trash-service` /
> `media-resolver` 都只依赖数据分层路径与传入参数 ✅，`site-service` 里的 `siteStatus` 是单例 ❌ → 需要改成按 key 的表）。

## 5. 数据契约（与 telegram-cache 完全一致）

- 目录：`messages/<peerId>/<mid padStart(15,'0')>/`；完成标记 `manifest.json`；正文 `message.md`；媒体 `media/<mediaKey>.<ext>`（进行中 `.part`）。
- 键：`messageKey = tgmsg:v1:<peerId>:<mid>`；`mediaKey = photo_<id>` / `document_<id>`。
- 协议（tweb 侧客户端只需这 5 条）：

| 调用 | 请求 | 说明 |
| --- | --- | --- |
| `prepareArchive` | `POST /api/archive/prepare` body `{peer:{id,titleSnapshot,username,type}, messageId, groupedId?, date?, editDate?, text?, attachments:[{index,mediaKey,kind,mimeType,fileName,expectedSize}]}` | 幂等；返回每个附件的 `received`（= 已有 `.part` 长度，续传起点） |
| `appendArchive` | `POST /api/archive/append?peer=&mid=&index=&offset=` body `ArrayBuffer`，header `x-edt-complete: 1`（末片） | 只维护连续前缀；返回 `{received, expected, complete}` |
| `commitArchive` | `POST /api/archive/commit` body `{peer:{id}, messageId, text?}` | 全部 complete 才写 manifest，否则返回 `partial` |
| `getMessageArchiveStatus` | `GET /api/archive/status?peer=<id>&mids=<a,b,c>` | 角标用；`mids` ≤ 500 |
| `POST /api/archive/delete` / `reveal` | 同 telegram-cache | 右键「移除」「在文件夹中显示」 |
| SSE | `GET /events?t=<token>`，事件 `msg-status` | 主进程推进度；同源，浏览器自动带 cookie 无意义 → 用 token |

## 6. 页面侧设计（tweb）

新增目录 `tweb/src/helpers/edt/`（与 telegram-tt 的同名目录同构，便于互相对照）：

| 文件 | 职责 | 需要 tweb 的什么 |
| --- | --- | --- |
| `env.ts` | 读 `window.__EDT__ = {token, api, media}`；`edtFetch()` 自动加 `x-edt-token` | 无 |
| `api.ts` | §5 的 5 条 HTTP 封装（类型与 telegram-tt 的 `archive.ts` 一致） | 无 |
| `statusStore.ts` | `Map<peerId:mid, status>` + 订阅 + SSE（150ms 合流）+ 120ms 合批拉状态 | 无 |
| `archive.ts` | `cacheMessage(message)`：取 target → prepare → 分块下载 → append → commit | tweb 的媒体 API（§3.5） |
| `bridge.ts` | 挂 `window.__EDT_JUMP_TO_MESSAGE__(peerId, mid)` | tweb 的导航（§3.4） |
| `ui/menu.ts` | 右键项注册 | tweb 的菜单系统（§3.2） |
| `ui/badge.ts` | 角标渲染 | tweb 的消息组件（§3.1） |

状态机与现有一致：`missing | queued | downloading | partial | complete | failed`；
乐观更新（点击即 `queued`）→ SSE/轮询推进 → `complete` 落定；失败回落 `partial` 并弹提示。

## 7. 分步骤实施计划

每一步都能独立跑通并验证，不通过不进下一步。

### Step 0 · tweb 构建产物（前置）

1. 用户执行 `pnpm --dir tweb install`（需要网络；`engines` 要求 Node ^22.18 || >=24.11）。
2. 新增 `scripts/build-tweb.mjs`：`--check` 只比对 `tweb/src` 与 `tweb/dist` 的 mtime；
   不带 `--check` 时走 tweb 的 `vite build`（**跳过** `test/typecheck/generate-changelog`，那是 CI 口径）。
3. 根 `package.json` 增 `tweb:check` / `tweb:build`。
4. 产出 `tweb/dist/index.html`：`site-service` 用它判断「站点可启动」。

**完成判据**：`pnpm tweb:check` 返回 dist 就绪；站点页能匿名打开登录界面。

### Step 1 · 共享常量 / 类型 / 数据层

| 文件 | 改动 |
| --- | --- |
| `shared/webview.ts` | 新增 `TWEB_WEBVIEW_PARTITION = 'persist:tweb-cache'` |
| `shared/tweb-cache.ts`（新） | `TWEB_SITE_PORT_BASE = 34200`、`TWEB_SITE_PORT_RANGE = 16`、`TwebSiteInfo`（字段同 `TelegramSiteInfo`）、`TWEB_DEFAULT_CONFIG` |
| `shared/data-layers.ts` | 新增 `tweb-cache.*`：config、messages、trash、objects、tmp、diagnostics；资产不自动清理，缓存可清理 |

**完成判据**：`pnpm typecheck` 通过；`shared/**` 不引入 Electron / Node。

### Step 2 · 后端：独立工具后端 + 平台归档引擎

| 文件 | 改动 |
| --- | --- |
| `backend/telegram-archive/{engine,scope}.ts` | 平台层接口、注册表、scope 与串行队列 |
| `tools/telegram-cache/backend/services/archive-engine.ts` | 实现并注册归档引擎；每次调用按 scope 解析路径 |
| `tools/tweb-cache/backend/**` | 独立站点生命周期、配置、IPC；调用引擎时固定 `scope='tweb-cache'` |
| `electron/tool-registry.ts` | telegram-cache 先注册引擎，tweb-cache 后初始化 |

**完成判据**：启动后 `http://127.0.0.1:34200/` 返回 tweb 的 index.html；`/api/health`、`/media/<key>?t=` 正常；
`dist` 缺失时只在快照里报错（不影响 telegram-cache 站点）。

### Step 3 · tweb 页面侧归档客户端

新增 `tweb/src/helpers/edt/{env,api,statusStore,archive,archiveStatus}.ts`（API 契约与 telegram-cache 保持一致）。
`archive.ts` 的下载循环：4MB 分片，先尝试「页面已下载的整份 Blob」（可选，§3.5 若能拿到）→ 否则走 tweb 的分块下载 API。

**完成判据**：`pnpm --dir tweb typecheck` 只允许仓库既有错误；应用内右键一张图片消息能写进
`<assets>/tweb-cache/messages/...`，且 `manifest.json`、`message.md`、媒体文件齐全。

### Step 4 · tweb UI 触点（右键项 / 角标 / 本地化）

按 §3.1 / §3.2 / §3.6 的落点改 3-4 个文件：菜单项（缓存 / 在文件夹中显示 / 移除）、消息内角标（「缓存中 42%」「已缓存」）、
新增 10 条文案 key、图标沿用既有 archive/folder 图标。

**完成判据**：右键一条图片消息 → 「缓存此消息」→ 角标出现「缓存中 xx%」→ 完成后「已缓存」；
目录里 `manifest.json` / `message.md` / `media/<mediaKey>.jpg` 齐全。

### Step 5 · 跳转桥（影库定位用）

`tweb/src/helpers/edt/bridge.ts` 挂 `window.__EDT_JUMP_TO_MESSAGE__(peerId, mid)`，把服务端 mid 换算为 tweb 本地 mid 后打开聊天并定位；
在 tweb 启动钩子里安装（§3.7 的注入点）。

**完成判据**：在影库点消息号或「定位」→ 左侧 tweb 切到该会话并滚到该条；服务端 mid 已换算为 tweb 本地 mid。

### Step 6 · 新工具壳（`tweb-cache`）

| 文件 | 内容 |
| --- | --- |
| `tools/tweb-cache/index.ts` | `defineTool`：name「Telegram 归档（tweb）」、version 1.0.0、`subRoutes: overview / library`、`meta.toolId: 'tweb-cache'` |
| `tools/tweb-cache/renderer/pages/TwebCachePage.vue` | 左 `<webview :partition="TWEB_WEBVIEW_PARTITION" :src="site.url">` + 右栏（影库 / 概览）；工具栏后退/前进/刷新/开发者工具/外部打开 |
| `tools/tweb-cache/renderer/ipc.ts` | `createIpcHelpers('twebCache', …)`，独立命名空间 |
| `tools/tweb-cache/renderer/stores/twebCacheStore.ts` | 影库 / 回收站 / 站点状态；订阅 `EVENT_LIBRARY` 实时更新 |
| `tools/tweb-cache/renderer/tabs.ts` | 本工具自己的概览 / 影库子路由 |

右栏保持工具内聚：`tweb-cache` 使用自己的 store / page / IPC，不跨工具 import 组件。

**完成判据**：首页出现两个工具卡片；打开 `tweb-cache` 能看到 tweb 登录页 + 本工具独立影库。

### Step 7 · 打包 / 文档 / 记忆

- 打包：`tweb/dist` 与 `telegram-tt/dist` 都不进安装包（同现状口径），安装版只报「未找到构建产物」；
- 文档：本文件落地为 `docs/tweb-cache.md`（模块记忆）+ 更新 `AGENTS.md` 的文件定位速查；
- `tweb/src` 触点的升级重放清单维护在 `docs/tweb-cache.md` §2。

**完成判据**：`pnpm typecheck`、`pnpm lint`、`pnpm check:ui` 全绿；`pnpm build` 可出包。

### Step 8 · 验收

按 §8 的 12 条手工验收。

## 8. 验收清单

1. `pnpm dev` 后首页有两个工具：`telegram-cache`（A 版）与 `tweb-cache`（K 版）。
2. tweb 页可登录、重启仍登录（`persist:tweb-cache` 分区生效）。
3. 右键图片消息 → 缓存：`messages/<peer>/<mid>/` 出现 `manifest.json`（`status: complete`）、`message.md`（抬头 + 正文）、`media/<mediaKey>.jpg`。
4. 右键视频消息 → 缓存：角标从「排队」→「缓存中 xx%」→「已缓存」；中途关页面重开再缓存，`received` 从断点继续。
5. tweb-cache 影库能看到本工具归档的消息：状态、大小、附件数、正文预览、发送者、消息链接、本地目录；telegram-cache 不会看到它。
6. 影库点消息号 /「定位」→ 左侧切到该会话并定位该消息。
7. 影库点「本地目录」/「打开文件夹」→ 资源管理器打开该消息目录。
8. 在 tweb 聊天里点击已归档视频 → 断网仍可播；请求原始 document 的 `stream/`，不产生 HLS / `upload.getFile` 流量。
9. 影库「删除」→ 回收站；恢复后仍能播放。
10. 两个工具同时打开：互不踩（各自 origin、分区、IPC 与数据命名空间）。
11. `tweb/dist` 不存在时：`tweb-cache` 页显示「未找到 tweb 构建产物，请先 pnpm tweb:build」，`telegram-cache` 不受影响。
12. 缓存一条消息后直接改 `tweb/dist` 重新构建：页面仍能正常加载（若出现旧 bundle，先硬刷新确认是 SW 缓存）。

## 9. 风险与回退

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| tweb 上游升级 | 触点文件的行号/结构变化 | 触点集中在 `src/helpers/edt/**` + 固定单点接线；升级时按 `docs/tweb-cache.md` §3 重放 |
| 两个 PWA 抢 SW | 页面白屏 / 请求被错误接管 | 各自独立 origin（独立端口），不与 telegram-tt 同源 |
| origin 变化（端口被占） | tweb 登录态全丢 | 端口写进 `config/tweb-cache/config.json`；变化时页面显式提示，复用现有 `originChanged` 机制 |
| tweb 构建耗时 / 体积 | 开发循环变慢 | `--check` 只比 mtime；`vite build` 跳过 test/typecheck |
| 归档引擎被两个站点同时写 | `.part` 交错、meta 竞态 | 归档以 `(peer,mid,index)` 为单位顺序写；同一消息两个页面同时点缓存会撞 `prepare`，靠 `offset > 当前长度 → 丢弃` 兜底（现状已如此）；后续可加「按 messageKey 的进程内锁」 |
| GPL（tweb 是 GPL-3.0） | 分发合规 | 仅本地自用、随仓库不发布二进制；如需发布需评估 |
