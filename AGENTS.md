# AGENTS.md

everydaytool（`edt`，包名 `everydaytool`）多功能工具平台的**工程约定**：目录边界、编码规范、IPC 约束、页签 / 路由机制、窗口状态持久化、命令与文件定位。

> **UI 设计规范不在本文件**：设计令牌、组件库、布局与动效、半透明与玻璃的唯一权威是 [DESIGN.md](./DESIGN.md)。改任何 UI 之前先读它的 §3（令牌）、§5（组件库）、§6（工具类）、§7（布局）。

## 项目概览

Electron + Vue 3 + Pinia + Element Plus + Vite + SCSS 多工具平台，内置工具模块（chrome-sandbox / env-browser / interceptor / offline-pack / treease-editor / wxp-enhancer / id-card-generator / telegram-cache / workbuddy2api-panel）。

## 编码规范

- 前端（`renderer/**`、`tools/*/renderer/**`、`tools/*/index.ts`）：TS 相对导入无后缀，Vue SFC 保留 `.vue`。
- Electron/后端（`electron/**`、`backend/**`、`tools/*/backend/**`）：Node ESM，源码相对 TS 导入写 `.ts` 后缀（`scripts/build-electron.mjs` 的 esbuild 插件在产物中还原为 `.js` 运行时后缀）。
- 前端禁止直接 `import backend/**` 或 `import tools/*/backend/**`，必须经 preload 暴露的 IPC API 调用（`renderer/shared/ipc/createIpcHelpers` 工厂）。**每个工具的 `renderer/ipc.ts` 是唯一 helper 实例**，store / 页面不得自行 `createIpcHelpers`；外链统一走 `@renderer/shared/ipc/openExternal`（不得直接摸 `window.edtRuntime`）。
- `shared/**` 只能放纯类型 / 常量 / 纯函数，不依赖 Electron、Node、文件系统存储。
- `backend/**` 是**平台级后端基建**（logger / file-ops / 应用数据根目录 data-root / JSON 文档存储 json-store），被多个工具的后端共用；工具域专属逻辑留在各自 `tools/<id>/backend/`，禁止工具间互相 import 对方的 backend。
- 本地数据一律是应用数据根目录下的 JSON 文件（`backend/utils/json-store.ts`：进程内缓存 + 临时文件 rename 原子写入），**不引入数据库 / 原生依赖**；工具域按 `<工具 id>/xxx.json` 分文件存放。
- 高度链必须完整：`flex` 容器 + `flex:1` 子项需配 `min-height:0`，避免内容溢出。

## UI 规范的落点（工程侧）

样式与组件在代码里的位置固定，**细则见 DESIGN.md，不要在本文件另立规范**：

- 全局样式入口 `renderer/shared/styles/main.scss`（按 tokens → base → element-plus → utilities → translucency 顺序 `@use`）。
- Element Plus 覆写**只写**在 `renderer/shared/styles/element-plus.scss`（注入顺序 / 几何差异的坑见 DESIGN §4）。
- 平台组件库在 `renderer/shared/components/ui/`，由 `unplugin-vue-components` 自动注册（模板直接用，无需 import）。
- 组件用法硬约束（`UiTable` / `UiProgress` / `UiChip` 的强制范围）由 `pnpm check:ui` 断言；改 UI 后跑一次。

## 布局与页签机制（工程侧）

- **设置是页签，不是弹窗**：入口在标题栏右端（`.header-settings`），点击打开 `/settings` 页签。应用自带页面（设置等）与工具页共享同一套页签机制——注册在 `renderer/config/app-tabs.ts`（含 `id` / `routeName` / 组件），路由由 `router/routes.ts` 拍平成顶层记录并带 `meta.toolId`，`stores/toolTabs.ts` 把它当作普通页签解析，`App.vue` 用同一张表常驻挂载。**新增应用级页面加一条 `APP_TABS` 记录即可**，不要再写独立弹窗或往首页塞入口。
  桌面端专属页面（如设置：数据目录 / 空间占用 / 缓存清理 / 窗口外观 / 窗口大小与位置都依赖主进程）必须标 `electronOnly: true`——路由、页签名解析与标题栏入口统一走 `getAppTabs()` / `findAppTab()`，网页预览下该页面整体不存在（深链落到兜底回首页），不会去调不存在的 IPC。
  命名上刻意区分：`AppTab` / `APP_TABS` 指应用自带页面，**不要写成 `Shell*`**——Electron 的 `shell` 模块（`openPath` / `openExternal`）在 backend 里随处可见，两套 `shell` 并存会让阅读反复停顿。
