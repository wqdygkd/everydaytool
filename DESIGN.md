# everydaytool UI 设计文档

> 本文档描述 everydaytool（edt）的视觉语言、设计令牌与 UI 组件规范，是界面开发与评审的单一权威参考。实现细节（令牌定义、全局样式）位于 [`renderer/shared/styles/`](renderer/shared/styles/)（入口 `main.scss`，令牌 `tokens.scss`，半透明层 `translucency.scss`），组件源码位于 [`renderer/shared/components/ui/`](renderer/shared/components/ui/)。

## 1. 设计原则与视觉语言

- **冷灰底 + 品牌蓝强调**：冷灰画布、玻璃卡片、圆角友好，以品牌蓝作为唯一强调色。
- **固定浅色**：无主题切换，颜色一律走语义令牌，禁止硬编码。
- **令牌优先**：所有组件通过 `var(--token)` 引用设计令牌，禁止硬编码颜色 / 圆角 / 阴影。
- **圆角与浮岛**：按钮、页签为圆角矩形；头像、徽章保持圆形/胶囊；卡片与面板为浮岛，靠细边框与轻阴影分层。
- **组件减法**：能用 Element Plus（`el-*`）组件的不自造，覆写只写几何差异，颜色与状态交给全局令牌绑定。
- **反过度设计**：间距、宽度、圆角严格取令牌阶梯，不为一两像素差异新增魔法数字。

## 2. 主题

固定浅色主题，核心色板如下：

| 角色 | 值 | 用途 |
| ------ | ----- | ------ |
| 品牌蓝（Primary） | `#3390ec` | 主按钮、链接、选中态、焦点环 |
| 画布（App BG） | `#f4f4f5` | 应用背景、工具页底色 |
| 表面（Surface） | `#ffffff` | 卡片、面板、输入框、表格 |
| 主文本 | `#000000` | 正文 |
| 次级文本 | `#707579` | 说明文字、弱化内容 |
| 边框 | `#dadce0` | 输入边框、分隔线 |
| 成功绿 | `#10b981` | 运行中、已启用、未读徽章 |

## 3. 设计令牌

令牌定义在 `renderer/shared/styles/tokens.scss`（基础令牌）与 `translucency.scss`（半透明 alpha 层），由 `main.scss` 按 tokens → base → element-plus → utilities → translucency 的顺序引入。令牌是「语义基线」：未引用令牌应删除、纯别名令牌应合并、重命名需同步全部引用。

### 3.1 颜色

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
| `--color-primary` | `#3390ec` | 品牌蓝（唯一强调色） |
| `--color-primary-hover` | `#4a95d6` | 主按钮 hover |
| `--color-primary-soft` | `rgba(51,144,236,.1)` | 选中行 / 选中项浅底 |
| `--color-primary-light` | `rgba(51,144,236,.2)` | 品牌标 / 页签选中浅底 |
| `--color-success` | `#10b981` | 成功 / 运行态 |
| `--color-warning` | `#f59e0b` | 警告 / 固定标记 |
| `--color-error` | `#ef4343` | 错误 / 危险操作 |
| `--color-app-bg` | `#f4f4f5` | 画布兜底色（实际画布为透明，见 7.1.1） |
| `--color-on-solid` | `#ffffff` | 实底上的前景白（绿底徽章白字 / 头像字母 / 白分隔线），不随透明度变 |
| `--color-border-light` | `#e4e4e5` | 细分隔线、卡片描边 |
| `--color-border` | `#dadce0` | 输入边框 |
| `--color-text-primary` | `#000000` | 主文本 |
| `--color-text-secondary` | `#707579` | 次级文本 / 弱化 |
| `--color-text-tertiary` | `#686c72` | 元信息 / 时间戳 |

### 3.1.1 半透明表面角色（颜色 × alpha 两层）

每个表面角色拆成「基准色（`--color-<role>-base`）× 透明度（`--alpha-<role>`）」，
两者在 `translucency.scss` 里用 `color-mix` 合成出 `--color-<role>` 供组件引用。
**新增角色需同时改三处**：tokens.scss 的 base + alpha，translucency.scss 的合成与各模式取值。

