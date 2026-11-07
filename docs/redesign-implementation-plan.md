# Command Deck 实施计划

> 执行契约：视觉与交互细节以 [DESIGN.md](../DESIGN.md) 为唯一权威；本文件只把 §11 拆成可逐项验收、可被后续 agent 持续维护的任务。任何 UI 改动先读 DESIGN §3 / §4 / §5 / §6 / §7，再读本文件中对应阶段。
>
> **当前状态：Phase 1–6 已完成，最终验收通过。** Phase 0 的“改动前基线”由现有截图与最终 1280 / 1440 / 1600 三档矩阵审计替代；证据见 §8。机器可读契约见 [`.impeccable/design.json`](../.impeccable/design.json)。

## 0. 约束与完成定义

- [x] 不改 IPC 边界、数据分层与工具业务语义，只调整外壳、样式、布局和运行时挂载策略。
- [x] 不覆盖与本次改版无关的用户改动；不清理 `TODO.md`、`tweb/`。
- [x] 所有桌面尺寸按 1280 / 1440 / 1600 宽验收；本项目不新增移动端布局。
- [x] 不透明、acrylic、mica、tabbed、vibrancy、transparent-only、夜色玻璃与 reduced-transparency 都可读。
- [x] 工具仅在活动页签挂载；切走、关闭、回首页均释放组件、webview、IPC 订阅、定时器和工具级会话。
- [x] 工具页不再出现右上角“打开工具 / Ctrl K”重复入口。
- [x] 每个阶段保持可独立运行；阶段回滚以工作区分组进行，验证未通过不进入下一阶段。

## 1. Phase 0 — 基线、预览与运行时盘点

- [x] 完成现有产品特性、信息架构、工具页结构与半透明机制的审计。
- [x] 完成 Command Deck 视觉方向、令牌、组件、骨架与逐工具迁移方案，并写入 `DESIGN.md`。
- [x] 生成机器可读侧车 `.impeccable/design.json`。
- [x] 生成桌面端交互预览 `docs/redesign-preview.html`。
- [x] 移除预览与设计中的工具详情“打开工具 / Ctrl K”重复入口。
- [x] 记录现有首页、设置页和 8 个工具页在 1280 / 1440 / 1600 宽度的基线截图（最终三档审计替代，证据见 §8）。
- [x] 盘点各工具 `onMounted` / `onBeforeUnmount` / `onUnmounted`、IPC 订阅、webview 与子进程清理点。

验收：预览覆盖首页、命令面板、拦截器、表单工具、处理控制台、夜色与半透明状态；基线截图可对照。

## 2. Phase 1 — 令牌、玻璃与基础组件

### 2.1 令牌和全局样式

- [x] `renderer/shared/styles/tokens.scss`
  - 更新品牌蓝、冷雾画布、文本、边线、语义色。
  - 新增 `rail` 表面角色；保留现有表面角色与旧变量名兼容。
  - 更新圆角、阴影、动效、25px display 字号、68px rail、48px topbar 等结构常量。
- [x] `renderer/shared/styles/translucency.scss`
  - 为 rail 增加 alpha / glass 与合成变量。
  - 补齐 acrylic / mica / tabbed / vibrancy / transparent-only 的角色覆写。
  - 夜色玻璃重算全部新增表面角色。
  - reduced-transparency 将 alpha 归 1、玻璃归 none。
- [x] `renderer/shared/styles/base.scss`
  - 主题化选区、caret、滚动条与 focus-visible。
  - 保证正文、标签、占位符达到对比度下限。
  - reduced-motion 下过渡降到 0.01ms。

### 2.2 UI 基础组件

- [x] `UiButton.vue`：32px / 11px 圆角；主按钮改墨蓝实底；移除渐变、光晕和多余阴影。
- [x] `UiIconButton.vue`：hover 使用 fill，danger 只在危险操作出现；统一 focus。
- [x] `UiSearchInput.vue`：54px 搜索坞所需 API 不破坏；输入字号 14px，focus 使用 1px 边线 + 3px 12% 外环。
- [x] `UiInput.vue` / `UiSelect.vue`：32px 高、9–11px 圆角、玻璃 field 底、统一 focus / disabled / error。
- [x] `UiPanel.vue`：16px 圆角；保留给设置与辅助区，不再作为工具页主容器。
- [x] `UiTable.vue`：表头 11px、表体 12px、行高 39–44px、fill 表头、单层圆角。
- [x] `UiChip.vue` / `UiStatusTag.vue`：状态点 + 文字；最小字号 11px；全页只有一个 live 脉冲。
- [x] `UiDialog.vue`：22px 圆角、遮罩 blur(8px)、关闭即卸载。
- [x] `UiIconTile.vue`：统一工具图标底板 `sm / md / lg`，供首页工具行、命令面板与工作区 header 复用。
- [x] `utilities.scss`：收敛单行截断与两行截断工具类，业务组件不再各写一套 `-webkit-line-clamp`。

