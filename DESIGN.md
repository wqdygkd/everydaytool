# everydaytool UI 设计文档

> 本文档描述 everydaytool（edt）的视觉语言、设计令牌与 UI 组件规范，是界面开发与评审的单一权威参考。实现细节（令牌定义、全局样式）位于 [`renderer/shared/styles/main.scss`](renderer/shared/styles/main.scss)，组件源码位于 [`renderer/shared/components/ui/`](renderer/shared/components/ui/)。

## 1. 设计原则与视觉语言

- **冷灰底 + 品牌蓝强调**：冷灰画布、玻璃卡片、圆角友好，以品牌蓝作为唯一强调色。
- **固定浅色**：无主题切换，颜色一律走语义令牌，禁止硬编码。
- **令牌优先**：所有组件通过 `var(--token)` 引用设计令牌，禁止硬编码颜色 / 圆角 / 阴影。
- **圆角与浮岛**：按钮、页签为圆角矩形；头像、FAB、徽章保持圆形/胶囊；卡片与面板为浮岛，靠细边框与轻阴影分层。
- **组件减法**：能用 Element Plus（`el-*`）组件的不自造，覆写只写几何差异，颜色与状态交给全局令牌绑定。
- **反过度设计**：间距、宽度、圆角严格取令牌阶梯，不为一两像素差异新增魔法数字。

## 2. 主题

固定浅色主题，核心色板如下：

| 角色 | 值 | 用途 |
|------|-----|------|
| 品牌蓝（Primary） | `#3390ec` | 主按钮、链接、选中态、焦点环 |
| 画布（App BG） | `#f4f4f5` | 应用背景、工具页底色 |
| 表面（Surface） | `#ffffff` | 卡片、面板、输入框、表格 |
| 主文本 | `#000000` | 正文 |
| 次级文本 | `#707579` | 说明文字、弱化内容 |
| 边框 | `#dadce0` | 输入边框、分隔线 |
| 成功绿 | `#10b981` | 运行中、已启用、未读徽章 |

## 3. 设计令牌

令牌统一定义在 `main.scss` 的 `:root`。令牌是「语义基线」：未引用令牌应删除、纯别名令牌应合并、重命名需同步全部引用。

### 3.1 颜色

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--color-primary` | `#3390ec` | 品牌蓝（唯一强调色） |
| `--color-primary-hover` | `#4a95d6` | 主按钮 hover |
| `--color-primary-soft` | `rgba(51,144,236,.1)` | 选中行 / 选中项浅底 |
| `--color-primary-light` | `rgba(51,144,236,.2)` | 品牌标 / 页签选中浅底 |
| `--color-success` | `#10b981` | 成功 / 运行态 |
| `--color-warning` | `#f59e0b` | 警告 / 固定标记 |
| `--color-error` | `#ef4343` | 错误 / 危险操作 |
| `--color-app-bg` | `#f4f4f5` | 画布 / 工具页底 |
| `--color-surface` | `#ffffff` | 基础表面（表格行、编辑器卡片） |
| `--color-surface-raised` | `#ffffff` | 浮岛表面（卡片/面板，与 surface 成语义对） |
| `--color-muted` | `#f4f4f5` | hover 填充、灰底面版、表头 |
| `--color-border-light` | `#e4e4e5` | 细分隔线、卡片描边 |
| `--color-border` | `#dadce0` | 输入边框 |
| `--color-text-primary` | `#000000` | 主文本 |
| `--color-text-secondary` | `#707579` | 次级文本 / 弱化 |
| `--color-text-tertiary` | `#686c72` | 元信息 / 时间戳 |

