# offline-pack 模块记忆

> 「离线包下载」工具的开发记忆。
> 上游解析 / 鉴权 / 落盘全在 Electron 主进程，渲染层只管参数、任务与历史展示。
> 改动相关文件前先读本文对应小节。

## 1. 模块概览

一站式下载 VSCode 插件、GitHub Releases、Chrome / Edge 扩展、Docker 镜像、Microsoft Store 应用的**离线安装包**。产物落在缓存层 `cache/offline-pack/downloads/`，下载历史在配置层 `config/offline-pack/history.json`（见 §4）。

- 工具 id `offline-pack`；来源页签 `vscode` / `github` / `chrome` / `edge` / `docker` / `msstore`，由子路由 `/tools/offline-pack/<tab>` 驱动。
- `supportedTargets: ['win', 'mac']`（落盘依赖主进程；web 预览没有 IPC）。
- 页面只有一块 `ToolSurface`，且**只使用主体区**（无 `surface-toolbar` / `statusline`）：
  - 左：268px `ToolSideInspector`，6 个来源纵向切换，底部固定「下载历史」入口；
  - 右：当前下载器（`KeepAlive`，切换来源保留表单与解析结果）；
  - 底部抽屉：`DownloadTasks`（进行中 / 刚结束的任务）+ `HistorySection`（落盘历史）。
- 工具页**没有** `WorkspaceHeader` / 顶部工具标题栏；工具上下文（图标 / 名称 / 说明）由全局标题栏提供。

## 2. 后端（`tools/offline-pack/backend/`）

```text
index.ts              initialize() → registerOfflinePackHandlers()
ipc/channels.ts       21 个通道常量（EVENT_PROGRESS 为推送通道）
ipc/handlers.ts       safeHandle 注册 + guard 错误归一 + 参数校验 / 文件名清洗
services/             vscode / github / chrome / edge / docker / msstore 六个上游代理
utils/http.ts         Electron net.fetch 封装（继承系统代理）；HttpError 保留 status / body
utils/crx.ts          Buffer 版 CRX→ZIP（CRX2 / CRX3 头解析 + ZIP 魔数回退）
utils/decompress.ts   gzip 解压 + SHA256（diff_id）；zstd 显式报错
utils/tar-builder.ts  流式 TAR（WriteStream + checksum）
utils/downloads.ts    下载目录 + 落盘 + 进度广播 + 取消（AbortController）
utils/history.ts      下载历史增 / 查 / 删 / 清（含可选删文件）
```

**下载统一入口** `DOWNLOAD`：按 `kind` 分发——`docker` 走 `downloadDockerImage`（逐层刷 token → 下载 → 解压 → 打包 `docker load` TAR）；其余走 `downloadSimpleFile`（流式落盘 + 可选 CRX→ZIP）。

- `taskId` 由渲染层 store 生成（`crypto.randomUUID()`），随请求下发；`EVENT_PROGRESS` 按 `taskId` 关联，`CANCEL_DOWNLOAD` 按 `taskId` abort。
- Docker 进度里的 `downloadedBytes / totalBytes` 是**当前层**的字节数，跨层不累计；UI 只在单层内算百分比，并额外显示层序号。
- 上游请求统一走 `net.fetch`（Chromium 网络栈，继承系统代理），不要换回 Node 原生 `fetch`，否则大陆挂代理仍可能连不上 Docker Hub。

**硬约束**：
- 前端不 import backend，经 preload 命名空间 `offlinePack` 调 IPC：统一入口 `renderer/ipc.ts`（`getOfflinePackApi()`，网页预览返回 null）；store / 组件不得自行创建 helper；外链统一走 `@renderer/shared/ipc/openExternal`。
- 工具后端入口由 `scripts/build-electron.mjs` 动态扫描 `tools/*/backend/**/*.ts` 产出，新增工具无需在构建脚本登记（曾因手工清单漏加导致运行时 `Cannot find module`）。
- 下载文件名走 `sanitizeFilename`（去路径分隔符 + 引号），URL 强制 http(s)。

