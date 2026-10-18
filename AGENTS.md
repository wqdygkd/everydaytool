# AGENTS.md

everydaytool（`edt`，包名 `everydaytool`）多功能工具平台的开发约定，重点记录 UI 设计系统与主题规范。

## 项目概览

Electron + Vue 3 + Pinia + Element Plus + Vite + SCSS 多工具平台，内置 6 个工具模块（interceptor / chrome-sandbox / env-browser / treease-editor / wxp-enhancer / id-card-generator）。

## 设计系统（重要）

全局样式集中在 `renderer/shared/styles/main.scss`，采用**CSS 变量设计令牌（Design Tokens）**。所有 Vue 组件必须通过 `var(--token)` 引用令牌，**禁止硬编码颜色 / 圆角 / 阴影**。固定浅色主题（Telegram Web A 风格），无主题切换。

> 令牌是「语义基线」而非冻结清单：未引用的令牌应删除、纯别名令牌应合并到主令牌（`--color-surface` / `--color-surface-raised` 为浮岛语义对，保留区分）；重命名 / 合并 / 删除令牌时需同步全部引用。

**完整令牌目录（颜色/字阶/间距/圆角/阴影/过渡的值与用途）、字体栈、Element Plus `--el-*` 绑定、布局模式与组件 props/状态规范见 [DESIGN.md](./DESIGN.md)。** 此处只保留硬性约定：

- 覆写 Element Plus 只写几何差异（高度 / 圆角 / 边框宽度），颜色与状态交给全局绑定；视觉不一致时优先改全局绑定，不要单点堆 `:deep`。
- 数字 / 等宽一律用 `.mono`（`var(--font-mono)`），禁止硬编码 `Consolas` / `ui-monospace` 等字体栈。
- 字母头像（工具卡片头像、品牌标）用自托管 Nunito ExtraBold 800。

## 编码规范

- 前端（`renderer/**`、`tools/*/renderer/**`、`tools/*/index.ts`）：TS 相对导入无后缀，Vue SFC 保留 `.vue`。
- Electron/后端（`electron/**`、`backend/**`、`tools/*/backend/**`）：Node ESM，源码相对 TS 导入写 `.ts` 后缀（`scripts/build-electron.mjs` 的 esbuild 插件在产物中还原为 `.js` 运行时后缀）。
- 前端禁止直接 `import backend/**` 或 `import tools/*/backend/**`，必须经 preload 暴露的 IPC API 调用（`renderer/shared/ipc/createIpcHelpers` 工厂，或各工具的 `ipc.ts`）。
- `shared/**` 只能放纯类型 / 常量 / 纯函数，不依赖 Electron、Node、数据库。
- `backend/**` 是**平台级后端基建**（logger / file-ops / 应用数据根目录 data-root），被多个工具的后端共用；工具域专属逻辑留在各自 `tools/<id>/backend/`，禁止工具间互相 import 对方的 backend。
- 高度链必须完整：`flex` 容器 + `flex:1` 子项需配 `min-height:0`，避免内容溢出。

## 布局 / 交互要点

- 主壳 `renderer/App.vue`：自定义标题栏（`electron/main.ts` 用 `titleBarStyle: 'hidden'` 隐藏系统标题栏 + `titleBarOverlay` 右上角窗口按钮）；标题栏整行 `-webkit-app-region: drag`，页签区 no-drag；页内菜单已移除，菜单动作仅由主进程系统菜单提供（清单见 `shared/menu.ts`）；底部状态栏已删除，主区直抵窗口底缘。
- 首页 `renderer/pages/HomePage.vue`：工具网格按分类分组，支持搜索 / 收藏。
- 工具子路由：工具定义可声明 `subRoutes`（`ToolSubRoute`，`shared/types/tool.ts`），由 `renderer/router/routes.ts` 拍平为 `/tools/<工具>/<子路径>`；子路由继承主路由组件与 `meta.toolId`（页签高亮与常驻挂载依赖它），主路由是纯 redirect 记录（无 component）落到第一个子路由。工具内多视图（页签 / 列表分类）优先走子路由 + 路由驱动状态，不用纯本地 ref；入口统一按 `tool-<id>` / 子路由 name 跳转。范例：interceptor（4 页签 + 10 规则类型），映射集中在 `tools/interceptor/renderer/tabs.ts`。
- 标题栏与页签外观、工具页布局、入场与过渡动效等视觉 / 交互规范见 [DESIGN.md](./DESIGN.md) §7、§8（动效尊重 `prefers-reduced-motion`）。