| 角色 | 用途 | 独立调节入口 |
| ------ | ------ | ------------- |
| `raised` | 卡片 / 面板 / 浮岛 | `--alpha-raised` · `--glass-raised` |
| `input` | 其余非弹出层 el 控件（树 / 上传 / 日历 / 搜索框 UiSearchInput） | `--alpha-input` · `--glass-input` |
| `field` | 通用表单输入框（el-input / textarea / select） | `--alpha-field` |
| `table` | 表格行（el-table 的 tr） | `--alpha-table` |
| `button` | 普通按钮（玻璃钮；primary/danger 实心钮不走此角色） | `--alpha-button` |
| `fill` | 灰调填充（表头 / 行 hover / 灰底面版） | `--alpha-fill` |
| `header` | 标题栏 | `--alpha-header` · `--glass-header` |
| `pop` | 下拉类浮层（select / cascader / dropdown / date-picker / autocomplete） | `--alpha-pop` · `--glass-pop` |
| `overlay` | 其它弹层（dialog / message / notification / message-box 确认框） | `--alpha-overlay` · `--glass-overlay` |
| `canvas` | 画布 | 不参与 alpha，恒为 `transparent` |

> 所有基准色除 `fill` 为 `#f4f4f5` 外均为 `#ffffff`；默认（不透明）模式下 alpha 全为 `1`、玻璃全为 `none`。
> 各模式的 alpha / 玻璃取值见 §7.1.1。

### 3.1.2 玻璃（backdrop-filter）体系

**透明度与模糊是两件事**：alpha 决定「能看见多少背后内容」，`--glass-*` 决定「背后被磨平多少」。
只调 alpha 会得到一块半透明塑料（文字与背后的表格线互相打架），只加模糊则变成不透明毛玻璃。
两者按同一套表面角色分档，因此每种窗口模式、每类控件都能独立调，互不牵连。

| 令牌 | 默认值 | 用途 |
| ------ | -------- | ------ |
| `--glass-saturate` | `100%` | 玻璃饱和度增益（模式级旋钮，被各角色 `saturate()` 共享） |
| `--glass-raised` | `none` | 卡片 / 面板 / 浮岛 |
| `--glass-input` | `none` | 浮在画布上的非弹出层控件（搜索框等） |
| `--glass-header` | `none` | 标题栏 |
| `--glass-pop` | `none` | 下拉类浮层 |
| `--glass-overlay` | `none` | dialog / message / notification / message-box |
| `--glass-veil` | `blur(2px)` | 遮罩 / 骨架屏：恒有轻微磨砂，与窗口模式无关 |

**只给「表面层」玻璃，不给嵌套控件**：卡片、浮层、标题栏的背后是别的内容或画布，需要磨平；
`field` / `table` / `button` / `fill` 始终嵌在卡片内部，背后就是卡片表面本身，
再糊一层既看不出效果、又为每个元素创建 backdrop root（合成开销）。它们的差异化仍然靠 alpha。

> 组件一律写 `backdrop-filter: var(--glass-<role>)`，**禁止写死 `blur(Npx)`**；
> 默认模式下玻璃为 `none`，即不透明窗口零额外开销（不加 backdrop root）。

### 3.1.3 玻璃细节旋钮（高光 / 开关轨道 / 滑块）

这三档不是「表面角色」——它们不新增基准色，而是在现有基准色上做着色与高光，
但同样按窗口模式独立覆写，保证每类玻璃元素都能单独调：

| 令牌 | 默认值 | 取色基准 | 用途 |
| ------ | -------- | -------- | ------ |
| `--alpha-highlight` → `--color-highlight` | `0` | `--color-on-solid` | 卡片 / 开关的 1px 内高光（镜面边）。0 = 不出现，不透明模式下视觉与旧版一致 |
| `--alpha-switch-track` → `--color-switch-track` / `--color-switch-track-off` | `1` | `--color-primary` / `--color-border` | 开关轨道着色（开 / 关），轨道本身可半透明 |
| `--alpha-switch-knob` → `--color-switch-knob` | `1` | `--color-on-solid` | 开关滑块（小体积「透镜」） |

- **高光是低 alpha 元件的「形状保险」**：填充越透，越要靠 1px 内描边读出边界；
  它同时用在开关轨道（顶部）、滑块（整圈）与卡片顶边（`UiPanel` / `ToolCard` / `UiListCard` 的 box-shadow 第一段）。