## 3. 渲染层下载任务（`renderer/stores/downloads.ts`）

`useOfflinePackDownloadsStore` 是下载状态的唯一来源，**不要**在页面 / 下载器里再建事件监听或本地任务列表。

- `start(request, title)`：store 生成 `taskId`、插入任务并调用 `DOWNLOAD`；`title` 是展示名（镜像名 / 文件名）。
- `tasks` / `activeTasks` / `activeCount` / `activePercent` / `finishedCount`；`activePercent` 取最新进行中任务，供左栏入口显示。
- 单个 `EVENT_PROGRESS` 监听（`ensureListener`），`applyProgress` 负责状态迁移、成功 / 失败 toast。后端 error 事件与 invoke reject 可能先后到达，store 用任务状态去重，避免同一错误弹两次。
- 支持并发：可同时解析并下载多个来源；换镜像 / 切来源不会清空任务。
- 已结束任务最多保留 `MAX_FINISHED_TASKS = 5` 条（历史里有完整记录），`clearFinished()` 手动清；`dismiss(taskId)` 单条移除。
- 关闭工具时 `OfflinePackPage` 的 `onUnmounted` 调 `reset()`：清空任务并取消所有进行中下载，避免后台继续写盘。
- `taskPercentage()` 是纯函数，只对当前进度计算 0–100，供任务行 / 左栏入口共用。

`DownloadTasks.vue` 只读 store：运行中显示进度 / 层信息 / 取消；完成显示「打开目录」；失败 / 取消可移除。

## 4. 数据落点与历史

| 内容 | 位置 | 层 | 说明 |
|---|---|---|---|
| 下载产物 | `cache/offline-pack/downloads/` | cache | `resolveLayerPath('cache', 'offline-pack', 'downloads')`，可重下，清缓存会删 |
| 下载历史 | `config/offline-pack/history.json` | config | `resolveLayerPath('config', 'offline-pack', 'history.json')`，不可再生 |

- 读取历史走 `resolveLayerPathWithFallback`，兼容 v1 `<data>/offline-pack/history.json`。
- `listHistory()` 按磁盘实况现算 `exists` / `size`：清缓存后历史保留，但前端显示「文件已缺失」。
- 最多保留 `MAX_HISTORY = 200` 条；`HISTORY_DELETE` 可选 `deleteFile`，`HISTORY_CLEAR` 可选 `deleteFiles`。
- 下载完成由主进程 `addHistory()` 落盘，前端不写历史文件。

## 5. Docker 加速镜像

镜像选择持久化在 localStorage `edt:offline-pack:registry-mirror`（`STORAGE_KEYS.offlinePackRegistryMirror`），仅前端偏好，不进配置层。

| 镜像基址 | 支持的上游 |
|---|---|
| `dockerproxy.net` / `docker.1ms.run` / `docker.1panel.live` | 仅 Docker Hub（`docker.io`） |
| `ghcr.1ms.run` | 仅 GHCR（`ghcr.io`） |
| `gh-proxy.com/docker` / `v4.gh-proxy.org/docker` / `v6.gh-proxy.org/docker` / `cdn.gh-proxy.org/docker` | Docker Hub / GHCR / GCR / Quay（多库） |

**路径改写**（`docker-service.ts` 的 `getRegistryConfig` / `repoPath`）：

```text
<mirrorBase>/v2/<pathPrefix><namespace>/<repository>/tags/list
<mirrorBase>/v2/<pathPrefix><namespace>/<repository>/manifests/<ref>

pathPrefix = ''              // docker.io
pathPrefix = '<registry>/'   // ghcr.io / gcr.io / quay.io
```

示例（加速服务 + 原始镜像）：

```text
nginx:latest                      → <mirror>/library/nginx:latest
apache/kafka:latest               → <mirror>/apache/kafka:latest
ghcr.io/immich-app/immich-server  → <mirror>/ghcr.io/immich-app/immich-server
quay.io/prometheus/node-exporter  → <mirror>/quay.io/prometheus/node-exporter
```

