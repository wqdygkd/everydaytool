# offline-pack 模块记忆

> 本项目为 Tauri 2 + Rust 原生后端，Electron 专有概念（preload / IPC 通道白名单 / 主进程）已替换为 Tauri command 口径。
>
> 「离线包下载」工具的开发记忆。
> 后端代理 + 下载落盘全部在 Rust 原生后端（`src-tauri/src/offline_pack/`），前端视觉在 `tools/offline-pack/`。
> 改动相关文件前先读本文对应小节。

## 1. 模块概览

一站式下载 VSCode 插件、Chrome/Edge 扩展、Docker 镜像、Microsoft Store 应用的**离线安装包**，下载到本地
`<data>/offline-pack/downloads/`，下载历史记在 `<data>/offline-pack/history.json`。

- 工具 id：`offline-pack`；页签：`vscode` / `chrome` / `edge` / `docker` / `msstore`（`subRoutes` 声明在 `tools/offline-pack/index.ts`，路径↔页签映射集中在 `tools/offline-pack/tabs.ts`，路由即页签状态、可深链）。
- `supportedTargets: ['win', 'mac']`（下载落盘依赖桌面壳，web 预览没有 Tauri command 桥接）。
- 数据目录由 `appearance::resolve_data_dir()` 解析，切换数据目录随启动时的整目录迁移一起搬走（见 `docs/data-directory.md`）。

## 2. 后端（`src-tauri/src/offline_pack/`）

```
mod.rs          命令分发 handle()（命令名与 shared/command-groups/offline-pack.ts 一一对应）
http.rs         reqwest blocking 封装（统一 UA / 默认 60s 超时 / Windows 系统代理 / DownloadControl 进度+取消）
marketplaces.rs vscode / chrome / edge 三个上游代理（版本、搜索、详情、下载地址）
docker.rs       Docker Registry 代理（token / manifest / platforms / 逐层下载 / docker load TAR 打包）
msstore.rs      Microsoft Store 应用解析（产品元数据 + files）
downloads.rs    下载目录 + 落盘 + 进度事件 + 取消集合 + CRX→ZIP
history.rs      下载历史（JSON 原子写，上限 200 条）
```

**下载统一入口** `offline-pack:download`：按 `kind` 分发——`docker` 走 `docker::download_docker_image`
（逐层刷 token → 下载 → 解压 → 打包 TAR）；其余走 `downloads::download_simple_file`
（流式落盘到 `<filename>.part` → 可选 CRX→ZIP → rename 成最终文件 → 成功后写历史）。
前端生成 `taskId`（`crypto.randomUUID()`），进度事件经 `edt:event` 的 `channel: 'offline-pack:event:progress'`
按 `taskId` 关联，`offline-pack:download:cancel` 把 taskId 放进取消集合，下载循环在下一块读取时退出。

**硬约束**：
- 前端不直接碰 Rust 后端，经工具自己的 `api.ts` 调 Tauri command：唯一出口 `tools/offline-pack/api.ts` 的
  `getOfflinePackApi()`（内部 `createCommandHelpers('offlinePack', ...)`，网页预览返回 null）；
  store / 组件不得自行创建 helper；外链统一走 `api.ts` 的 `openExternal`（转 `@/desktop/platform`）。
- 工具注册是**动态入口扫描**：渲染层路由由 `src/config/tools.ts` 汇总 `tools/*/index.ts`，新增工具不需要手工登记路由。
  但**后端入口不是**——Rust 模块在 `src-tauri/src/lib.rs` 编译期注册，命令表要同时改
  `shared/command-groups/offline-pack.ts`（前端可见的命令名）与 `mod.rs::handle`（分发分支）两处，
  只改一边的后果是运行期 `未实现的离线包命令：…` / `command not allowed`。
- 下载文件名走 `sanitize_filename`（去路径分隔符 + 引号 / 换行），URL 强制 http(s)。

**运行时差异（务必按本项目口径理解）**：
- 下载产物在 `<data>/offline-pack/downloads/`，历史在 `<data>/offline-pack/history.json`；两者都在数据目录下，换目录时随迁移搬走。
- 外部下载**不**受 telegram-cache 域的 `maxResourceBytes` 约束（那是 `src-tauri/src/telegram/` 自己的策略）；
  本项目 offline-pack 只统一 UA 与单请求超时（`http.rs::DEFAULT_TIMEOUT_MS = 60_000`），
  体积 / 限速 / 上游可用性以各上游与 `http.rs` 为准（以代码为准）。