- **开关不借用 `input` / `field`**：轨道是品牌色表面、滑块是前景件，两者对透明的容忍度完全不同——
  **轨道可以透（.82~.98），滑块必须近实（≥ .9）**。滑块调到 .3 时，关态会和浅灰轨道糊在一起、
  开态只剩一块被轨道染色的圆点；各模式取值见 §7.1.1。
- 高光与轨道都**不加 `backdrop-filter`**：滑块背后是轨道、轨道背后是卡片，没有「背后的内容」可磨。

### 3.2 字阶与字体

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
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
| ------ | ------ |
| 正文 UI | `Roboto`(400/500，自托管) + 系统中文字体（PingFang SC / Microsoft YaHei 等） |
| 等宽 / 数字 | `--font-mono`：Cascadia Mono / Roboto Mono / SF Mono / Menlo / Consolas |
| 字母头像 / 品牌标 | `--font-brand`：`Nunito` ExtraBold 800（Roboto / sans-serif 兜底） |

> 数字看板与计数统一用 `--font-mono` + `font-variant-numeric: tabular-nums` 对齐。

### 3.3 间距

`--spacing-*` 阶梯（唯一间距来源，禁止魔法数字）：

| 令牌 | 值 | 令牌 | 值 |
| ------ | ----- | ------ | ----- |
| `--spacing-xs` | `4px` | `--spacing-xl` | `20px` |
| `--spacing-sm` | `8px` | `--spacing-2xl` | `24px` |
| `--spacing-md` | `12px` | `--spacing-3xl` | `32px` |
| `--spacing-lg` | `16px` | | |

> 取值规则：魔法数字就近向上取整到最近阶梯（6→sm、10→md、14→lg、18→xl、22px 行高→`--line-height-control`、28~42→2xl/3xl）。

### 3.4 几何外壳

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
| `--control-height` | `32px` | 表单控件 / 图标按钮统一高度 |
| `--line-height-control` | `20px` | 控件 / 表格 / 徽标统一行高 |
| `--content-max-width` | `1360px` | 首页内容最大宽 |
| `--titlebar-height` | `44px` | 自定义标题栏行高 |

### 3.5 圆角

圆角阶梯：

| 令牌 | 值 | 对应 |
| ------ | ----- | ------ |
| `--radius-xs` | `8px` | 小件（图标钮 hover 底、代码块） |
| `--radius-sm` | `12px` | 控件（输入框、编辑器卡片、弹层菜单） |
| `--radius-control` | `14px` | 圆角矩形控件（按钮、页签、搜索框） |
| `--radius-md` | `16px` | 行 / 菜单（弹层、消息） |
| `--radius-lg` | `20px` | 浮岛（卡片、面板、表格容器） |
| `--radius-xl` | `28px` | 模态（对话框） |

> 按钮、页签为**圆角矩形**（`--radius-control` 14px / `--radius-sm` 12px）；头像、徽章保持圆形 / 胶囊（`999px`）。

### 3.6 阴影

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.05)` | 浮岛卡片 / 面板 |
| `--shadow-md` | `0 8px 22px rgba(0,0,0,.08)` | 菜单、消息 |
| `--shadow-lg` | `0 16px 32px rgba(0,0,0,.12)` | 对话框、批量操作栏 |
| `--shadow-focus` | `0 0 0 3px rgba(255,109,56,.2)` | 键盘焦点环 |
| `--shadow-window-frame` | `0 12px 48px rgba(0,0,0,.28)` | 半透明窗口的外阴影（补偿丢失的系统投影） |

### 3.7 过渡

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
| `--transition-fast` | `0.15s cubic-bezier(.25,1,.5,1)` | 微交互（图标钮、页签、chip） |
| `--transition-base` | `0.25s cubic-bezier(.33,1,.68,1)` | 卡片 hover、边框过渡 |

## 4. Element Plus 绑定

`--el-*` 变量在 `element-plus.scss` 的 `:root` 中绑定到设计令牌，使 Element Plus 组件（按钮、输入框、表格、弹层、消息等）自动继承主题：

- `--el-color-primary` → `--color-primary`，及其 light/dark 阶梯派生色。
- `--el-border-color` / `-light` / `-lighter` → 边框令牌。
- `--el-bg-color` / `--el-fill-color-blank` → `--color-input`（EP 内部 tree / upload / calendar 等共用此入口）。
- `--el-fill-color-light` / `-lighter` → `--color-fill`（灰调填充）。
- `--el-bg-color-overlay` → `--color-overlay`（弹层）；下拉类浮层另行覆盖为 `--color-pop`。
- 表格：`--el-table-tr-bg-color` → `--color-table`，表头 / 行 hover → `--color-fill`。
- 输入框：`.el-input__wrapper` / `.el-textarea__inner` / `.el-select__wrapper` 的 `background` → `--color-field`
  （`.el-input__inner` 本身是 `background: none`，底色只由 wrapper 提供）。
- 按钮：`--el-button-bg-color` / `-hover-bg-color` → `--color-button`（primary/danger 实心钮单独覆盖为品牌色）。
- `--el-text-color-primary/regular/secondary` → 文本令牌。
- `--el-box-shadow` / `-light` → 阴影令牌。
- `--el-mask-color` → `rgba(0,0,0,.25)`（弹层遮罩）。

> **不要写死静态色**：`--color-*` 合成变量之外的实色（如 `#fff`）会在半透明窗口下变成「死白」，
> 与周围半透明表面脱节。新增 EP 覆写时务必接到对应角色上。

