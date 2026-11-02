# telegram-tt 集成指南（自托管客户端形态）

> 目标：把 `telegram-tt` 作为 git submodule 引入 everydaytool，主进程用 loopback HTTP 托管构建产物，
> 在**源码层**接入消息级缓存（不注入、不改原站、不接管查看器）。
> 基线：`telegram-tt@12.0.48`（commit `6002824b6532f3d913997ce496d9ab5f9b86bc22`，GPL-3.0-or-later）。
> 本仓库**不对外分发**，因此 GPL 的分发义务不触发；若将来分发，必须先处理许可证（见 §9）。

## 0.1 实现进度（阶段 0）

| 项 | 状态 | 位置 |
| --- | --- | --- |
| 构建脚本（Node 24 检测 + npm ci/build + 产物校验） | ✅ 已实现，`--check` 通过 | `scripts/build-telegram-tt.mjs`、`package.json` 的 `telegram:check/build` |
| loopback 托管（静态 + SW 头 + `/api` + `/media` Range/416 + token） | ✅ 已实现，16/16 冒烟通过（真实 dist） | `tools/telegram-cache/backend/services/site-server.ts` |
| 主进程生命周期 + 快照 + IPC + 页面切换 | ✅ 已实现（`SITE_INFO`、`snapshot.site`、页面只加载本地站点） | `site-service.ts`、`backend/index.ts`、`ipc/*`、`snapshot-service.ts`、`TelegramCachePage.vue` |
| 导航闸放行本地 origin、观测过滤 loopback | ✅ 已实现 | `probe-service.ts`、`observation-service.ts` |
| telegram-tt 适配层骨架 | ✅ 已实现（未跑 `npm run check:ts`） | `telegram-tt/src/util/edt/{env,cacheApi,pageCache,mediaBridge}.ts` |
| `mediaLoader` 接入（Progressive/DownloadUrl/BlobUrl + SW 分片） | ✅ 已接入（EDT 未注入时零行为变化） | `telegram-tt/src/util/mediaLoader.ts` |
| 消息目录 / manifest / text.md / 硬链 / 媒体索引 | ✅ 已实现；Electron 桩下 12/12 通过 | `tools/telegram-cache/backend/services/message-store.ts` |
| 归档 API（prepare/append/commit/status）+ 媒体解析 | ✅ 已实现，接入 `site-server` 的 `handleApi` / `resolveMedia`；HTTP 端到端 7/7 通过（Electron 桩） | `archive-api.ts`、`media-resolver.ts`、`site-service.ts` |
| telegram-tt 归档客户端（分片下载 + 提交） | ✅ 已实现并接入右键菜单 | `telegram-tt/src/util/edt/archive.ts` |
| 右键入口 + 缓存状态角标 | ✅ 已接入（菜单三态：缓存 / 在文件夹中显示 / 移除；`MessageMeta` 角标） | 未在应用内验证 |
| 相册整组 | ✅ 右键任一张 = 逐条归档整组（每条消息保留自己的目录/manifest） | 未在应用内验证 |
| 回收站后端（删除 / 列表 / 恢复 / 清空） | ✅ 已实现，HTTP 端到端 10/10 通过（Electron 桩） | `trash-service.ts` |
| 本地化 key | ✅ 手动补 `fallback.strings` 与 `language.d.ts`（9 个 key）；`npm run lang:ts` 待依赖安装后复核 | — |
| 影库 `library` / 回收站 UI | ✅ 已实现（`message-library.ts` 列表 + IPC + `LibraryPanel.vue`，含回收站列表/恢复/清理到期、内置播放） | 未在应用内验证 |
| SSE 实时进度（`/events` + `statusStore` EventSource） | ✅ 已实现（prepare/append/commit/delete/restore 广播 `msg-status`） | 未在应用内验证 |
| submodule 注册 | ⚠️ 被沙箱阻断：`.gitmodules` 已生成并暂存，gitlink 未写入；需普通终端执行 | 见 §1 |
| `npm ci` / `vite build`（Node 24） | ⬜ 未在本会话执行；`telegram-tt/dist` 已存在（211.9MB，SW 在根目录） | `pnpm telegram:build` |