## 3. 样式规范

> **本项目现状**：离线包页已收敛到平台 UI 组件库 —— `UiMenuHorizontal`（品牌 logo 页签）+ `UiPanel`（工作区）+
> `DownloaderFrame`（五个下载器共用的表单骨架：`UiGroup` / `UiHint` / `el-input` / `el-button`）+ `HistorySection`，
> 尺寸与外观交给 `src/shared/styles/tokens.scss` 令牌，阴影用 `--shadow-sm` / `--shadow-md` / `--shadow-lg`，
> 不写死 `rgba(...)` / `blur(Npx)`。下表是原设计值 → 旧 tool-hub 实现的映射，保留作风格参照（当前实现不再逐条复刻这些局部值）。

颜色一律走设计令牌（品牌蓝 `--color-primary` + 冷灰底 `--color-app-bg`）；**尺寸 / 圆角 / 阴影 / 布局保持一致**。设计值 → 旧实现映射：

| 元素 | 设计值 | 旧 tool-hub 实现 |
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
- 阴影在原实现里用 `shadow-apple-lg`（双层）与 `shadow-apple-button`（`0 1px 3px rgba(0,0,0,.1)`），旧 tool-hub 无对应令牌才写局部样式；
  本项目的令牌目录里已有 `--shadow-sm` / `--shadow-md` / `--shadow-lg`，**新写样式一律引用令牌，不要恢复局部阴影常量**。
- 页签用品牌 logo（`tools/offline-pack/assets/logos/*.svg`），页签栏统一用 `UiMenuHorizontal` 的 `icon`（16px），彩色 logo 不随主题变色。

## 4. 图标资产

`tools/offline-pack/assets/logos/*.svg`（5 个品牌 logo）：`vscode.svg` / `chrome.svg` / `edge.svg` / `docker.svg` / `microsoft.svg`。
SVG 模块类型声明在 `src/shims-vue.d.ts`。

## 5. 命令清单

Tauri command 只有一条：`offline_pack_command`（`{ command, args }`），命令名与 `shared/command-groups/offline-pack.ts` 同源。

| 命令（`OFFLINE_PACK_COMMANDS`） | 通道名 | 入参 → 出参 |
|---|---|---|
| `VSCODE_QUERY` | `offline-pack:vscode:query` | url → `{ versions }` |
| `VSCODE_LINK` | `offline-pack:vscode:link` | url, version → `{ downloadUrl }` |
| `CHROME_SEARCH` / `EDGE_SEARCH` | `offline-pack:chrome:search` / `offline-pack:edge:search` | query → `{ results }` |
| `CHROME_DETAIL` / `EDGE_DETAIL` | `offline-pack:chrome:detail` / `offline-pack:edge:detail` | id/query → detail |
| `DOCKER_SEARCH` / `DOCKER_TAGS` / `DOCKER_PLATFORMS` | `offline-pack:docker:search` / `:tags` / `:platforms` | keyword / ns+repo / ns+repo+tag |
| `DOCKER_MANIFEST` | `offline-pack:docker:manifest` | registry, ns, repo, tag, platform, mirror → manifest |
| `MSSTORE_RESOLVE` | `offline-pack:msstore:resolve` | query → 产品元数据 + files |
| `DOWNLOAD` | `offline-pack:download` | `OfflinePackDownloadRequest`（simple/docker）→ `OfflinePackDownloadResult` |
| `CANCEL_DOWNLOAD` / `OPEN_DIR` | `offline-pack:download:cancel` / `offline-pack:open-dir` | taskId / — |
| `HISTORY_LIST` / `HISTORY_DELETE` / `HISTORY_CLEAR` | `offline-pack:history:list` / `:delete` / `:clear` | — / id + 是否删文件 / 是否删文件 |
| `EVENT_PROGRESS` | `offline-pack:event:progress` | Rust → 渲染层推送 `OfflinePackDownloadProgress`（经 `edt:event` 的 `channel`） |