**覆写原则**：只在局部覆写几何差异（高度 / 圆角 / 边框宽度），颜色与状态一律交全局绑定；视觉不一致时优先改全局绑定，不要单点堆 `:deep`。

## 5. UI 组件库

平台级组件库（25 个组件 + `icons.ts` 图标名表），由 `unplugin-vue-components` 自动注册（模板内直接用，无需 import）。以下是完整规范。

### 5.1 布局

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiPanel` | `title`、`variant`（`raised` 浮岛 / `outlined` 描边）、`padding`、`titleSize`（`sm`/`lg`）、`shadow`（`sm`/`md`）、`#title` / `#actions` 插槽 | 基础卡片 / 面板。`raised` = surface-raised + radius-lg + shadow；`outlined` = surface-raised + border-light + radius-lg |
| `UiGroup` | `gap`（xs/sm/md/lg）、`align`、`justify`、`block`、`direction`（row/column）、`wrap` | 行内 / 纵向控件组，替代裸 `display:flex` 布局 |
| `UiToolbar` | `bordered`、`surface`、`wrap`、`gap`、`padding`、`flush`、`#end` 插槽 | 工具条：默认插槽放左，`#end` 放右；`flush` 去除 EP 按钮原生左边距 |
| `UiSidebar` | `title`、`titleTone`（subdued/emphasis）、`width`（252px）、`padding`、`#title`/`#actions`/`#footer` 插槽 | 侧栏容器（border-right + surface-raised） |
| `UiDetailGrid` | `columns`（2） | 详情卡片网格，≤760px 折为单列 |
| `UiSectionHeader` | `title`、`count`、`#actions` 插槽 | 区块标题（无分隔线，仅计数） |
| `UiMenuHorizontal` | `modelValue`、`items`（`{ value, label, badge?, icon? }[]`）、`update:modelValue` | 横向分段菜单：药丸选中态 + 滑动指示条（`transform`/`width` 过渡）+ 横向滚动（滚动条隐藏）+ 选中项自动滚入视野。复刻 Telegram Web K 的 `.menu-horizontal-div`；条高 48、项高 40、字号取平台 14px；条容器走 `--radius-lg`，与卡片 / 面板圆角一致；`icon` 传 SVG 资源 URL（16px，与 label 间距 `--spacing-xs`，如离线包下载的品牌 logo） |

### 5.2 数据展示

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiKeyValue` | `label`、`labelWidth`（64px）、`mono`、`wrap`、`muted`、`#actions` 插槽 | 键值行（顶部分隔线式，label 左 / value 右） |
| `UiDetailItem` | `label`、`mono`、`wrap`、`size`（sm/xs） | 详情卡片单项（label 上 / value 下，描边卡片） |
| `UiCodeBlock` | `maxHeight`（200px）、`wrap` | 等宽代码块（app-bg 底 + radius-sm + 滚动） |
| `UiEmpty` | `text`、`variant`（plain/bordered）、`center`、`icon`、`padding` | 空状态（纯文本 / 虚线框） |
| `UiBreadcrumb` | `items`、`navigate` 事件 | 面包屑导航 |