已知验证结果：`tsc -p tsconfig.node.json` 通过、ESLint 通过、自带 18 项自检通过、
`site-server` 冒烟 16/16 与 8/8 通过；`message-store` 在 Electron 桩下 12/12 通过（prepare/跳写/commit/manifest/媒体索引）；
归档 API 的 HTTP 端到端 7/7 通过（prepare/append/commit/status/Range/媒体状态）。
未覆盖：`vue-tsc`（缺 devDependencies）、telegram-tt 的 `npm run check:ts/css`（需先 `npm ci`）、真实 Electron 登录与媒体播放。

## 0. 决策与边界

- 前端：submodule `telegram-tt/`，构建产物 `telegram-tt/dist/`，由 everydaytool 主进程托管。
- 页面 origin：`http://127.0.0.1:<随机端口>/`（与 API/媒体**同源**）。
- 接入点：`src/util/mediaLoader.ts`（媒体 URL）＋新增 `src/util/edt/**`（缓存/归档客户端）。
- 不做：DOM 注入、CDP 捕获、自定义 scheme、查看器接管、对 `web.telegram.org` 的本地响应。
- 后端复用：对象库 / registry / 配额 / 单飞 / 归档 / 回收站 / 影库 / 诊断；MTProto 客户端降级为可选"headless 补档"。

## 1. 子模块与版本

```bash
cd D:\project\everydaytool
git submodule add --force https://github.com/Ajaxy/telegram-tt.git telegram-tt
git -C telegram-tt checkout 6002824b6532f3d913997ce496d9ab5f9b86bc22
git add .gitmodules telegram-tt
```

- 注册前 `telegram-tt/` 是未跟踪目录（330MB），已加入根 `.gitignore` 防误提交；注册为 submodule 后可删除该行。
- **必须在普通终端执行**：AI 沙箱里 `git submodule add` 会因 git 子进程的管道被限制而失败（msys `couldn't create signal pipe`）。
- 若提示目标目录已存在：先把克隆移走再注册，例如 `move telegram-tt telegram-tt.local`，
  注册成功后用 `git -C telegram-tt checkout <commit>` 重新拉取（或按需把本地未跟踪文件拷回）。
- **在子模块内建本地分支**承载我们的修改，便于 rebase：
  ```bash
  git -C telegram-tt switch -c edt/main 6002824b6
  # 改完后提交；导出补丁备份：git -C telegram-tt format-patch --stdout <base>..HEAD > ../patches/telegram-tt.patch
  ```
- 升级：`git -C telegram-tt fetch && git -C telegram-tt rebase origin/master`（冲突只可能出现在 §3 的触点）。

## 2. 构建与运行

### 2.1 版本要求（重要）

`telegram-tt` 的 `engines` 要求 **Node ^24.15 || ^26、npm ^11 || ^12**；本仓库 everydaytool 要求 Node ≥22.18。
两者不能共用同一个 Node：

- 构建 telegram-tt 用 Node 24/26（本机 fnm 已装 `v24.15.0` 与 `v26.10.0`），Electron 用 Node 22；
- 推荐把 Node 24 的安装目录放到 PATH 最前面（比 `fnm exec` 更稳，后者在某些终端里找不到 `npm`）：
  ```powershell
  $node24 = "$env:APPDATA\fnm\node-versions\v24.15.0\installation"
  $env:Path = "$node24;$env:Path"
  node -v      # v24.15.0
  npm -v       # 11.12.1
  cd telegram-tt; npm ci; npm run build:production
  ```
- `scripts/build-telegram-tt.mjs` 启动前检查 Node 版本（≥24.15），不满足直接报错并打印上面的命令；
- 不要把 telegram-tt 的 `node_modules` 装进仓库根（体积与 Node 版本都会冲突）。

### 2.2 构建

```bash
cd telegram-tt
npm ci
# .env（不进 git）：TELEGRAM_API_ID / TELEGRAM_API_HASH（my.telegram.org 申请，可与现有 .env 相同）
npm run build:production     # 产物 telegram-tt/dist/
```

- Vite 配置 `base: './'` → 产物用相对路径，可直接从站点根目录托管。
- 构建时读取 `.env` 的 `TELEGRAM_API_ID/HASH`，通过 `envPrefix: ['VITE_','TG_']` 注入
  `import.meta.env.TG_TELEGRAM_API_ID/HASH`（`src/config.ts:38-39`）。