- 多库镜像的 `<mirror>` 自带 `/docker` 后缀，例如 `gh-proxy.com/docker/library/nginx`。
- 前端只负责展示镜像「参考示例」与把 `mirror` 传给 IPC；真正的 URL 拼接只在后端，避免两套规则漂移。
- 选中镜像后重新解析会自动刷新标签 / 平台 / 清单。

## 5.1 GitHub Releases / 分支源码 / 单文件（`github-service.ts` + `GitHubDownloader.vue`）

**只做公开仓库**，不做 Token / 私有仓库鉴权——私有资产必须带 `Authorization`，而加速节点是第三方反代，凭据一旦经它转发就等于交出去了。真要做私有仓库，必须强制直连并走 `config` 层 + `secret-box` 加密存储，见 AGENTS.md「凭据静态加密」。

**产品模型：先解析、再选线路。** 没有任何「加速线路」下拉预选——线路是**下载动作的参数**：解析出的每条产物（Release 资产 / 源码包 / 单个文件）下面直接铺一排 split 按钮，每条线路一个（左半下载到本地、右半复制该线路的加速链接），布局对齐 gh-proxy.com 的资产卡。

- 输入解析走 `shared/offline-pack.ts` 的 `parseGithubUrl`（纯函数，前后端共用）：支持 `owner/repo` 简写、仓库页、`/releases`、`/releases/tag/<tag>`、`/releases/download/...`、`/releases/latest/download/...`、`/archive/refs/{tags,heads}/...`、`/blob/<ref>/<path>`、`/raw/<ref>/<path>`、`/tree/<ref>` 与 `raw.githubusercontent.com/...`，并会剥掉 `https://gh-proxy.org/https://github.com/...` 这类拼接前缀（raw / codeload 包装同样剥）。
- **直链模式**：解析出 `directUrl`（release 资产 / 源码归档 / raw 文件）时跳过 API，只渲染一张卡片 + 线路按钮，不消耗匿名配额。
- **仓库模式**：`GITHUB_RELEASES` → `GET /repos/{o}/{r}` + `GET /repos/{o}/{r}/releases?per_page=30`，一次拿回版本与资产（**不要**按版本逐个请求，会把 60 次/小时的匿名配额打光）。
- **按需加载**：分支 / 标签（`GITHUB_REFS` → `branches` + `tags`，各 `per_page=100`）只在切到「分支源码 / 单文件」时才请求；单文件（`GITHUB_FILE` → `contents?ref=`）只在点了「解析文件」后才请求。例如 `docs/README.md` 这类路径解析到 `{ path, name, size, downloadUrl }`，目录会明确报「这是一个目录」。
- **配额**：这些请求共用 `CACHE_TTL_MS = 5 分钟` 的 `Map` 缓存，且发 `If-None-Match`——GitHub 的 304 条件请求不计入速率限制，所以来回切区块基本不扣次数。UI 顶部显示 `API 剩余 N 次`；`403/429` 且 `x-ratelimit-remaining === 0` 时给出带重置时间的可读提示。
- 只过滤 `draft`；`prerelease` 保留并在版本下拉里标注「预发布」。版本下拉默认选「第一个非预发布版本」，链接里点名 tag 时定位到该 tag。
- 资产按 `downloadCount` 降序，**默认只展前 5 个**，其余折进「展开全部 (N)」（一个 release 50+ 资产全铺开反而找不到）。卡片头行是 `文件名 + 体积 chip + 下载次数`。
- 源码包用 **sha 寻址**：`https://codeload.github.com/{o}/{r}/{zip|tar.gz}/{sha}`。分支名可能带 `/`（`release/1.2`），拼进 raw / codeload URL 会歧义，所以 ref 下拉展示名字、真正拼 URL 用 `commit.sha`（格式切换只有 ZIP / tar.gz 两个按钮）。
- 文件名 `${repo}-${tag}-${asset.name}`（源码包 `${repo}-${ref}-source.${fmt}`，单文件 `${repo}-${sha7}-${name}`）：`downloads/` 是平铺目录，不同仓库/版本的同名资产（`app.zip`）不能互相覆盖；非法字符替换为 `_`，后端 `sanitizeFilename` 再兜一层。
- 资产 `digest`（`sha256:...`）已解析进 `OfflinePackGithubAsset`（预留字段），**当前既不展示也不校验**：要启用就在流式写盘时增量 `createHash('sha256')` 比对，别下完再读一遍。