### UI 组件库（`renderer/shared/components/ui/`，新工具优先复用）

平台级 UI 组件库（25 个组件 + `icons.ts` 图标名表 + `useClipboard` composable），由 `unplugin-vue-components` 自动注册（模板中直接使用无需 import，composable 需显式 import）。**完整组件清单与各组件 props / 状态规范见 [DESIGN.md](./DESIGN.md) §5。**

- **新工具页优先使用组件，不要在业务里重复写通用样式**；组件确不满足时写局部样式并在注释说明原因。
- `main.scss` 原 `.surface-card` / `.detail-grid` / `.detail-item` / `.kv-row` / `.form-hint` / `.chip` / `.inline-group` 已全部由本库取代并删除，不得恢复。

### 通用工具类（`main.scss`）

核心工具类：`.tool-page` / `.muted` / `.mono` / `.ctl-*` / `.btn-flush` / `.full-width`；完整清单见 [DESIGN.md](./DESIGN.md) §6。

- 弱化说明文字用 `.muted` 或 `--color-text-secondary`，统一用语义色不用 `--el-text-color-*` 做排版。
- 卡片 / 网格 / 键值 / 提示 / 行内组等通用模式一律用 UI 组件库，不得在 `main.scss` 恢复旧通用类。
- **样式反过度设计**：间距一律取 `--spacing-*` 阶梯（6→sm、10→md、14→lg、18→xl、22px 行高→`--line-height-control`、28/34/36/40/42→2xl/3xl），禁止为一点差异新增魔法数字；同构模式（卡片 / 灰底面版 / 虚线新增钮）合并为单一类 + 修饰类；宽度一律走 `.ctl-*` 阶梯或 `flex` 填充。豁免项：边框宽度、图标/svg 尺寸（12–20px）、1–2px 微内边距、999px 胶囊圆角、表格列宽 / `min-width` 等结构常数。
- **组件减法优先于样式微调**：手搓 `<table>` / 分段钮 / 侧栏菜单 / 输入框 / 下拉一律先用 Element Plus 组件（`el-table` / `el-radio-button` / `el-menu` / `el-input` / `el-dropdown`）再谈覆写。


## 常用命令

```bash
pnpm dev          # 开发模式（Electron + Vite），默认不自动打开 DevTools
EDT_DEVTOOLS=1 pnpm dev   # 同上，但启动时自动打开 DevTools（调试启动问题用）
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
| **UI 组件库（面板/分组/键值/对话框等 25 组件）** | `renderer/shared/components/ui/` |
| 应用外壳 / 标题栏（平台适配 / 页签 / 全屏） | `renderer/App.vue` |
| 首页工具网格 | `renderer/pages/HomePage.vue` |
| 工具卡片组件 | `renderer/shared/components/ToolCard.vue` |
| 工具注册 | `renderer/config/tools.ts` |
| 路由配置 | `renderer/router/routes.ts` |
| IPC 通道 | `tools/chrome-sandbox/backend/ipc/channels.ts` |
| IPC 处理 | `tools/chrome-sandbox/backend/ipc/handlers.ts` |
| 沙箱数据库 | `tools/chrome-sandbox/backend/store/database.ts` |
| 平台后端基建（logger / file-ops / 数据根目录） | `backend/utils/` |
| 应用数据根目录 / 共享数据库路径 | `backend/utils/data-root.ts` |
| **wxp-enhancer 模块记忆（目标应用逆向 / 注入脚本约束 / 验证手法）** | `docs/wxp-enhancer.md` |