- 工具子路由：工具定义可声明 `subRoutes`（`ToolSubRoute`，`shared/types/tool.ts`），由 `renderer/router/routes.ts` 拍平为 `/tools/<工具>/<子路径>`；子路由继承主路由组件与 `meta.toolId`（页签高亮与常驻挂载依赖它），主路由是纯 redirect 记录（无 component）落到第一个子路由。工具内多视图（页签 / 列表分类）优先走子路由 + 路由驱动状态，不用纯本地 ref；入口统一按 `tool-<id>` / 子路由 name 跳转。范例：interceptor（4 页签 + 10 规则类型），映射集中在 `tools/interceptor/renderer/tabs.ts`。
- 主壳标题栏、首页网格、工具页布局、页签外观与动效的视觉规范见 [DESIGN.md](./DESIGN.md) §7、§8（动效尊重 `prefers-reduced-motion`）。

## 窗口外观（半透明 / 系统材质 · 工程侧）

颜色 / alpha / 玻璃的取值与调节方式见 DESIGN §3.1、§7.1.1；**这里是状态归属与平台能力判定的工程约束**：

- 唯一事实来源是主进程（`backend/utils/appearance-store.ts` 持久化到 `<data>/app/window-appearance.json`），渲染层用 `renderer/shared/composables/useAppearance.ts` 只做拉取 + 订阅 + 提交，**不得在 localStorage 留第二份状态**。
- 平台能力判定必须走 `shared/appearance.ts` 的纯函数（`resolveAppearanceCapabilities` / `sanitizeWindowAppearance`），禁止在主进程和渲染层各写一份 `process.platform ===` 判断。
- `transparent` / `vibrancy` / `backgroundMaterial` 只在 `BrowserWindow` 构造时生效：改外观实现时要保证 `loadWindowAppearance()` 先于 `createWindow()` 执行。
- 模式类由 `App.vue` 同时挂到 `.app-shell` 与 `<html>`；新增窗口模式只加一条模式规则（alpha + glass 两组），组件零改动。

## 窗口大小与位置（记住上次几何）

- 主进程同样是唯一事实来源（`backend/utils/window-bounds-store.ts` → `<data>/app/window-bounds.json`），渲染层（设置页签 →「窗口大小与位置」）只经 IPC 读取状态、提交开关 / 重置，**不自己记几何**。
- **恢复判定是纯逻辑**：`shared/window-bounds.ts` 的 `resolveWindowPlacement` 只认「仍落在某块屏工作区内、且可见面积足够拖动」的记录；外接屏拔掉 / 分辨率变小时返回 `null`，主进程改用默认尺寸让 Electron 居中——绝不允许把窗口还原到屏幕外。坐标换算 / 越界收敛都写在这里，主进程只做传参。
- `enabled` / `maximized` / `bounds` 三个字段：关闭开关即不记录也不恢复；最大化只记标记，几何恒取 `getNormalBounds()`（还原后的尺寸），下次先按普通态建窗再 `maximize()`。
- 存储走**同步** JSON 存储（`backend/utils/json-store.ts`），不用外观那套异步写：`move` / `resize` 高频触发，关窗时还必须在进程退出前落盘。写入用 400ms debounce + 值不变不写，`close` 时立刻 flush。

## 常用命令

```bash
pnpm install      # 安装依赖（Node 22+ / pnpm 10+，勿用 npm）
pnpm dev          # 开发模式（Electron + Vite），默认不自动打开 DevTools
EDT_DEVTOOLS=1 pnpm dev   # 同上，但启动时自动打开 DevTools（调试启动问题用）
pnpm web          # 纯浏览器预览（无 preload / IPC：只列 supportedTargets 含 web 的工具，桌面端专属页面不注册）
pnpm create:tool <id>     # 脚手架：新建工具目录并自动注册
pnpm vite build   # 仅构建前端
pnpm typecheck    # TS 类型检查（前端 + 后端两套 tsconfig）
pnpm check:ui     # EP 用法断言（el-tag / el-empty / el-progress / el-table 收敛状态）
pnpm lint         # ESLint（含 tools 内文件）
pnpm lint:fix     # ESLint 自动修复
pnpm build        # 完整构建
pnpm start        # 运行已构建产物
pnpm dist         # 打包安装程序
```

## 新增工具

优先用脚手架，它会建好目录骨架并完成注册：

```bash
pnpm create:tool <tool-id>
```

手动创建时，工具定义写在 `tools/<tool>/index.ts`（`defineTool` 内部会包 `defineAsyncComponent`，
工具页天然按需加载，主包只保留首页与应用壳）：

```ts
import { defineTool } from '../../renderer/shared/tool/defineTool'

export default defineTool({
  id: 'tool-name',
  name: '工具名称',
  description: '工具描述',
  version: '1.0.0',
  color: '#3390ec',
  icon: 'toolbox',
  category: { key: 'general', name: '通用工具' },
  keywords: ['tool-name'],
  supportedTargets: ['web', 'win', 'mac', 'linux'], // web 网页端 / win Windows / mac macOS / linux
  route: {
    path: 'tool-name',
    name: 'tool-tool-name',
    component: () => import('./renderer/pages/ToolPage.vue'),
    meta: { toolId: 'tool-name', title: '工具名称' },
  },
})
```