- `BASE_URL` 只影响 `TG_PUBLIC_URL`（分享链接等），本地托管可设为 `http://127.0.0.1/`。

### 2.3 everydaytool 命令

在根 `package.json` 已增加：

| 命令 | 作用 |
| --- | --- |
| `pnpm telegram:check` | 只检查 Node 版本 / 依赖 / 产物状态，不安装不构建 |
| `pnpm telegram:build` | 必要时 `npm ci`，然后 `npm run build:production`，校验 `dist/index.html` |
| `pnpm dev` | 若 `telegram-tt/dist` 缺失则页面提示"本地客户端未就绪"；开发期也可指向 `http://localhost:1234/`（`npm run dev`） |
| `pnpm build` | 只有在 `dist` 存在时才打包；不隐式安装依赖 |

## 3. 托管（主进程）

新增 `tools/telegram-cache/backend/services/site-server.ts`：

```
listen 127.0.0.1:0
  GET  /                          → dist/index.html（注入 bootstrap，见 §4）
  GET  /assets/*                  → dist/assets/*（immutable，hashed）
  GET  /media/<mediaKey>?t=<token>→ 本地文件流（Range/206/416，Content-Length/Accept-Ranges）
  GET  /thumb/<mediaKey>?t=<token>→ 缩略图/封面（可选）
  *    /api/*                     → JSON API（要求 x-edt-token，见 §4）
  GET  /events?t=<token>          → SSE：缓存/归档进度
  fallback                        → index.html（SPA 路由；仅非 /api、非静态）
```

硬性要求：

1. **同源**：页面、`/api`、`/media` 必须同一个 origin（CSP `default-src 'self'` / `media-src 'self'` 已放行；
   换成两个 origin 就要改 CSP，得不偿失）。
2. **Service Worker 头**：当前构建把 `service.worker-<hash>.js` 放在 **dist 根目录**（同目录还有 `worker-*.js`、
   `fasttext.worker-*.js` 等），默认作用域已经是 `/`；服务端仍统一对 `*service.worker*.js` 加
   `Service-Worker-Allowed: /`，避免上游改输出目录或改成子路径时静默失效。
   Vite dev server 也是这么做的（`vite.config.ts:210-213`）。
3. **静态资源**：`Cache-Control: no-store` 用于 `index.html` 与 `/api`、`/media`；hashed 资源可 `immutable`。
4. **端口生命周期**：随主进程启动/退出；退出时 `server.close()` + 断开 SSE。
5. **路径安全**：静态路径 `path.resolve` 后必须仍在 `dist/` 内；媒体只接受索引内的 `mediaKey`。
6. **导航**：webview 只允许该 origin；外部 http(s) 交给系统浏览器（沿用现有 allowlist 思路，但域名换成 loopback）。

## 4. 页面 ↔ 后端：同源 API + 一次性 token

