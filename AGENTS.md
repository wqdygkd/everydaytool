# AGENTS.md

everydaytool（`edt`，包名 `everydaytool`）多功能工具平台的开发约定，重点记录 UI 设计系统与主题规范。

## 项目概览

Electron + Vue 3 + Pinia + Element Plus + Vite + SCSS 多工具平台。首个工具模块为 Chrome沙箱。

## 设计系统（重要）

全局样式集中在 `renderer/shared/styles/main.scss`，采用**CSS 变量设计令牌（Design Tokens）**。所有 Vue 组件必须通过 `var(--token)` 引用令牌，**禁止硬编码颜色 / 圆角 / 阴影**。

### 主题（固定浅色）

应用固定使用浅色暖调主题，无主题切换逻辑（旧的双主题切换已移除）：品牌红 `#ff2442`，底 `#fbf3f1`，表面 `#ffffff`。全部令牌直接定义在 `main.scss` 的 `:root`。新增颜色一律用语义 token，禁止硬编码。

### 令牌清单（保留原名，勿删除）

组件引用的令牌：

- **颜色**：`--color-primary` / `-hover` / `-soft` / `-light`、`--color-accent`、`--color-info`、`--color-success` / `-warning` / `-error`、`--color-app-bg`、`--color-surface`、`--color-surface-raised`、`--color-muted`、`--color-border` / `-light`、`--color-text-primary` / `-secondary` / `-tertiary`
- **字阶**：`--font-size-xs/sm/base/lg/xl/2xl`、`--font-weight-regular/medium/semibold/bold`
- **等宽数字字体**：`--font-mono`（看板数字 / tabular-nums 用）
- **间距**：`--spacing-xs/sm/md/lg/xl/2xl`
- **圆角**：`--radius-xs/sm/md/lg/xl`
- **阴影**：`--shadow-sm/md/lg`、`--shadow-focus`
- **过渡**：`--transition-fast/base/slow`

### Element Plus 绑定

Element Plus 的 `--el-*` 变量已在 `main.scss` 的 `:root` 中绑定到上述令牌。弹层遮罩色用 `--el-mask-color`。新增 Element Plus 相关样式应沿用这套绑定方式。

### 字体

正文 UI 字体栈位于 `:root` 的 `font-family`（Fira Sans + 系统中文字体），数字/等宽用 `var(--font-mono)`（Fira Code）。保持 `font-variant-numeric: tabular-nums` 对齐看板数字。

## 编码规范

- 前端（`renderer/**`、`tools/*/renderer/**`、`tools/*/index.ts`）：TS 相对导入无后缀，Vue SFC 保留 `.vue`。
- Electron/后端（`electron/**`、`tools/*/backend/**`）：Node ESM，源码相对 TS 导入写 `.js` 运行时后缀。
- 前端禁止直接 `import tools/*/backend/**`，必须经 preload 暴露的 IPC 调用（`invokeIpc` / `onIpc`）。
- `shared/**` 只能放纯类型 / 常量 / 纯函数，不依赖 Electron、Node、数据库。
- 高度链必须完整：`flex` 容器 + `flex:1` 子项需配 `min-height:0`，避免内容溢出。

## 布局 / 交互要点

- 主壳 `renderer/App.vue`：自定义标题栏（VS Code 风格，`electron/main.ts` 用 `titleBarStyle: 'hidden'` 隐藏系统标题栏）：Header 即标题栏（标题 + 页内菜单 `AppMenuBar`，仅 Windows/Linux，动作经 `edtRuntime.menuAction`），工具页签独立成行（`.header-tabs`）位于标题栏行之下；标题栏整行 `-webkit-app-region: drag`；右上角原生窗口按钮用 `titleBarOverlay`，固定浅色配色。Footer 含脉动状态点，路由切换使用 `.page-*` 过渡类。
- 首页 `renderer/pages/HomePage.vue`：工具网格用 `TransitionGroup`（`.card-*` 类）实现搜索 / 收藏平滑重排动画。
- 动效尊重 `prefers-reduced-motion`（已在 `main.scss` 全局降级）。

### 通用工具类（`main.scss`，新工具优先复用）

工具页在 `main.scss` 已有通用类，**优先复用避免重复样式**，同时保证多工具风格统一：

| 类 | 用途 |
|----|------|
| `.tool-page` | 工具页容器：填充主区域并在内部滚动（`flex:1; min-height:0; overflow:auto; background`） |
| `.surface-card` | 表面卡片：`surface-raised` + `border-light` + `radius-lg` 边框 |
| `.detail-grid` / `.detail-item` | 详情卡片网格（label + value，卡片式） |
| `.kv-row`（`.kv-label` / `.kv-value`） | 键值行（顶部分隔线式） |
| `.form-hint` | 表单辅助说明文字 |
| `.muted` | 弱化文本（`--color-text-secondary`） |
| `.mono` | 等宽数字字体（`var(--font-mono)`） |
| `.chip` | 徽章 / 计数小胶囊 |
| `.inline-group` | 行内控件组（`flex` + `gap`） |

约定：
- 数字 / 等宽一律用 `.mono`（`var(--font-mono)`），禁止硬编码 `Consolas` / `ui-monospace` 等字体栈。
- 弱化说明文字用 `.muted` 或 `--color-text-secondary`，统一用语义色不用 `--el-text-color-*` 做排版。
- 新增工具遇到重复样式时，先考虑扩展现有通用类，而非复制一份组件局部样式。


## 常用命令

```bash
pnpm dev          # 开发模式（Electron + Vite）
pnpm vite build   # 仅构建前端
pnpm typecheck    # TS 类型检查
pnpm lint         # ESLint（含 tools 内文件）
pnpm build        # 完整构建
pnpm dist         # 打包安装程序
```

## 文件定位速查

| 查找内容 | 位置 |
|----------|------|
| 设计令牌 / 主题(浅色) | `renderer/shared/styles/main.scss` |
| 主题切换逻辑 | `renderer/App.vue` |
| 首页工具网格 | `renderer/pages/HomePage.vue` |
| 工具卡片组件 | `renderer/shared/components/ToolCard.vue` |
| 工具注册 | `renderer/config/tools.ts` |
| 路由配置 | `renderer/router/routes.ts` |
| IPC 通道 | `tools/chrome-sandbox/backend/ipc/channels.ts` |
| IPC 处理 | `tools/chrome-sandbox/backend/ipc/handlers.ts` |
| 沙箱数据库 | `tools/chrome-sandbox/backend/store/database.ts` |