- 路由由 `renderer/config/tools.ts` 的注册表自动汇总，无需手工登记路由。
- `meta.toolId` 必填：页签高亮与常驻挂载依赖它。
- 工具内多视图（页签 / 分类）用 `subRoutes` + 路由驱动状态，不要用纯本地 ref（详见「布局与页签机制」）。
- **UI 一律先读 [DESIGN.md](./DESIGN.md)**：新页面优先复用 §5 的组件与 §6 的工具类，不要在业务文件里重写卡片 / 分组 / 表格 / 提示的通用样式。

## 文件定位速查

### 样式与 UI

| 查找内容 | 位置 |
| ---------- | ------ |
| 设计令牌 / 主题(浅色) | `renderer/shared/styles/tokens.scss` |
| 全局样式入口（@use 顺序） | `renderer/shared/styles/main.scss` |
| Element Plus `--el-*` 绑定与组件覆写 | `renderer/shared/styles/element-plus.scss` |
| 半透明窗口 alpha / 玻璃控制层（按模式覆写） | `renderer/shared/styles/translucency.scss` |
| **UI 组件库（面板/分组/键值/表格/进度/对话框等 27 组件）** | `renderer/shared/components/ui/` |
| UI 设计规范（令牌 / 组件 / 布局 / 动效） | `DESIGN.md` |
| **EP 接触面收敛计划（B0–B6 批次 / 验收断言）** | `docs/ui-ep-convergence-plan.md` |
| EP 用法断言（`pnpm check:ui`） | `scripts/ui-ep-check.mjs` |

### 外壳与页面

| 查找内容 | 位置 |
| ---------- | ------ |
| 应用外壳 / 标题栏（平台适配 / 页签 / 全屏） | `renderer/App.vue` |
| **应用自带页面注册（设置等应用级页签）** | `renderer/config/app-tabs.ts` |
| 设置页（数据目录 / 空间占用 / 窗口外观 / 窗口大小与位置） | `renderer/pages/SettingsPage.vue` |
| 首页工具网格 | `renderer/pages/HomePage.vue` |
| 工具卡片组件 | `renderer/shared/components/ToolCard.vue` |
| 工具注册 | `renderer/config/tools.ts` |
| 路由配置 | `renderer/router/routes.ts` |

### 后端与 IPC

| 查找内容 | 位置 |
| ---------- | ------ |
| IPC 通道 | `tools/chrome-sandbox/backend/ipc/channels.ts` |
| IPC 处理 | `tools/chrome-sandbox/backend/ipc/handlers.ts` |
| 沙箱数据（`sandboxes.json` / `fingerprints.json` / `config.json`） | `tools/chrome-sandbox/backend/store/` |
| 环境浏览器账号（`envs.json`） | `tools/env-browser/backend/store/env-store.ts` |
| 平台后端基建（logger / file-ops / 数据根目录 / JSON 存储） | `backend/utils/` |
| IPC 调用方白名单（safeHandle / safeOn sender 校验） | `backend/utils/ipc-safety.ts` |
| IPC 发送方 URL 白名单（主进程 + 导航闸共用） | `backend/utils/ipc-sender.ts` |
| 路径边界守卫（路径包含 / 数据目录合法性） | `backend/utils/path-guard.ts` |
| **数据目录 / 缓存位置总览与切换迁移** | `docs/data-directory.md` |
| **Chromium 会话目录（sessionData）重定向** | `backend/utils/session-data.ts` |
| 数据目录整体迁移（切换时复制→校验→删除） | `backend/utils/data-migration.ts` |
| JSON 文档存储（同步缓存 + 原子写入） | `backend/utils/json-store.ts` |
| 应用数据根目录 / 数据目录切换 | `backend/utils/data-root.ts` |
| 窗口外观设置（半透明 / 材质）持久化 | `backend/utils/appearance-store.ts` |
| 平台能力判定（透明 / 材质 / vibrancy） | `shared/appearance.ts` |
| 渲染层外观状态 composable | `renderer/shared/composables/useAppearance.ts` |
| 窗口大小 / 位置持久化（记住上次几何） | `backend/utils/window-bounds-store.ts` |
| 窗口几何恢复 / 越界收敛（纯逻辑） | `shared/window-bounds.ts` |

### 模块记忆（工具域）

| 查找内容 | 位置 |
| ---------- | ------ |
| **wxp-enhancer 模块记忆（目标应用逆向 / 注入脚本约束 / 验证手法）** | `docs/wxp-enhancer.md` |
| **telegram-cache 模块记忆（观测口径 / 单飞去重 / HTTP 缓存与本地响应 / 页面捕获与 MTProto 边界）** | `docs/telegram-cache.md` |
| **treease-editor 模块记忆（sessionData 物理落盘 / 拦截缓存常驻）** | `docs/treease-editor.md` |
| **workbuddy2api-panel 模块记忆（托管上游二进制 / 探活 / 更新回滚）** | `docs/workbuddy2api-panel.md` |