### 5.3 徽章 / 状态

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiChip` | `tone`（neutral/primary/success/warning/danger/info）、`mono` | 小胶囊徽章；`success` 为实底绿白字（未读徽章式） |
| `UiStatusTag` | `tone`（neutral/success/warning/danger）、`pulsing` | 状态点（10px 圆点）；`pulsing` 呼吸光环 |

### 5.4 表单与输入

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiPathField` | `modelValue`、`placeholder`、`disabled`、`mono`、`#actions` 插槽 | 路径输入（等宽 + 右侧动作） |
| `UiSwitchField` | `modelValue`、`disabled`、`align` | 开关 + 说明文字的组合 |
| `UiSearchInput` | `modelValue`、`placeholder`、`variant`（pill/box）、`width`、`clearable`、`trim` | 搜索框：`pill` 圆角（42px 大搜索），`box` 方形（32px 面板内搜索） |
| `UiCodeArea` | `modelValue`、`rows`（8）、`placeholder`、`disabled`、`meta` | 等宽多行输入 + 右下角元信息 |

### 5.5 图标 / 按钮 / 头像

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiIcon` | `name`、`size`（16）、`strokeWidth` | 线性 stroke 图标（`icons.ts` 统一名表） |
| `UiIconButton` | `icon`、`size`（32）、`active`、`disabled`、`label` | 定宽方形图标按钮；hover 抬深 + 浅底，`active` 警示高亮，`disabled` 走 EP 原生禁用色 |
| `UiCopyButton` | `text`、`label`、`size`、`type`、`textButton` | 剪贴板复制（空值警告 / 成功 / 失败统一提示） |
| `UiAvatar` | `text`、`color`、`size`（42） | 字母头像（首字符 + 纵向渐变底） |

### 5.6 反馈

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiDialog` | `modelValue`、`title`、`width`（560px）、`destroyOnClose`、`closeOnClickModal`、`#footer` 插槽 | 模态框（radius-xl + shadow-lg）；footer 保留 EP 原生按钮间距 |
| `UiListCard` | `active` | 可点列表卡片（hover / 选中 = 品牌浅底 + 品牌描边） |

### 5.7 通用状态约定

| 状态 | 表现 |
| ------ | ------ |
| hover | 卡片浮岛 hover 变浅底或抬描边；按钮 hover 变浅（主按钮）/ 浅底（次按钮）；图标钮 hover 抬深 + 浅底 |
| active / 选中 | 品牌橙描边 + `--color-primary-soft` 浅底（列表卡、行、分段钮）；固定/警示用 warning |
| focus | `--shadow-focus` 橙色内环（输入框为橙边框 + 无外发光） |
| disabled | EP 默认禁用灰（走全局绑定），图标/文字按钮降低透明度 |

## 6. 通用工具类

| 类 | 用途 |
| ---- | ------ |
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
- **设置入口固定在标题栏右端**（`.header-settings`，34px 方形图标钮，齿轮图标）：Windows / Linux 上正好落在原生「最小化」按钮左侧（右侧 148px 原生按钮区之外），mac 上落在标题栏右端、红绿灯在另一侧。点击**打开一个「设置」页签**（不是弹窗），与工具页签同构：可关闭、可切换、常驻挂载；设置页签处于激活态时入口同步高亮（primary-light 底 + primary 字）。**首页不再有右下角悬浮设置按钮**。
- 标题栏整行 `-webkit-app-region: drag`，页签区与设置入口 no-drag。
- **标题栏默认无背景色**：不铺实色、不加分隔线，透出窗口画布；分层靠内容区上边界与原生窗口按钮。Windows 的 `titleBarOverlay` 底色同样设 `#00000000`，避免右上角露出一块实色矩形（见 `electron/main.ts` 的 `TITLEBAR_COLORS`）。
- **仅 acrylic 模式给标题栏铺半透明表面**（`.app-shell.is-acrylic .app-header`）：acrylic 是「强模糊 + 透光」的临时浮层材质，壁纸细节直接透上来，需压一层 `--color-header`（白 85%）+ `backdrop-filter: var(--glass-header)`（16px）稳住原生按钮与页签文字的对比度。mica / tabbed（壁纸取色）与 mac 的 vibrancy（轻模糊）都不铺——叠了反而糊成一片。
- 平台适配：mac 红绿灯左预留 88px，win/linux 右预留 148px（窗口按钮）。
- 页内菜单已移除，菜单动作由主进程系统菜单提供；底部状态栏已删除，主区直抵窗口底缘。
- 主区 `flex:1; min-height:0`，滚动只发生在内容区。