验收：组件 showcase 可运行；不透明 / acrylic / 夜色三态通过；不出现渐变主按钮、ghost card、嵌套面板。

## 3. Phase 2 — 应用外壳、命令面板与运行时

### 3.1 外壳

- [x] 新增 `renderer/shared/components/AppRail.vue`：品牌、首页、最多 4 个置顶工具、搜索、设置。
- [x] 重构 `renderer/App.vue` 为 68px rail + 48px topbar + 单一活动工作区。
- [x] 设置入口移到 rail 底部；移除标题栏设置按钮。
- [x] ~~`HeaderTabs.vue` 改为 32px 紧凑页签~~ —— 已被后续「标题栏收敛」取代：页签整体移除，工具切换改由左轨运行列表 + 标题栏上下文块承担（见 DESIGN §5.2 / §5.3）。
- [x] macOS 红绿灯与 Windows / Linux 原生窗口按钮预留不重叠 rail 和页签。

### 3.2 命令面板

- [x] 新增 `CommandPalette.vue`：宽度 `min(650px, calc(100vw - 48px))`，距顶 13vh。
- [x] 接入 `Ctrl/Cmd+K`、rail 搜索按钮和首页搜索坞。
- [x] 支持名称前缀 > 名称包含 > 关键词 > 描述的排序；最多 6 条。
- [x] `↑/↓`、`Enter`、`Esc`、遮罩关闭、焦点返回完整可用。
- [x] 工具详情不提供第二套“打开工具 / Ctrl K”入口。

### 3.3 生命周期

- [x] `App.vue` 只渲染 `activeId` 对应组件，不用跨工具 `v-show` 常驻。
- [x] 首页不挂载任何工具组件。
- [x] 切换页签卸载旧工具；关闭页签销毁 webview、IPC、定时器和工具级会话。
- [x] 保留 `runTabCloseGuard` 与“关闭运行中任务前确认”的现有能力。
- [x] 草稿与配置仍从 JSON store 恢复；重新打开时运行时从头初始化。

验收：DOM 中最多一个工具根节点；首页零工具实例；任意切换 / 关闭后无 guest、timer、listener、子进程残留。

## 4. Phase 3 — 首页 / 工具启动台

- [x] 重写 `renderer/pages/HomePage.vue`：标题 + 单句说明 + 搜索坞 + 单一 launcher 表面 + 两列工具行。
- [x] 新增 `renderer/shared/components/LauncherRow.vue`：38px 图标、名称、最多两行描述、置顶、箭头；打开与置顶使用并列的真实按钮。
- [x] 移除版本号、分类、创建时间、运行状态、`isNew` 与多层面板。
- [x] 置顶即时写入 `UiPreferences.favoriteToolIds`；LocalStorage 只做镜像。
- [x] 保留 `tool-order.ts` 拖拽排序、恢复默认排序和过滤时禁用拖拽。
- [x] 搜索直接打开命令面板，避免首页与命令面板出现两套不一致结果；默认结果覆盖全部当前工具，超出视口时在面板内滚动。
- [x] 空态、加载态、长名称、长描述和无工具状态按 DESIGN §6.5。
- [x] 引用移除后删除 `ToolCard.vue`。

验收：8 个工具在 1280×720 首屏可读；页面无运行状态与统计卡；置顶与排序跨重启一致。

## 5. Phase 4 — 工作区框架与逐工具迁移

### 5.1 公共工作区组件

- [x] 新增 `renderer/shared/components/workspace/WorkspaceHeader.vue`。
- [x] 新增 `renderer/shared/components/workspace/ToolSurface.vue`：toolbar / body / statusline 槽位。
- [x] 新增 `renderer/shared/components/workspace/ToolSideInspector.vue`：268 / 320 / 360 三档，可收起。
- [x] 组合组件只负责布局，不复制 `Ui*` 视觉内核；不嵌套 `ToolSurface`。

### 5.2 迁移顺序