### 3.2 字阶与字体

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--font-size-xs` | `11px` | 徽章、表格辅助、代码 |
| `--font-size-sm` | `12px` | 说明、键值、表格正文 |
| `--font-size-base` | `14px` | 正文、面板标题 |
| `--font-size-lg` | `16px` | 区块标题、状态名 |
| `--font-size-xl` | `18px` | 大标题（规则编辑器标题） |
| `--font-weight-regular` | `400` | 正文 |
| `--font-weight-medium` | `500` | 按钮、页签、标签 |
| `--font-weight-semibold` | `600` | 卡片名、面板标题、区块标题 |
| `--font-weight-bold` | `700` | — |

**字体栈**

| 用途 | 字体 |
|------|------|
| 正文 UI | `Roboto`(400/500，自托管) + 系统中文字体（PingFang SC / Microsoft YaHei 等） |
| 等宽 / 数字 | `--font-mono`：Cascadia Mono / Roboto Mono / SF Mono / Menlo / Consolas |
| 字母头像 / 品牌标 | `Nunito` ExtraBold 800 |

> 数字看板与计数统一用 `--font-mono` + `font-variant-numeric: tabular-nums` 对齐。

### 3.3 间距

`--spacing-*` 阶梯（唯一间距来源，禁止魔法数字）：

| 令牌 | 值 | 令牌 | 值 |
|------|-----|------|-----|
| `--spacing-xs` | `4px` | `--spacing-xl` | `20px` |
| `--spacing-sm` | `8px` | `--spacing-2xl` | `24px` |
| `--spacing-md` | `12px` | `--spacing-3xl` | `32px` |
| `--spacing-lg` | `16px` | | |

> 取值规则：魔法数字就近向上取整到最近阶梯（6→sm、10→md、14→lg、18→xl、22px 行高→`--line-height-control`、28~42→2xl/3xl）。

### 3.4 几何外壳

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--control-height` | `32px` | 表单控件 / 图标按钮统一高度 |
| `--line-height-control` | `20px` | 控件 / 表格 / 徽标统一行高 |
| `--content-max-width` | `1360px` | 首页内容最大宽 |
| `--titlebar-height` | `44px` | 自定义标题栏行高 |

### 3.5 圆角

圆角阶梯：

| 令牌 | 值 | 对应 |
|------|-----|------|
| `--radius-xs` | `8px` | 小件（图标钮 hover 底、代码块） |
| `--radius-sm` | `12px` | 控件（输入框、编辑器卡片、弹层菜单） |
| `--radius-md` | `16px` | 行 / 菜单（弹层、消息） |
| `--radius-lg` | `20px` | 浮岛（卡片、面板、表格容器） |
| `--radius-xl` | `28px` | 模态（对话框） |

> 按钮、页签为**圆角矩形**（14px / 12px）；头像、FAB、徽章保持圆形 / 胶囊（`999px`）。

### 3.6 阴影

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.05)` | 浮岛卡片 / 面板 |
| `--shadow-md` | `0 8px 22px rgba(0,0,0,.08)` | 菜单、FAB、消息 |
| `--shadow-lg` | `0 16px 32px rgba(0,0,0,.12)` | 对话框、批量操作栏 |
| `--shadow-focus` | `0 0 0 3px rgba(255,109,56,.2)` | 键盘焦点环 |

### 3.7 过渡

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--transition-fast` | `0.15s cubic-bezier(.25,1,.5,1)` | 微交互（图标钮、页签、chip） |
| `--transition-base` | `0.25s cubic-bezier(.33,1,.68,1)` | 卡片 hover、边框过渡 |

## 4. Element Plus 绑定

`--el-*` 变量在 `main.scss` 的 `:root` 中绑定到设计令牌，使 Element Plus 组件（按钮、输入框、表格、弹层、消息等）自动继承主题：

- `--el-color-primary` → `--color-primary`，及其 light/dark 阶梯派生色。
- `--el-border-color` / `-light` / `-lighter` → 边框令牌。
- `--el-bg-color` / `-overlay` / `--el-fill-color-blank` → `--color-surface-raised`；`--el-fill-color-light` → `--color-muted`。
- `--el-text-color-primary/regular/secondary` → 文本令牌。
- `--el-box-shadow` / `-light` → 阴影令牌。
- `--el-mask-color` → `rgba(0,0,0,.25)`（弹层遮罩）。

**覆写原则**：只在局部覆写几何差异（高度 / 圆角 / 边框宽度），颜色与状态一律交全局绑定；视觉不一致时优先改全局绑定，不要单点堆 `:deep`。

## 5. UI 组件库

平台级组件库（25 个组件 + `icons.ts` 图标名表），由 `unplugin-vue-components` 自动注册（模板内直接用，无需 import）。以下是完整规范。

### 5.1 布局