**加速线路**（`OFFLINE_PACK_GITHUB_LINES`，白名单在 shared，后端 `normalizeGithubMirror` 校验，非白名单直接报「加速线路非法」）：

| 按钮文案 | 基址 | 说明 |
|---|---|---|
| Cloudflare (v4) | `https://gh-proxy.org` | 主站，全球分发 |
| Cloudflare (v4) 优选 `推荐` | `https://v4.gh-proxy.org` | 优选节点，仅 IPv4 |
| Cloudflare (v4/v6) | `https://v6.gh-proxy.org` | 支持 IPv6/IPv4 |
| Fastly (v4) | `https://cdn.gh-proxy.org` | CDN 节点 |
| AxisNow (v4) | `https://axisnow.gh-proxy.org` | 三网优选 |
| 直连 | `''` | 不走代理，复制给的是官方原始链接 |

- 线路顺序即按钮顺序，`githubDownloadVariants(officialUrl)` 一次展开成全部变体（`url` / `mirror` / `host` / `recommended`），按钮文案与 tooltip 都从这里来，不在组件里另写一份表。
- 不再有 localStorage 偏好：每次点哪个按钮就是哪条线路（`推荐` 只是视觉标记，不改变行为）。
- **API 永远直连**，只有下载 URL 拼前缀：GitHub 的 API 走代理既受制于对方的 Token 池，也拿不到准确的配额信息。
- **下载侧的三个护栏**：① 校验与下载用同一个「剥离代理前缀后」的官方地址（`unwrapGithubDownloadUrl`），避免 `https://evil/https://github.com/...` 借白名单把请求打到第三方；② 临时文件带 taskId（`<name>.<task8>.part`），同文件被两条线路同时下载不会互相截断，UI 也会在上一个任务未完成时禁用该产物的线路按钮；③ `rejectHtml`：节点用 200 + HTML 错误页冒充文件时直接报「该线路返回的是网页而不是文件」。
- **降级**：分支列表拉取失败时用「默认分支」继续（codeload / contents 都接受普通分支名），源码与单文件区不会整段不可用，并给一个「重试」按钮。
- **线路按钮统一用 `UiSplitButton`**（`renderer/shared/components/ui/`）：左半下载、右半复制，6 条线路一组；文件名清洗也收敛成 `shared/offline-pack.ts` 的 `sanitizeDownloadFilename`，前后端同一份规则。
- **配额可见**：`rateRemaining ≤ 5` 时 chip 转警告色，tooltip 给出重置时间；分支/标签超过单页 100 条时给「只列前 100 个，可粘链接」的说明。
- **直链卡可回到仓库**：「解析该仓库」把 input 换回 `owner/repo` 重新走完整解析，避免用户粘了资产链接后没有入口看整个项目。
- 下载 URL 白名单 `isAllowedGithubDownloadUrl`：仅 `github.com/{o}/{r}/(releases/...|archive/...|raw/...)`、`raw.githubusercontent.com/{o}/{r}/...`、`codeload.github.com/{o}/{r}/(zip|tar.gz)/<sha>`，避免把任意 URL 当反代目标。

## 6. 错误提示