- [x] 身份证号生成器：表单工作室；左 360px 参数并在参数末尾放置“生成 N 条”主按钮，右结果表按内容收缩且最高 320px；“复制全部”位于结果标题，生成后选中首行。
- [x] 拦截器：流式工作台；启动 / 停止与流量表进主表面；CA / 说明 / 诊断进 inspector。
- [x] Telegram 缓存（tweb）：webview 全幅；页面、影库、缓存操作不铺概览卡。
- [x] Treease 编辑器：全幅 webview；顶栏仅来源、状态、设置、刷新。
- [x] 离线包下载：处理控制台；左 268px inspector，历史进底部抽屉。
- [x] WXP 增强：处理控制台；启动设置进 inspector，主区放缓存 / 收藏表。
- [x] WorkBuddy2API：内嵌工作区；安装 / 运行 / 诊断进 inspector；关闭页签停止服务。

### 5.3 身份证号生成器紧凑布局回修

- [x] `WorkspaceHeader` 只保留图标、标题与用途；移除重复结果状态和 header 操作。
- [x] 参数列保持 360px，字段顺序为出生方式 → 年龄 / 日期 → 性别 → 地区 → 数量。
- [x] 年龄范围双滑块圆点与轨道垂直居中，并在轨道上方两端实时显示当前最小 / 最大年龄。
- [x] 主按钮移到参数列末尾，文案为“生成 N 条”，数量变化时实时更新；按钮距数量输入框约 25px。
- [x] “复制全部”移到结果标题，与结果数 chip 同组；空结果时 disabled。
- [x] 结果表改为 `:max-height="320"`，左右各内收 16px；单条结果约 70px，高数量时表内滚动，不再使用 `height="100%"`。
- [x] 保留生成后选中首行、行点击复制、复制全部、JSON 配置恢复与全部现有生成逻辑。
- [x] 在 1280 / 1440 / 1600 宽验证无页面级横向溢出，并检查 1 条 / 20 条两种结果密度。

每个工具都必须：

- [x] 页面只有一个主 `ToolSurface`，删除首屏 `UiPanel` 堆叠。
- [x] 页面内滚动只发生在主区域；所有 `flex:1` 子项配 `min-height:0`。
- [x] 子路由继续驱动视图状态，保留深链与前进后退。
- [x] 实际验证启动、停止、生成、下载、外部打开、关闭页签与重新打开。

## 6. Phase 5 — 设置、反馈与边界状态

- [x] 设置页改单列 760px 文档栏，顺序为数据目录 → 分层用量 → 缓存清理 → 窗口外观 → 窗口大小与位置。
- [x] 设置继续复用 `UiFormField` / `UiSwitchField` / `UiButton`，不新增配置卡语言。
- [x] toast 圆角 12px、深色玻璃、不遮 statusline。
- [x] 检查 1024px 宽、125% / 150% 缩放、页签溢出、长工具名、错误态、空态和 reduced motion。

## 7. Phase 6 — 工程与视觉验收

- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm data-layers:check`
- [x] `pnpm vite build`（最终以 `pnpm build` 覆盖 Electron + Vite）
- [x] `pnpm web`：首页、命令面板、3 类工具骨架可用。
- [x] `pnpm dev`：Electron 外壳、半透明、设置页、关闭销毁可用。
- [x] 1280 / 1440 / 1600 截图与不透明 / acrylic / mica / 夜色 / reduced-transparency 截图。
- [x] 键盘路径：Ctrl/Cmd+K、Tab、Enter、Esc、方向键。
- [x] 关闭工具后检查 DOM、webview guest、IPC 订阅、定时器、子进程与重开初始化。
- [x] 对照 `docs/redesign-preview.html` 逐屏复查，修正后再截最终图。

## 8. 验收证据（2026-11-03）

### 8.1 工程门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过（`vue-tsc` + `tsc -p tsconfig.node.json`） |
| `pnpm data-layers:check` | 通过：38 个条目 / 25 条搬迁规则 / 144 个后端文件 / 1 处显式豁免 |
| `pnpm build` | 通过：Electron 主进程 + Vite 生产构建 |

### 8.2 三档路由矩阵

在干净的 Electron + Vite 会话中，对 `/`、8 个工具页和 `/settings` 的 1280 / 1440 / 1600 三档共 30 个样本执行 DOM 审计。结果：

- 页面标题全部命中目标工具，没有残留旧路由标题。
- 每个工具页最多 1 个 `.tool-runtime`、1 个 `.tool-surface`。
- 首页 `toolRoots = 0`、`webviews = 0`。
- 所有样本无水平溢出；Surface 右边界均在视口内。
- 工具 header 动作按钮高度均为 32px；未出现“打开工具 / Ctrl K”重复入口。
- `UiSelect` 通过真实鼠标事件验证：省列表可展开，选择“安徽省”后值更新，再切回空值“随机全国”不抛异常。
- `UiSelect` 的 Reka Portal 浮层改用全局表面类后，背景、边框、16px 圆角、`--glass-pop`、320px 最大高度与 34px 选项行高均生效；选中项显示勾选，键盘焦点不再出现按钮式外环。

### 8.3 生命周期证据

| 场景 | 打开时 | 切回首页 / 关闭后 |
| --- | --- | --- |
| 拦截器 | `28818`、`59764` 监听 | 两端口关闭，`Browser bridge stopped` |
| tweb | `34200` 监听 | 端口关闭，`tweb site server stopped {"reason":"idle"}` |
| 关闭启动中的拦截器页签 | 两端口监听 | 页签移除、回到首页、`toolRoots = 0`、两端口关闭 |
| 应用退出 | — | Electron 窗口、`9222` 与全部工具端口关闭 |

### 8.4 截图索引

| 证据 | 路径 |
| --- | --- |
| 首页（Electron 最终） | `.codex/redesign-home-electron-final.png` |
| 拦截器（Electron 最终） | `.codex/redesign-interceptor-electron-final.png` |
| WorkBuddy2API | `.codex/redesign-workbuddy-electron.png` |
| 设置页 | `.codex/redesign-settings-electron.png` |
| 下拉选择器（Portal 修复后） | `.codex/select-after-2.png` |
| 真实 Night + Acrylic 原生窗口 | `.codex/redesign-night-native-window-2.png` |
| Acrylic | `.codex/redesign-acrylic-final.png` |
| Mica | `.codex/redesign-mica-final.png` |
| Tabbed | `.codex/redesign-tabbed-final.png` |
| Vibrancy | `.codex/redesign-vibrancy-final.png` |
| Transparent-only | `.codex/redesign-transparent-final.png` |
| Reduced transparency | `.codex/redesign-reduced-transparency-final.png` |
| 1280 / 1600 首页 | `.codex/redesign-home-1280.png`、`.codex/redesign-home-1600.png` |
| 身份证生成器 1280 / 1 条 | `.codex/id-card-layout-1280-1.png` |
| 身份证生成器 1280 / 20 条（表格内收后） | `.codex/id-card-layout-1280-20-inset.png` |
| 身份证生成器年龄范围（圆点居中 + 数值） | `.codex/id-card-age-range-fixed.png` |
| 身份证生成器 1600 / 20 条 | `.codex/id-card-layout-1600-20.png` |
| 身份证生成器下拉浮层 | `.codex/id-card-select-1280.png` |
| 身份证生成器 Acrylic / Night | `.codex/id-card-layout-acrylic.png`、`.codex/id-card-layout-night.png` |

> 验收环境：Windows 11、Electron 开发实例、`E:\everydaytool\data`；透明截图使用实际窗口截取，其余主题截图用于核对 CSS 令牌与可读性。夜色截图中的透明画布会暴露桌面壁纸，这是半透明设计的预期行为，不是画布漏色。

## 9. Agent 维护协议

- [x] 新 UI 工作开始前：读 `DESIGN.md` §3 令牌、§4 组件、§5 工具类、§7 布局与本章对应阶段。
- [x] 修改令牌：同步更新 `tokens.scss`、`translucency.scss`、`.impeccable/design.json` 与 DESIGN 的令牌表。
- [x] 新增组件：先判定能否复用 `Ui*`；组合组件只放布局 / 交互编排，不复制视觉内核。
- [x] 新增工具页：先选 §8.1 的四种骨架之一，再复用 `WorkspaceHeader` / `ToolSurface` / `ToolSideInspector`。
- [x] 修改运行时：必须验证切走、关闭、回首页三条销毁路径，并在本文件勾选对应验收项。
- [x] 完成一个阶段：更新本文件复选框与验收证据路径；不要只改代码不改契约。
- [x] 设计冲突：先停在冲突点核对 DESIGN 与现有产品事实；不得为了局部视觉破坏 IPC、数据分层或关闭销毁。