| 组件 | Props / 变体 | 说明 |
|------|-------------|------|
| `UiPanel` | `title`、`variant`（`raised` 浮岛 / `outlined` 描边）、`padding`、`titleSize`（`sm`/`lg`）、`shadow`（`sm`/`md`）、`#title` / `#actions` 插槽 | 基础卡片 / 面板。`raised` = surface-raised + radius-lg + shadow；`outlined` = surface-raised + border-light + radius-lg |
| `UiGroup` | `gap`（xs/sm/md/lg）、`align`、`justify`、`block`、`direction`（row/column）、`wrap` | 行内 / 纵向控件组，替代裸 `display:flex` 布局 |
| `UiToolbar` | `bordered`、`surface`、`wrap`、`gap`、`padding`、`flush`、`#end` 插槽 | 工具条：默认插槽放左，`#end` 放右；`flush` 去除 EP 按钮原生左边距 |
| `UiSidebar` | `title`、`titleTone`（subdued/emphasis）、`width`（252px）、`padding`、`#title`/`#actions`/`#footer` 插槽 | 侧栏容器（border-right + surface-raised） |
| `UiDetailGrid` | `columns`（2） | 详情卡片网格，≤760px 折为单列 |
| `UiSectionHeader` | `title`、`count`、`#actions` 插槽 | 区块标题（带下分隔线 + 计数） |

### 5.2 数据展示

| 组件 | Props / 变体 | 说明 |
|------|-------------|------|
| `UiKeyValue` | `label`、`labelWidth`（64px）、`mono`、`wrap`、`muted`、`#actions` 插槽 | 键值行（顶部分隔线式，label 左 / value 右） |
| `UiDetailItem` | `label`、`mono`、`wrap`、`size`（sm/xs） | 详情卡片单项（label 上 / value 下，描边卡片） |
| `UiCodeBlock` | `maxHeight`（200px）、`wrap` | 等宽代码块（app-bg 底 + radius-sm + 滚动） |
| `UiEmpty` | `text`、`variant`（plain/bordered）、`center`、`icon`、`padding` | 空状态（纯文本 / 虚线框） |
| `UiBreadcrumb` | `items`、`navigate` 事件 | 面包屑导航 |

### 5.3 徽章 / 状态

| 组件 | Props / 变体 | 说明 |
|------|-------------|------|
| `UiChip` | `tone`（neutral/primary/success/warning/danger/info）、`mono` | 小胶囊徽章；`success` 为实底绿白字（未读徽章式） |
| `UiStatusTag` | `tone`（neutral/success/warning/danger）、`pulsing` | 状态点（10px 圆点）；`pulsing` 呼吸光环 |

### 5.4 表单与输入

| 组件 | Props / 变体 | 说明 |
|------|-------------|------|
| `UiPathField` | `modelValue`、`placeholder`、`disabled`、`mono`、`#actions` 插槽 | 路径输入（等宽 + 右侧动作） |
| `UiSwitchField` | `modelValue`、`disabled`、`align` | 开关 + 说明文字的组合 |
| `UiSearchInput` | `modelValue`、`placeholder`、`variant`（pill/box）、`width`、`clearable`、`trim` | 搜索框：`pill` 圆角（42px 大搜索），`box` 方形（32px 面板内搜索） |
| `UiCodeArea` | `modelValue`、`rows`（8）、`placeholder`、`disabled`、`meta` | 等宽多行输入 + 右下角元信息 |

### 5.5 图标 / 按钮 / 头像

| 组件 | Props / 变体 | 说明 |
|------|-------------|------|
| `UiIcon` | `name`、`size`（16）、`strokeWidth` | 线性 stroke 图标（`icons.ts` 统一名表） |
| `UiIconButton` | `icon`、`size`（32）、`active`、`label` | 定宽方形图标按钮；hover 抬深 + 浅底，`active` 警示高亮 |
| `UiCopyButton` | `text`、`label`、`size`、`type`、`textButton` | 剪贴板复制（空值警告 / 成功 / 失败统一提示） |
| `UiAvatar` | `text`、`color`、`size`（42） | 字母头像（首字符 + 纵向渐变底） |
| `UiFab` | `icon`、`label`、`size`（48） | 右下角悬浮按钮（fixed） |

### 5.6 反馈

| 组件 | Props / 变体 | 说明 |
|------|-------------|------|
| `UiDialog` | `modelValue`、`title`、`width`（560px）、`destroyOnClose`、`closeOnClickModal`、`#footer` 插槽 | 模态框（radius-xl + shadow-lg）；footer 保留 EP 原生按钮间距 |
| `UiListCard` | `active` | 可点列表卡片（hover / 选中 = 品牌浅底 + 品牌描边） |