#### 7.1.1 半透明窗口

窗口外观（半透明 / 系统材质）由用户在「设置页签 → 窗口外观」切换，主进程是唯一事实来源
（`<data>/app/window-appearance.json`），渲染层只镜像状态用于挂 CSS 类。

##### 透明度与玻璃统一控制（`renderer/shared/styles/translucency.scss`）

**颜色 / 透明度 / 模糊三者分离**：`tokens.scss` 定义各表面角色的不透明基准色（`--color-<role>-base`）、
默认 alpha 与默认玻璃（`--glass-* = none`）；`translucency.scss` 按窗口模式覆写 alpha（`--alpha-*`）
与玻璃（`--glass-*`），并在 `:root` 用 `color-mix(in oklab, …)` 合成出 `--color-<role>` 供组件引用。

- 九个透明角色：`raised` / `input` / `field` / `table` / `button` / `fill` / `header` / `pop` / `overlay`，
  各自的职责与调节入口见 §3.1.1。
- 五个玻璃角色：`raised` / `input` / `header` / `pop` / `overlay`（另加恒定的 `veil`），
  见 §3.1.2。**同一个角色名同时管透视与模糊**，因此「让卡片更透一点」和「让卡片更糊一点」是同一个入口下的两个旋钮。
- **画布不参与 alpha**：`--color-canvas` 恒为 `transparent`——工具页与主页同一观感，透出窗口 / 桌面；
  半透明窗口的「透」由画布承担，各模式只在其余角色上做区分。
- **组件只引用合成变量 / 玻璃变量**，永远不写死 `rgba` 或 `blur(Npx)`，也不关心当前是哪种模式。
- **新增模式 = 加一条模式规则**覆写该模式的 alpha + glass 两组，组件零改动。
- 默认（不透明）模式 alpha 全为 `1`、玻璃全为 `none`，视觉与旧版完全一致。

##### 测试壁纸（调参辅助，`--appearance.testWallpaper`）

调 alpha / 玻璃最大的困难是**没有可对照的背景**：真实桌面壁纸往往一片柔和，
磨砂开与不开几乎看不出差别；系统材质还可能把窗口背后统一成一片渐变。

- 开启后 `App.vue` 给 `<html>` 挂 `has-test-wallpaper`，`translucency.scss` 据此在 `body`
  铺一面**高对比色块假壁纸**（令牌 `--test-wallpaper-base` / `--test-wallpaper-image`）：
  色块硬边界最容易暴露「模糊半径够不够、alpha 是否过高」。
- 铺在 `body` 而不是 `.app-shell`：EP 弹层 teleport 到 body 且盖满视口，壁纸必须在它们之下，
  并随视口固定（`background-attachment: fixed`），不随 `.app-main` 滚动。
- **与半透明开关、平台能力都无关**（`sanitizeWindowAppearance` 原样保留该字段）：
  不透明窗口下也能开，用于检查卡片白底压在高对比背景上是否仍显得干净。
- 关闭即摘类，`html` / `body` 回到 `base.scss` 的 `transparent`，透出真实桌面。

> `field` / `table` / `button` / `input` 四档**刻意分开**：单独调某一类控件时不必牵动其它控件。
> 其中 `field` 已被单独调低（acrylic 下 .30）：它只服务「卡片内的表单输入」，
> 与卡片叠加后的有效白 ≈ `.30 + .70×.78 ≈ .85`；贴画布（没有卡片托底）的控件走 `input`（.88）。

各模式 alpha 取值：

| 模式 | raised | input | field | table | button | fill | header | pop | overlay |
| ------ | -------- | ------- | ------- | ------- | -------- | ------ | -------- | ----- | --------- |
| 默认（不透明） | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| acrylic | .78 | .88 | .30 | .88 | .88 | .80 | .60 | .94 | .92 |
| mica | .96 | .97 | .97 | .97 | .97 | .95 | .96 | .98 | .98 |
| tabbed | .98 | .99 | .99 | .99 | .99 | .98 | .98 | 1 | 1 |
| vibrancy（mac） | .96 | .97 | .97 | .97 | .97 | .95 | .96 | .98 | .98 |
| 纯 transparent（无材质） | .88 | .93 | .93 | .93 | .93 | .90 | .88 | .96 | .96 |

