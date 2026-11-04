# offline-pack 模块记忆

> 「离线包下载」工具的开发记忆。
> 上游解析 / 鉴权 / 落盘全在 Electron 主进程，渲染层只管参数、任务与历史展示。
> 改动相关文件前先读本文对应小节。

## 1. 模块概览

一站式下载 VSCode 插件、Chrome / Edge 扩展、Docker 镜像、Microsoft Store 应用的**离线安装包**。产物落在缓存层 `cache/offline-pack/downloads/`，下载历史在配置层 `config/offline-pack/history.json`（见 §4）。

- 工具 id `offline-pack`；来源页签 `vscode` / `chrome` / `edge` / `docker` / `msstore`，由子路由 `/tools/offline-pack/<tab>` 驱动。
- `supportedTargets: ['win', 'mac']`（落盘依赖主进程；web 预览没有 IPC）。
- 页面只有一块 `ToolSurface`，且**只使用主体区**（无 `surface-toolbar` / `statusline`）：
  - 左：268px `ToolSideInspector`，5 个来源纵向切换，底部固定「下载历史」入口；
  - 右：当前下载器（`KeepAlive`，切换来源保留表单与解析结果）；
  - 底部抽屉：`DownloadTasks`（进行中 / 刚结束的任务）+ `HistorySection`（落盘历史）。
- 工具页**没有** `WorkspaceHeader` / 顶部工具标题栏；工具上下文（图标 / 名称 / 说明）由全局标题栏提供。

## 2. 后端（`tools/offline-pack/backend/`）

```text
index.ts              initialize() → registerOfflinePackHandlers()
ipc/channels.ts       18 个通道常量（EVENT_PROGRESS 为推送通道）
ipc/handlers.ts       safeHandle 注册 + guard 错误归一 + 参数校验 / 文件名清洗
services/             vscode / chrome / edge / docker / msstore 五个上游代理
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

`tools/offline-pack/renderer/assets/logos/*.svg`（5 个品牌 logo）：`vscode.svg` / `chrome.svg` / `edge.svg` / `docker.svg` / `microsoft.svg`。SVG 模块类型声明见 `renderer/shims-vue.d.ts`。

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
| `DOWNLOAD` | `OfflinePackDownloadRequest`（simple / docker）→ `OfflinePackDownloadResult` |
| `CANCEL_DOWNLOAD` | taskId → boolean（是否找到并 abort） |
| `OPEN_DIR` | — → true（确保目录存在并打开） |
| `HISTORY_LIST` | — → `OfflinePackHistoryItem[]`（带 `exists` / `size`） |
| `HISTORY_DELETE` | id, deleteFile → 剩余历史 |
| `HISTORY_CLEAR` | deleteFiles → void |
| `EVENT_PROGRESS` | 主进程 → 渲染层 `OfflinePackDownloadProgress` |
