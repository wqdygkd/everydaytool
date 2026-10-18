# offline-pack 模块记忆

> 「离线包下载」工具的开发记忆。
> 后端代理 + 下载落盘在 Electron 主进程，前端视觉。
> 改动相关文件前先读本文对应小节。

## 1. 模块概览

一站式下载 VSCode 插件、Chrome/Edge 扩展、Docker 镜像、Microsoft Store 应用的**离线安装包**，下载到本地 `data-root/offline-pack/downloads/`。

- 工具 id：`offline-pack`；页签：`vscode` / `chrome` / `edge` / `docker` / `msstore`（子路由深链）。
- `supportedTargets: ['win', 'mac']`（下载落盘依赖主进程，web 预览无 IPC）。

## 2. 后端（`tools/offline-pack/backend/`）

```
index.ts            initialize() → registerOfflinePackHandlers()
ipc/channels.ts     11 通道常量（EVENT_PROGRESS 为推送通道）
ipc/handlers.ts     safeHandle 注册 + guard 错误归一 + sanitizeFilename
services/           vscode / chrome / edge / docker / msstore 五个上游代理
utils/http.ts       Node fetch 封装（fetchText/Json/postJson/postForm/fetchBuffer/downloadToFile）
utils/crx.ts        Buffer 版 CRX→ZIP（CRX2/CRX3 头解析 + ZIP 魔数回退）
utils/decompress.ts gzip 解压 + SHA256（diff_id）；zstd 显式报错
utils/tar-builder.ts 流式 TAR（WriteStream + checksum）
utils/downloads.ts  下载目录 + 落盘 + 进度广播 + 取消（AbortController）
```

**下载统一入口** `DOWNLOAD`：按 `kind` 分发——`docker` 走 `downloadDockerImage`（逐层刷 token → 下载 → 解压 → 打包 TAR）；其余走 `downloadSimpleFile`（流式落盘 + 可选 CRX→ZIP）。前端生成 `taskId`，`EVENT_PROGRESS` 按 taskId 关联，`CANCEL_DOWNLOAD` 取消。

**硬约束**：
- 前端不 import backend，经 preload 命名空间 `offlinePack` 调 IPC（`createIpcHelpers('offlinePack', '离线包下载')`）。
- `scripts/build-electron.mjs` 的 `backendEntryPoints` 必须含 `tools/offline-pack/backend/**/*.ts`，否则 esbuild 不产出后端（曾漏加导致运行时 `Cannot find module`）。
- 下载文件名走 `sanitizeFilename`（去路径分隔符 + 引号），URL 强制 http(s)。

## 3. 样式规范

颜色一律走 tool-hub 令牌（品牌蓝 `--color-primary` + 冷灰底 `--color-app-bg`）；**尺寸 / 圆角 / 阴影 / 布局保持一致**。设计值 → 实现映射：

| 元素 | 设计值 | tool-hub 实现 |
|---|---|---|
| hero 标题 | `text-[1.75rem]~text-5xl`（28→48px）bold tracking-tight | 28px + `--font-weight-bold` + `-0.025em` |
| hero 描述 | `text-base`（16px）muted | `--font-size-lg` + `--color-text-secondary` |
| 浮岛卡片 | `rounded-[1.25rem]`（20px）+ `bg-card/80` + `shadow-apple-lg` + `backdrop-blur-xl`（24px） | 20px + `color-mix(...surface-raised 80%)` + 双层阴影 `0 12px 48px / 0 4px 16px` + `blur(24px)` |
| 页签容器 | `rounded-apple`（12px）+ `bg-secondary/60` + `border/50` + `p-1.5`（6px）+ `gap-1.5`（6px）+ blur 8px | 12px + `color-mix(...muted 60%)` + `border/50` + 6px + 6px + `blur(8px)` |
| 页签项 | `rounded-apple-sm`（8px）+ `px-3 py-2.5`（12/10px）+ `text-sm`（14px）+ 图标 16px；激活 `bg-background` + `shadow-apple-button` | 8px + 16/10px + 14px + logo 16px；激活白底 + `0 1px 3px` |
| 输入框 | `h-12`（48px）+ `rounded-apple`（12px）+ border + `bg-background/60` + blur + `shadow-apple-button` | 48px + 12px + border + `color-mix(...surface 60%)` + blur + `0 0 0 1px` inset + `0 1px 3px` |
| 主按钮 | `w-full` + `h-11`（44px）+ `rounded-apple`（12px）+ `text-sm font-semibold` | w-full + 44px + 12px + semibold |
| 示例按钮 | `rounded-full`（999px）+ `px-2.5 py-1`（10/4px）+ `text-xs`（12px）+ muted + `shadow-apple-button`，hover `bg-secondary` | 999px + 10/4px + 12px + muted + `0 1px 3px`，hover `--color-muted` |
| 选择卡片 | `rounded-apple-lg`（16px）+ border + `bg-background/70` + shadow + 小标题 `text-[11px] tracking-[0.08em]` | 16px + border/60 + `color-mix(...surface 70%)` + 11px + `0.08em` |
| 结果卡片 | `border-primary/30` + `bg-primary/5` + icon 块 `h-9 w-9 rounded-apple-sm bg-primary/10` | `color-mix(...primary 30%/5%/10%)` + 36px 块 |

**要点**：
- 阴影用 `shadow-apple-lg`（双层）与 `shadow-apple-button`（`0 1px 3px rgba(0,0,0,.1)`），tool-hub 无对应令牌，按设计值写局部样式。
- 页签用品牌 logo（`assets/logos/*.svg`），el-tabs 经 `#label` 插槽放 `<img>`（16px），彩色 logo 不随主题变色。

## 4. 图标资产

`tools/offline-pack/renderer/assets/logos/*.svg`（5 个品牌 logo）：`vscode.svg` / `chrome.svg` / `edge.svg` / `docker.svg` / `microsoft.svg`。SVG 模块类型声明见 `renderer/shims-vue.d.ts`。

## 5. IPC 通道清单

| 通道 | 入参 → 出参 |
|---|---|
| `VSCODE_QUERY` | url → `{ versions }` |
| `VSCODE_LINK` | url, version → `{ downloadUrl }` |
| `CHROME_SEARCH` / `EDGE_SEARCH` | query → `{ results }` |
| `CHROME_DETAIL` / `EDGE_DETAIL` | id/query → detail |
| `DOCKER_SEARCH` / `DOCKER_TAGS` / `DOCKER_PLATFORMS` | keyword / ns+repo / ns+repo+tag |
| `MSSTORE_RESOLVE` | query → 产品元数据 + files |
| `DOWNLOAD` | `OfflinePackDownloadRequest`（simple/docker）→ `OfflinePackDownloadResult` |
| `CANCEL_DOWNLOAD` / `OPEN_DIR` | taskId / — |
| `EVENT_PROGRESS` | 主进程 → 渲染层推送 `OfflinePackDownloadProgress` |