各模式玻璃细节旋钮（`--alpha-highlight` / `--alpha-switch-track` / `--alpha-switch-knob`，见 §3.1.3）：

| 模式 | highlight | switch-track | switch-knob |
| ------ | ----------- | ------------ | ----------- |
| 默认（不透明） | 0 | 1 | 1 |
| acrylic | .60 | .82 | .94 |
| mica | .35 | .95 | .98 |
| tabbed | .25 | .98 | 1 |
| vibrancy（mac） | .40 | .95 | .98 |
| 纯 transparent（无材质） | .60 | .88 | .96 |

各模式玻璃取值（`saturate` 为共享增益，模糊半径单位 px）：

| 模式 | saturate | raised | input | header | pop | overlay |
| ------ | ---------- | -------- | ------- | -------- | ----- | --------- |
| 默认（不透明） | 100% | none | none | none | none | none |
| acrylic | 135% | 18 | 14 | 16 | 24 | 28 |
| mica | 115% | 10 | 8 | none | 16 | 18 |
| tabbed | 105% | 8 | 6 | none | none | none |
| vibrancy（mac） | 120% | 12 | 10 | none | 18 | 20 |
| 纯 transparent（无材质） | 110% | 20 | 16 | none | 24 | 28 |

取值原则：控件类（input / field / table / button）比卡片（raised）更实，避免边框与背后内容打架；
`pop` 最实，因为下拉贴在输入框下方、底下压着密集表单内容；`header` 在 acrylic 下最透（材质效果最强）。
玻璃半径与 alpha 反相关：越透的表面越需要糊（纯 transparent 没有系统模糊兜底，半径最大）；
`tabbed` 的浮层已不透明，模糊对它没有意义，故为 `none`——**只在真的能看出来时才付合成开销**。

##### 嵌套表面与玻璃层级（Tahoe / Liquid Glass）

玻璃只负责「表面 ↔ 背景」这一层，**不要给相邻的每一层都做玻璃**：

1. **分层**：壁纸 → 画布（`transparent`）→ 表面（唯一一层 blur）→ 控件（无 blur）→ 浮层（可再有一层）。
   一个视觉表面只做一次 `backdrop-filter`；`field` / `table` / `button` / `fill` 永远没有玻璃。
2. **合成不是叠加**：控件看到的是父表面合成后的颜色，不是壁纸。
   `控件实际 = α控·白 + (1−α控)·卡片`，`壁纸残留 = (1−α卡)(1−α控)`。
   文字处的壁纸残留 ≤ 15%（≈ 4.5:1 对比度的经验值），控件边界 ≥ 3:1。
3. **alpha 阶梯**：有内容的卡片 .82–.88 → 卡片内控件的**表面** .3–.6（叠加后有效 ~85%）→
   贴画布的控件 ≥ .8 → 浮层 .92–.96；文字 / 图标 / 状态指示件恒为 1（内容永远不透明）。
4. **前景件保持近实，靠高光读边界**：开关滑块、图标钮这类小体积元素，填充始终 ≥ .9，
   1px 高光只负责在透明轨道上把边界提亮；**真正参与透明的是轨道 / 卡片，不是滑块**
   （滑块调透会直接消失——不要把「透」用在承载状态指示的元件上）。
5. **禁用态用颜色降对比**，不要给容器写 `opacity`——那会把文字、图标、可点区域一起弄淡。
6. **避免 glass-on-glass**：确需叠加（弹层压卡片）时抬 alpha 到 .92+、降模糊半径，或合并成一层。
7. **圆角同心**：内层圆角 = 外层圆角 − 内边距（例如卡片 16 / 控件 10），一眼像一块材料。
8. **跟随系统「降低透明度」**：`@media (prefers-reduced-transparency: reduce)` 已把全部 alpha 退回 1、
   玻璃退回 `none`（见 `translucency.scss` 末尾）。
9. **每种窗口模式独立控制**：acrylic / mica / tabbed / vibrancy / transparent-only 各自有一份 alpha 与
   三档细节旋钮（highlight / switch-track / switch-knob）。调整顺序固定：
   先 alpha 定透视 → 再 `--glass-*` 定模糊 → 最后用 highlight 补边界。

其他约定：