### 5.7 通用状态约定

| 状态 | 表现 |
|------|------|
| hover | 卡片浮岛 hover 变浅底或抬描边；按钮 hover 变浅（主按钮）/ 浅底（次按钮）；图标钮 hover 抬深 + 浅底 |
| active / 选中 | 品牌橙描边 + `--color-primary-soft` 浅底（列表卡、行、分段钮）；固定/警示用 warning |
| focus | `--shadow-focus` 橙色内环（输入框为橙边框 + 无外发光） |
| disabled | EP 默认禁用灰（走全局绑定），图标/文字按钮降低透明度 |

## 6. 通用工具类

| 类 | 用途 |
|----|------|
| `.tool-page` | 工具页容器：填充主区域并在内部滚动 |
| `.muted` | 弱化文本（`--color-text-secondary`） |
| `.mono` | 等宽数字字体（`--font-mono` + tabular-nums） |
| `.ctl-xs/sm/md/lg` | 表单控件定宽阶梯（90/140/200/280px） |
| `.ctl-fill` | 弹性填充剩余宽度 |
| `.btn-flush` | 消除 EP 按钮间原生 12px 左边距 |
| `.full-width` | 占满容器宽度 |

## 7. 布局模式

### 7.1 应用外壳

- 自定义标题栏（`titleBarStyle: hidden` + `titleBarOverlay`）：左侧品牌标 `edt`（Nunito 圆角，primary-light 底 + primary 字）+ 工具页签（圆角高亮，primary-light 底 + primary 字）；无打开页签时仅显示品牌标。
- 标题栏整行 `-webkit-app-region: drag`，页签区 no-drag。
- 平台适配：mac 红绿灯左预留 88px，win/linux 右预留 148px（窗口按钮）。
- 页内菜单已移除，菜单动作由主进程系统菜单提供；底部状态栏已删除，主区直抵窗口底缘。
- 主区 `flex:1; min-height:0`，滚动只发生在内容区。

### 7.2 首页工具网格

- 内容最大宽 `--content-max-width`，居中。
- 工具卡片：白底浮岛 + 字母头像行，hover 浅底提示；收藏星标为绝对定位浮层。
- 搜索 / 收藏重排用 `TransitionGroup` 平滑过渡。

### 7.3 工具页

- **侧栏 + 主区**（chrome-sandbox / env-browser）：`grid-template-columns: <sidebar> 1fr`，窄屏（≤760px）折为上下堆叠。
- **页签 + 面板**（interceptor）：`tool-page` 容器 + `el-tabs`，子视图由路由驱动。
- **顶栏 + 内容**（treease / wxp）：`UiToolbar` 顶栏 + 下方滚动内容。
- **居中表单**（id-card-generator）：`tool-page` 内居中卡片。

### 7.4 面板与详情

- 详情用 `UiDetailGrid` + `UiDetailItem`（label + value 卡片，≤760px 单列）。
- 键值清单用 `UiKeyValue`（顶部分隔线式）。
- 分区用 `UiPanel variant="outlined"`（描边分区块）。

### 7.5 表格

- 统一用 `el-table`（`size="small"`），表头 `--color-muted`、行 hover `--color-muted`、容器 `radius-lg` 由全局绑定。
- 数字列用 `.mono`，时间列用 `.muted`，状态列用 `el-tag` 或 `UiChip`。

## 8. 交互与动效

- **入场动画**：应用外壳顶栏下滑淡入；工具页侧栏左滑、状态面板右淡入（gsap）。
- **路由过渡**：`.page-*` 类实现淡入淡出 + 轻微位移。
- **卡片 hover 抬高**：列表卡 / 工具卡 hover 抬描边或浅底，FAB hover 上浮。
- **prefers-reduced-motion**：全局降级（动画时长压缩到 0.01ms），已在 `main.scss` 处理。

## 9. 无障碍

- 图标按钮提供 `aria-label` / `title`。
- 键盘焦点统一 `--shadow-focus` 焦点环。
- 交互元素可键盘触发（列表卡支持 Enter / Space）。
- 文本对比遵循主/次级/三级分层。

---

*本文档随 UI 演进维护；令牌与组件变更需同步本文件与 [AGENTS.md](./AGENTS.md)。*