- `safeHandle`（`backend/utils/ipc-safety.ts`）统一包裹 handler：记录 `{ channel, message, original }` 与栈，再抛出可读错误。
- `toReadableIpcMessage`（`backend/utils/ipc-error.ts`）把 Node / 网络错误码翻译成中文（`ENOTFOUND` → 无法解析域名、`ETIMEDOUT` → 连接超时等）；中文业务错误原样保留。
- `toIpcError`（`shared/ipc-error.ts`）在 preload 与 `createIpcHelpers` 统一剥掉 Electron 的 `Error invoking remote method '<channel>':` 前缀，用户只看到真实原因。
- Docker 加速服务的地域限制单独识别：上游返回 `only support mainland China` 时提示 **「仅面向中国大陆地区，请关闭代理后重试」**（`MAINLAND_ONLY_PATTERN` / `MAINLAND_ONLY_MESSAGE`）。
- 新增上游错误时，优先在工具侧给出中文、可执行的一句话；需要原始细节时看主进程日志，不要把 status / body 直接抛给用户。

## 7. 布局与视觉

**DESIGN.md 是唯一权威**：见 §8.4（主工作区表面）与 §9（离线包下载）。本工具的落地约束：

- 不引入 `WorkspaceHeader`；首屏就是「左来源 + 右下载器」，历史不占主区域。
- 左栏来源行固定为图标 + 名称 + 右箭头，激活态用品牌蓝浅底；底部「下载历史」是抽屉开关，有任务时显示脉冲点 + 百分比。
- 历史抽屉从主表面底部展开，内部先任务后历史；抽屉宽度跟随主表面，不另开浮层。
- Docker 镜像层表格行高 34px，digest 列完整展示并提供 tooltip，总计使用 `label-width="auto"`，避免换行。
- 标签 / 架构、VSCode 版本等表单行保持单行；空间不足时优先让表格内部滚动，不把表单行挤成两行。

## 8. 图标资产

`tools/offline-pack/renderer/assets/logos/*.svg`（6 个品牌 logo）：`vscode.svg` / `github.svg` / `chrome.svg` / `edge.svg` / `docker.svg` / `microsoft.svg`。SVG 模块类型声明见 `renderer/shims-vue.d.ts`。

## 9. IPC 通道清单

| 通道 | 入参 → 出参 |
|---|---|
| `VSCODE_QUERY` | url → `{ versions }` |
| `VSCODE_LINK` | url, version → `{ downloadUrl }` |
| `CHROME_SEARCH` / `EDGE_SEARCH` | query → `{ results }` |
| `CHROME_DETAIL` / `EDGE_DETAIL` | id / query → detail |
| `DOCKER_SEARCH` | keyword → 搜索结果 |
| `DOCKER_TAGS` | registry, namespace, repository, mirror? → tags[] |
| `DOCKER_PLATFORMS` | registry, namespace, repository, tag, mirror? → platforms[] |
| `DOCKER_MANIFEST` | registry, namespace, repository, tag, platform?, mirror? → manifest + layers |
| `MSSTORE_RESOLVE` | query → 产品元数据 + files |
| `GITHUB_RELEASES` | input（仓库 / Releases / 资产链接）→ `OfflinePackGithubResolveResult`（仓库元信息 + 版本 + 资产 + 配额） |
| `GITHUB_REFS` | owner, repo → `OfflinePackGithubRefsResult`（分支 / 标签及 sha） |
| `GITHUB_FILE` | owner, repo, ref, path → `OfflinePackGithubFileResult`（路径 / 体积 / raw 直链） |
| `DOWNLOAD` | `OfflinePackDownloadRequest`（simple / docker）→ `OfflinePackDownloadResult` |
| `CANCEL_DOWNLOAD` | taskId → boolean（是否找到并 abort） |
| `OPEN_DIR` | — → true（确保目录存在并打开） |
| `HISTORY_LIST` | — → `OfflinePackHistoryItem[]`（带 `exists` / `size`） |
| `HISTORY_DELETE` | id, deleteFile → 剩余历史 |
| `HISTORY_CLEAR` | deleteFiles → void |
| `EVENT_PROGRESS` | 主进程 → 渲染层 `OfflinePackDownloadProgress` |