- **必须同时放行 alpha**：`html` / `body` 的默认底色会盖住原生透明通道，
  `base.scss` 已把它们设为 `transparent`；漏掉这一步界面看起来毫无变化（最常见的坑）。
- **弹层必须靠 `<html>` 拿变量**：EP 的弹层全部 teleport 到 body，不在 `.app-shell` 内。
  模式类因此由 `App.vue` 同时挂到 `.app-shell` 与 `<html>`，`translucency.scss` 的 `mode()` mixin
  匹配这两处落点；`--color-*` 合成变量也定义在 `:root` 而非 `.app-shell`。
  只在 `.app-shell` 上定义会导致下拉 / 弹窗全部变成透明（曾踩过的坑）。
  mixin 只写 `html.is-x` 与 `.app-shell.is-x` 两种形态：前者是弹层唯一能继承到的来源，
  后者是 html 同步失效时的兜底；**`html.is-x .app-shell` 不写**——html 上已有类时它纯属重复。
  玻璃变量同理：它们由模式类覆写，因此同样同时挂在 `<html>` 与 `.app-shell`。
- **系统投影补偿**：透明窗口没有原生阴影，用 `--shadow-window-frame` 补回浮起感。
- **首页与工具页画布一律透明**，不再有「只铺工具页」的区别。
- **平台能力**（见 `shared/appearance.ts`）：win32 走 `backgroundMaterial`
  （mica / acrylic / tabbed，需 22H2+），darwin 走 `vibrancy`，二者与 `transparent` 互斥；
  Linux 不声明支持（依赖合成器）。能力表同时驱动设置页里选项的禁用态。
- **生效时机**：`transparent` / `vibrancy` / `backgroundMaterial` 只在窗口构造时生效，
  因此外观必须先于 `createWindow` 读盘；运行期切换只能改 CSS 与部分原生 setter。

### 7.2 首页工具网格

- 内容最大宽 `--content-max-width`，居中。
- 工具卡片：白底浮岛 + 字母头像行，hover 浅底提示；收藏星标为绝对定位浮层。
- 搜索 / 收藏重排用 `TransitionGroup` 平滑过渡。

### 7.3 工具页

- **侧栏 + 主区**（chrome-sandbox / env-browser）：`grid-template-columns: <sidebar> 1fr`，窄屏（≤760px）折为上下堆叠。
- **页签 + 面板**（interceptor / telegram-cache / offline-pack）：`tool-page` 容器 + `UiMenuHorizontal` 页签栏 + `KeepAlive` 包裹的 `<component :is>` 面板，子视图由路由驱动；需要品牌图标时给 `items` 传 `icon`。
- **顶栏 + 内容**（treease / wxp）：`UiToolbar` 顶栏 + 下方滚动内容。
- **居中表单**（id-card-generator）：`tool-page` 内居中卡片。

### 7.4 面板与详情

- 详情用 `UiDetailGrid` + `UiDetailItem`（label + value 卡片，≤760px 单列）。
- 键值清单用 `UiKeyValue`（顶部分隔线式）。
- 分区用 `UiPanel variant="outlined"`（描边分区块）。

### 7.5 表格

- 统一用 `el-table`（`size="small"`），表头 / 行 hover 取 `--color-fill`、行底取 `--color-table`、容器 `radius-lg` 由全局绑定。
- 数字列用 `.mono`，时间列用 `.muted`，状态列用 `el-tag` 或 `UiChip`。

## 8. 交互与动效

- **入场动画**：应用外壳顶栏下滑淡入；工具页侧栏左滑、状态面板右淡入（gsap）。
- **路由过渡**：`.page-*` 类实现淡入淡出 + 轻微位移。
- **卡片 hover 抬高**：列表卡 / 工具卡 hover 抬描边或浅底；标题栏设置入口 hover 铺 `--color-fill` 浅底。
- **prefers-reduced-motion**：全局降级（动画时长压缩到 0.01ms），已在 `main.scss` 处理。

## 9. 无障碍

- 图标按钮提供 `aria-label` / `title`。
- 键盘焦点统一 `--shadow-focus` 焦点环。
- 交互元素可键盘触发（列表卡支持 Enter / Space）。
- 文本对比遵循主/次级/三级分层。

---

*本文档随 UI 演进维护；令牌与组件变更需同步本文件与 [AGENTS.md](./AGENTS.md)。*