因为 webview 的 preload 被平台剥离（[main.ts:293-306](../electron/main.ts#L293-L306)），页面**不通过 IPC**，
走同源 HTTP：

- 主进程在返回 `index.html` 时插入**外链**脚本（不能内联：站点 CSP 是 `script-src 'self'`，内联会被拦）：
  ```html
  <script src="/edt-bootstrap.js"></script>
  ```
  `/edt-bootstrap.js` 由同一个服务返回（`no-store`），内容：
  ```js
  window.__EDT__ = { token: '<32字节随机>', api: '/api', media: '/media' };
  ```
- 前端 `src/util/edt/env.ts` 读取 `window.__EDT__`；所有请求带 `x-edt-token`；媒体 URL 带 `?t=`。
- 服务端校验：token 相等 + `Host` 为 `127.0.0.1:<port>`；带外部 `Origin` 的请求一律拒绝。
- 说明：token 不是对抗本机恶意进程的强隔离（它能读首页拿 token），只防其它网页/误调用；
  真正的边界是"绑定 loopback + 只读媒体 + 有限 API"。

**被否决的方案**：给这个分区单独放开 preload + contextBridge。它确实更顺，但会破坏平台"webview 一律无 preload"的
安全不变量；在有同源 HTTP 这个等价选项时，不值得开口子。

## 5. 源码接入点（保持最小 diff）

新增目录（全部自包含，便于 rebase）：

```
telegram-tt/src/util/edt/
├── env.ts            # window.__EDT__ 读取与校验
├── cacheApi.ts       # /api/cache/*、/media/* 的 fetch 封装（含 Range/分块）
├── pageCache.ts      # 读页面已下载字节：cacheApi + getFromMemory（12.0.48 无 getExistingBlob）
├── mediaBridge.ts    # 媒体层接入：命中本地 → 返回本地 URL；下载完 → 写回
├── archive.ts        # 消息归档编排（prepare → 下载分块 → commit）
├── statusStore.ts    # 消息缓存状态的模块内订阅（不写全局状态，避免 cache 迁移）
└── types.ts
```

**改动点（目标 ≤4 处）**

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `src/util/mediaLoader.ts` | `Progressive` / `DownloadUrl` 分支：先问 `mediaBridge.resolve()`，命中返回 `/media/...`，否则原逻辑；`BlobUrl` 分支：先 `cacheApi.fetchBlob()` |
| 2 | `src/util/mediaLoader.ts`（SW `message` 处理） | `requestPart`：先 `cacheApi.fetchPart(mediaKey, start, end)`，未命中再走 GramJS；拿到分片后 `cacheApi.appendPart` 写回 |
| 3 | `src/components/middle/message/ContextMenuContainer.tsx` | 增加「缓存此消息 / 取消缓存 / 在文件夹中显示」菜单项（调用 `archive.ts`） |
| 4 | `src/components/middle/message/Message.tsx` 或 `Video/Photo/Document` 角标处 | 读 `statusStore` 显示「已缓存 / 缓存中 x% / 部分 / 原始消息不可用」 |

- 消息级入口需要 `ApiMessage`：页面里有完整对象（chatId/id/media/entities/groupedId），**不需要 DOM 解析**，
  也不需要再跑 MTProto 反查。
- 缩略图/角标用现有 `Icon` 组件；文案用 `lang()`（新增 key 走 `fallback.strings` + `npm run lang:ts`）。
- 不在 `src/global` 加状态，避免 `migrateCache` 迁移；状态用模块内 store + 订阅 hook（参考 `useForceUpdate` 用法）。

## 6. 数据与 API 契约

### 6.1 媒体键

- `mediaKey = photo_<id>` / `document_<id>`（与 Telegram 实体 id 一致，跨会话稳定）。
- 辅助键：`fileUniqueId`（去重）、`sha256`（完整性）、`messageKey = peer:mid`（目录/标记）。

### 6.2 页面 → 后端

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `HEAD` | `/media/<mediaKey>?t=` | 命中/下载中/缺失 + `x-edt-status`、`received/expected` |
| `GET` | `/media/<mediaKey>?t=` | 播放/取字节（支持 Range） |
| `POST` | `/api/media/put` | 整块写入（**未接线**：主进程从未实现，页面已不再调用） |
| `POST` | `/api/media/append` | 分块追加（**未接线**：同上；播放回写会拖慢播放，见主文档 §7） |
| `GET` | `/api/media/status?keys=` | 批量状态 |
| `POST` | `/api/archive/prepare` | 幂等建目录，返回逐文件 `received/expected` |
| `POST` | `/api/archive/append` | 归档分块写入 |
| `POST` | `/api/archive/commit` | 写 `message.md` + `manifest.json`（最后一步），清理 `.part` |
| `POST` | `/api/archive/bind` | 播放已缓存内容时补绑 `peer/mid`（不重下） |
| `POST` | `/api/archive/delete` | 移入回收站 |
| `GET` | `/api/archive/status?peer=&mids=` | 批量消息状态（角标） |
| `GET` | `/events?t=` | SSE 进度（可选，轮询亦可） |

所有写操作只接受 `peer/mid/mediaKey/offset/字节`，**不接受任意路径**；路径由主进程解析。

### 6.3 存储

```
<assets>/telegram-cache/messages/<peer>/<mid>/
  manifest.json  message.md  media/<mediaKey>.<ext> …
<assets>/telegram-cache/trash/<时间>_<peer>_<mid>/  （30 天）
<cache>/telegram-cache/objects/<ab>/<sha256>          （去重/硬链来源）
```

规则沿用主方案：硬链优先、消息目录为权威、远端失败不删本地、删除只经工具入口。

## 7. 媒体链路（关键行为）

```
播放：
  useMedia → mediaLoader.fetch(url, Progressive)
    → mediaBridge.resolve(url)
       ├ 后端命中 → 返回 http://127.0.0.1:<port>/media/<mediaKey>?t=…   （<video src> 直接播放）
       └ 未命中   → 原 progressive（SW）→ 页面侧收到分片请求时先问后端 Range，未命中再走 GramJS，并写回
归档：
  右键「缓存此消息」→ archive.prepare
    → 逐媒体：先查页面已下载（memory/Cache Storage）→ 有则直接 put
             否则 callApi('downloadMedia', { start, end }) 分块 → append
    → commit（text.md + manifest.json）
```

- **R2「复用浏览器缓存」在源码形态下变简单**：页面自己的 Cache Storage（`cacheApi.fetch(MEDIA_CACHE_NAME, …)`）
  与内存 blob（`mediaLoader.getFromMemory`）可直接读，不需要 CDP；后端缓存再兜一层。
- **不产生第二份网络请求**：归档复用页面的 GramJS 会话与已下载数据；不再需要独立 MTProto 下载器作为主路径。
- **MTProto 客户端保留**为可选"headless 补档"（按 t.me 链接、页面没打开过的消息），默认关闭。

## 8. 登录、凭据与会话

- 页面登录：telegram-tt 自己的登录流程（手机号/验证码/二步），会话存 IndexedDB/localStorage，落在
  `<data>/session/Partitions/telegram-cache/`，跨重启保留。
- `127.0.0.1` 下 passkeys 不可用（`rpId` 取 hostname），登录走手机号 + 验证码；会话一旦建立不受影响。
- 构建凭据：`telegram-tt/.env` 的 `TELEGRAM_API_ID/HASH`（**不进 git**），可与现有 `.env` 相同。
- 与现有 MTProto `.env` 会话的关系：两套独立登录态；归档走页面客户端，不再依赖 `TELEGRAM_SESSION`。
  诊断页把两者分开显示（web 登录态 / MTProto headless）。
- 换数据目录：沿用现有整体迁移；页面登录态随 session 目录迁移。

## 9. 许可证

- `telegram-tt` 为 **GPL-3.0-or-later**。当前 everydaytool **不对外分发**，不触发分发义务；
  仓库内保留 `telegram-tt/LICENSE` 与 commit 记录即可。
- 若将来分发（安装包、公开下载、内部大规模分发也算），整个分发物通常需按 GPL 处理：
  要么整仓 GPL，要么把 telegram-tt 作为可分离的 GPL 组件并单独提供修改源码。先定许可再发布。

## 10. 验证清单（集成层）

1. `npm ci && npm run build:production` 通过；`dist/index.html` 存在。
2. 主进程托管后：页面加载、登录成功、刷新后仍登录。
3. DevTools → Application → Service Workers：SW 作用域为 `/`（`Service-Worker-Allowed` 生效）。
4. 播放视频：Network 里 `/progressive/*` 出现在 SW 下；命中本地时 `<video src>` 为 `/media/...`。
5. 执行 `npm run check:ts` 与 `npm run check:css`（telegram-tt 侧改动必须过）。
6. 归档一条带图/带视频的消息：目录、`text.md`、`manifest.json`、硬链/对象引用均正确。
7. 杀掉进程重启：登录态、缓存状态、未完成归档（partial）都正确恢复。
8. 断网：影库可浏览与播放；页面允许离线展示已缓存内容（不要求整站离线）。

## 11. 回滚

- **不保留原站模式**：页面只加载本地托管构建，不存在 `web.telegram.org` 分支。
- 回滚靠版本：`git -C telegram-tt checkout 6002824b6`（已验证 commit）或 `git -C telegram-tt rebase --abort`。
- 托管层保留"只读静态托管"降级：若 `/api` 初始化失败，页面仍能加载并提示"缓存服务不可用"，不影响 Telegram 基本使用。
