# everydaytool UI 设计文档

> 本文档描述 everydaytool（edt）的视觉语言、设计令牌与 UI 组件规范，是界面开发与评审的单一权威参考。实现细节（令牌定义、全局样式）位于 [`renderer/shared/styles/`](renderer/shared/styles/)（入口 `main.scss`，令牌 `tokens.scss`，半透明层 `translucency.scss`），组件源码位于 [`renderer/shared/components/ui/`](renderer/shared/components/ui/)。

## 1. 设计原则与视觉语言

- **冷灰底 + 品牌蓝强调**：冷灰画布、玻璃卡片、圆角友好，以品牌蓝作为唯一的**动作色**；
  工具身份色只做图形（圆点 / 浅底 / 描边），语义色只讲状态。
- **固定浅色**：无主题切换，颜色一律走语义令牌，禁止硬编码。
- **令牌优先**：所有组件通过 `var(--token)` 引用设计令牌，禁止硬编码颜色 / 圆角 / 阴影。
- **颜色先分档再分色**：每支色相先确定「它是图形（亮档，≥3:1）还是文字（墨档，≥4.5:1）」，
  再决定用哪个颜色——不要把一支亮色同时当底色和字色（见 §3.1）。
- **圆角与浮岛**：按钮、页签为圆角矩形；头像、徽章保持圆形/胶囊；卡片与面板为浮岛，靠细边框与轻阴影分层。
- **组件减法**：能用 Element Plus（`el-*`）组件的不自造，覆写只写几何差异，颜色与状态交给全局令牌绑定。
- **反过度设计**：间距、宽度、圆角严格取令牌阶梯，不为一两像素差异新增魔法数字。

## 2. 主题

固定浅色主题，核心色板如下（每支色相先分「图形 / 文字」两档，见 §3.1）：

| 角色 | 值 | 用途 |
| ------ | ----- | ------ |
| 品牌蓝（Primary · 亮档） | `#3390ec` | 品牌标底、焦点环、选中浅底的来源、状态圆点、进度条 |
| 品牌蓝（Strong · 墨档） | `#006dc3` | 链接、主按钮实底、选中项文字 |
| 画布（App BG） | `#f4f4f5` | 应用背景、工具页底色 |
| 表面（Surface） | `#ffffff` | 卡片、面板、输入框、表格 |
| 主文本 | `#000000` | 正文 |
| 次级文本 | `#5f646b` | 说明文字、弱化内容 |
| 三级文本 | `#6b7077` | 元信息、时间戳、占位符 |
| 边框 | `#dadce0` | 输入边框、分隔线 |
| 成功绿 | `#007b54` | 运行中、已启用、未读徽章 |
| 警告琥珀 | `#975f00` | 警示、固定标记、收藏星 |
| 错误红 | `#cf1c28` | 错误、危险操作 |

## 3. 设计令牌

令牌定义在 `renderer/shared/styles/tokens.scss`（基础令牌）与 `translucency.scss`（半透明 alpha 层），由 `main.scss` 按 tokens → base → element-plus → utilities → translucency 的顺序引入。令牌是「语义基线」：未引用令牌应删除、纯别名令牌应合并、重命名需同步全部引用。

### 3.1 颜色

**色阶规则（每支色相先回答「它是图形还是文字」）**

| 档 | 令牌 | 对白底的对比 | 允许做的事 | 禁止做的事 |
| ------ | ------------------- | ---------- | ---------------------------- | ---------------------- |
| 亮档 | `--color-<tone>` | ≥ 3:1 | 圆点、浅底、描边、焦点环、进度条、品牌标底 | 11–14px 小字（亮蓝只有 3.31:1） |
| 墨档 | `--color-<tone>-strong` | ≥ 4.5:1 | 文字、图标、**以及承载白字的实底**（白字对它同样 ≥ 4.5:1） | 大面积装饰 |
| 语义 | `--color-success / warning / error` | ≥ 4.5:1（自身 10% 浅底上同样 ≥ 4.6:1） | 圆点、文字、实底、浅底来源 | — |

- **语义色只有一档**：它既要当 10px 状态圆点，也要当 11px 状态文字、实底徽章与提示条底色，
  所以取值直接站在墨档上。**同一支色还会淡成自己的浅底**（`color-mix(<tone> 10%, transparent)`），
  每个值都验算过「白底 + 自身浅底」两个落点——只验白底会漏掉整类提示条 / 徽章的不可读。
- **浅底两档**：`--color-primary-soft`（10%）可以压墨档蓝文字；`--color-primary-light`（20%）
  只能配中性黑文字或图形（墨档蓝压 20% 浅底只有 4.06:1）。
- **工具身份色**（`--tool-accent`）：`App.vue` 按当前工具的 `color` 覆写，页签按各自工具色覆写。
  它独占**选中 / 地点**这一族——页签选中态、页内分段菜单（`UiMenuHorizontal`）、分段钮
  （`el-radio-button`）、列表卡选中态；只做**图形**（14% 浅底、6px 圆点、描边），
  文字一律留中性黑：工具色里一半是相近的蓝，当文字读会互相打架。
- **三种色各管一件事**，同一个界面里不会有两只色抢同一个含义：
  **动作 / 注意 = 品牌蓝**（主按钮、链接、计数徽章）、**选中 / 地点 = 工具身份色**、
  **状态 = 语义色**。表格行选中与下拉项 hover 属过渡态，仍取品牌浅底。
- **数值在 OKLCH 里反解**（保持色相，压亮度 / 收彩度），不要肉眼调；改色先在白底 + 自身 10% 浅底上验算。

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
| `--color-primary` | `#3390ec` | 亮档蓝（图形 / 浅底 / 焦点环 / 圆点） |
| `--color-primary-strong` | `#006dc3` | 墨档蓝（链接 / 主按钮 / 选中项文字） |
| `--color-primary-soft` | `color-mix(in srgb, primary 10%, transparent)` | 选中行 / 选中项浅底（可压墨档蓝字） |
| `--color-primary-light` | `color-mix(in srgb, primary 20%, transparent)` | 选区块 / 文本选区（只配中性黑） |
| `--color-success` | `#007b54` | 成功 / 运行态 |
| `--color-warning` | `#975f00` | 警告 / 固定标记 / 收藏星 |
| `--color-error` | `#cf1c28` | 错误 / 危险操作 |
| `--tool-accent` | `var(--color-primary)` | 工具身份色（外壳按当前工具覆写） |
| `--color-app-bg` | `#f4f4f5` | 画布兜底色（实际画布为透明，见 7.1.1） |
| `--color-on-solid` | `#ffffff` | 实底上的前景白（绿底徽章白字 / 头像字母 / 白分隔线），不随透明度变 |
| `--color-border-light` | `#e4e4e5` | 细分隔线、卡片描边 |
| `--color-border` | `#dadce0` | 输入边框 |
| `--color-text-primary` | `#000000` | 主文本 |
| `--color-text-secondary` | `#5f646b` | 次级文本 / 弱化（白底 5.96 / 灰调填充 5.42） |
| `--color-text-tertiary` | `#6b7077` | 元信息 / 时间戳 / 占位符（白底 4.99 / 灰调填充 4.54） |

> **三级文本必须单调**：次级比三级深。曾经的 `#707579` / `#686c72` 是反的，且两者压在
> `--color-fill`（表头 / hover 行）上都掉到 4.2–4.5 之间——改色阶时一并按两种落点重算。

### 3.1.1 半透明表面角色（颜色 × alpha 两层）

每个表面角色拆成「基准色（`--color-<role>-base`）× 透明度（`--alpha-<role>`）」，
两者在 `translucency.scss` 里用 `color-mix` 合成出 `--color-<role>` 供组件引用。
**新增角色需同时改四处**：`tokens.scss` 的 `--color-<role>-base` + `--alpha-<role>` + `--glass-<role>`，
以及 `translucency.scss` 的合成与各模式取值。新增模式只加一条模式规则（alpha + glass 两组），组件零改动。

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

### 3.2 字体与字阶

#### 3.2.1 字体栈

| 用途 | 字体 |
| ------ | ------ |
| 拉丁正文 | `Roboto`（自托管，**只有 400 / 500 两个切面**） |
| 中文正文 | 系统中文面：`PingFang SC`（mac）/ `Microsoft YaHei`（win），**只有 Regular / Bold** |
| 等宽 / 数字 | `--font-mono`：Cascadia Mono / Roboto Mono / SF Mono / Menlo / Consolas |
| 字母头像 / 品牌标 | `--font-brand`：`Nunito` ExtraBold 800（Roboto / sans-serif 兜底） |

**栈的语义**：`Roboto` 打头负责拉丁与数字，中文按字形缺失逐字落到 `PingFang SC` / `Microsoft YaHei`；
`-apple-system` / `Segoe UI` 夹在中间只为补齐符号（箭头、项目符号）。顺序**不要**改成中文面打头——
那会把拉丁也交给雅黑，字宽与字形都变粗变方。

> 等宽只通过 `.mono` 工具类使用（`--font-mono` + `font-variant-numeric: tabular-nums`），
> **禁止硬编码 `Consolas` / `ui-monospace`**；品牌标与字母头像用 `--font-brand` + `--font-weight-brand`。

#### 3.2.2 字阶：5 档，唯一字号来源

| 令牌 | 值 | 角色 | 典型用法 |
| ------ | ----- | ------ | ------ |
| `--font-size-xs` | `11px` | 元信息 | 时间戳、徽章（`UiChip`）、表格辅助列、代码、计数 |
| `--font-size-sm` | `12px` | 辅助正文 | 说明 / 提示（`UiHint`）、键值、表格正文、次级按钮（`size="small"`）、下拉项 |
| `--font-size-base` | `14px` | 正文 | 正文、控件文字、面板标题（`UiPanel` 默认）、卡片名、目录树 |
| `--font-size-lg` | `16px` | 区块标题 | `UiSectionHeader`、`UiPanel titleSize="lg"`、状态名、设置页分区标题 |
| `--font-size-xl` | `18px` | 页面标题 | 工具页 / 设置页一级标题、规则编辑器标题（**全站上限**） |

**规则**

- 字号**只引用令牌**，禁止 `font-size: 13px` 这类字面量，也不用 `em/rem` 做页面缩放（桌面壳不支持缩放）。
- **18px 是上限**：本应用没有营销型大标题，不再出现 20 / 24 / 28px 的散值；需要强调时用层级（间距 + 字号）与色阶，不放大字号。
- **18px 目前只有规则编辑器在用**：工具页 / 设置页**不放页面大标题**——页签已经写着工具名，
  再压一行标题是重复（见 `SettingsPage` 顶部注释）。`--font-size-xl` 留给需要"独立成篇"的编辑器标题。
- Element Plus 的 5 档字号已全部绑到本表（`--el-font-size-extra-small/small/base/medium/large`），
  改 `tokens.scss` 即按钮 / 输入 / 表格 / 弹层 / 消息同步生效（EP 默认 small 13 / extra-small 12 已统一为 12 / 11）。
- 数字看板与计数**不放大字号**，靠 `.mono` + `--font-weight-bold` 提升可读性。

#### 3.2.3 字重：只有两个真切面

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
| `--font-weight-regular` | 400 | 正文、表格正文、说明 |
| `--font-weight-medium` | 500 | **唯一的强调档**：标题、按钮、页签、标签、卡片名、面板标题 |
| `--font-weight-bold` | 700 | 只给正文里的 `<strong>`（中文有真粗体）与数字看板 |
| `--font-weight-brand` | 800 | 只给 Nunito 品牌标与字母头像（拉丁专用面） |

**为什么没有 600**（实测，Chromium + 本机字体栈）：

| 声明的 weight | 拉丁（Roboto 有 400/500） | 中文（雅黑有 Regular/Bold） | 结果 |
| -------------- | ------------------------- | --------------------------- | ------------------------------------ |
| 400 | Regular | Regular | 一致 |
| 500 | Medium | Regular | 基本一致（拉丁略重） |
| **600** | **Medium（不变）** | **Bold** | **同一行里中文突然变粗，右半句更重** |
| 700 | Medium（不变） | Bold | 中文可读作强调，拉丁不动 → 靠色阶补 |

- 所以层级**不靠字重**：字号 + 色阶 + 间距承担；500 是全站唯一的"这里要重一点"。
- `<strong>` 的强调由 base.scss 补一条色阶（正文说明是次级灰 → 强调抬到主文本黑），
  中文再多一层真粗体；拉丁即使不加粗也读得出强调。
- 正文与 UI 禁用 300 / 600 / 800；`font-synthesis-weight: none` 全局关掉合成粗体
  （合成加粗在 11–12px 上会发虚）。

#### 3.2.4 行高

| 场景 | 取值 |
| ------ | ------ |
| 单行控件 / 表格 / 徽标 | `--line-height-control`（`20px`） |
| 正文 / 列表项 | `1.5`（`body` 全局默认） |
| 紧凑说明（11–12px 提示，可能折行） | `1.5` |
| 长文段落（步骤、说明块） | `1.6` |
| 图标 / 纯图形 / 单行窄标签 | `1`（或等值 px，如 mono 徽标 `14px`） |

> 行高不得低于 `1.5`（**含 11–12px 的说明**：中文在这个字号下的字形框接近满格，
> 1.4 只有 15.4px 行距，两三行就糊成一段）；不再出现 `1.7` 以上的散值。
> 单行元素（按钮文字、徽标）用 `1` 或控制行高，不参与这条规则。
> 表格的实际行高 = `.cell` 上下内边距（§7.5）+ `--line-height-control`，
> EP 自带的 23px 单元格行高已在 `element-plus.scss` 收回令牌。

#### 3.2.5 字距

- 正文与标题：`0`，**不加字距**。
- 小号全大写 / 等宽短标签：`0.25–0.5px`（如 interceptor 规则类型标签、品牌标 `0.05em` ≈ `0.6px`），仅限短标签。
- 禁止在长文本 / 段落上使用 `letter-spacing`。

#### 3.2.6 标题标签（`h1–h6`）

- 已全局 reset：`margin: 0` + `font-size: inherit` + `font-weight: var(--font-weight-medium)` + `text-wrap: balance`。
- 因此**标题必须显式取令牌字号**（例：`UiSectionHeader` 用 `lg`、工具卡名用 `base`、沙箱名用 `lg`）；
  禁止依赖浏览器默认的 h1–h6 字号（21 / 18 / 16px，会直接越过 18px 上限）。
- 标题与正文之间**上方间距必须大于下方**（区块间距 32 / 标题到内容 12）：标题属于它下面的那一块。

#### 3.2.7 数字与等宽

- 数字 / ID / 字节 / 时间 / 代码统一 `.mono`；表格数字列右对齐，计数不放大字号。
- 等宽字号跟随上下文令牌（表格里 `sm`、徽章里 `xs`），不为等宽单开档位。
- 全局 `font-variant-numeric: tabular-nums`：表里的数字纵向对齐优先于正文里的数字美观。
- **唯一例外**：`UiAvatar` 的字母字号按头像直径计算（`size × 0.43`，内联 style），因为它是图形元素而非文本。

#### 3.2.8 排版细节（浏览器表面）

这些是「不画也属于设计」的部分，统一在 `base.scss` 里声明，业务文件不要各自覆写：

| 项 | 值 | 理由 |
| ---- | ------------------------- | ------------------------------------------------------------ |
| 中英自动间距 | `text-autospace: normal` | CJK 与拉丁 / 数字相邻时补光学距离（「端口8080」不再糊成一团）；不支持的浏览器忽略 |
| 折行 | 标题 `balance`、正文 `pretty` | 避免中文提示把最后一个字甩到下一行；两者都是渐进增强 |
| 光标 | `caret-color: --color-primary-strong` | 默认黑竖线在浅底卡片上很扎眼 |
| 选区 | `::selection` = `--color-primary-light` | 与品牌浅底同一档 |
| 字形渲染 | 不设 `text-rendering` | Chromium 的 `geometricPrecision` 会关掉 hinting，小字号在 Windows 上更糊，且实测排版宽度完全一致 |
| 合成字重 | `font-synthesis-weight: none` | 没有真切面就不加粗，避免发虚 |

### 3.3 间距

`--spacing-*` 阶梯（唯一间距来源，禁止魔法数字）：

| 令牌 | 值 | 令牌 | 值 |
| ------ | ----- | ------ | ----- |
| `--spacing-xs` | `4px` | `--spacing-xl` | `20px` |
| `--spacing-sm` | `8px` | `--spacing-2xl` | `24px` |
| `--spacing-md` | `12px` | `--spacing-3xl` | `32px` |
| `--spacing-lg` | `16px` | | |

> 取值规则：魔法数字就近向上取整到最近阶梯（6→sm、10→md、14→lg、18→xl、22px 行高→`--line-height-control`、28~42→2xl/3xl）。
>
> **豁免项**（结构常数，不受阶梯约束）：边框宽度、图标 / svg 尺寸（12–20px）、1–2px 微内边距、999px 胶囊圆角、
> 表格列宽 / `min-width`、内容栏 `max-width`、组件几何（如 `UiMenuHorizontal` 条高 48 / 项高 40）。
>
> **同一模式只写一次**：卡片 / 灰底面版 / 虚线新增钮等同构模式合并为「单一类 + 修饰类」，
> 宽度一律走 `.ctl-*` 阶梯或 `flex` 填充，不为一点差异新增魔法数字。

#### 3.3.1 节奏：四档，按「关系远近」选，不按「好看」选

同一个间距值如果被用在两种关系上，两种关系就读成了一种。全站只用四档纵向节奏：

| 档 | 值 | 关系 | 落点 |
| ---- | -------- | ------------------ | ------------------------------------------------------ |
| 分区 | `32px`（3xl） | 互不相干的大块 | 首页「我的收藏 / 所有工具」之间 |
| 区块 | `24px`（2xl） | 同级区块（并列） | 设置页七个面板之间、WXP 状态卡 / 设置 / 说明之间、离线包页签条 / 工作区 / 历史之间 |
| 块内 | `16px`（lg） | 同一块里的不同部分 | 面板标题→内容、卡片之间的网格间距、页面内边距 |
| 行内 | `8px`（sm） | 同一件事的相邻行 | 键值行、按钮组、说明与它解释的控件 |

- **标题的上方间距必须大于下方**：分区 32 / 区块 24 在上，块内 16 在下——标题属于它下面那一块。
- **不要用 16 当「同级区块」的间距**：设置页曾经七个面板全用 16，与「标题→内容」同值，
  结果七个分区读成一整条长列表。
- 横向内边距（页面边距）不在节奏里，见 §3.4 与 §7.3 的页面骨架。

### 3.4 几何外壳

| 令牌 | 值 | 用途 |
| ------ | ----- | ------ |
| `--control-height` | `32px` | 表单控件 / 图标按钮统一高度 |
| `--line-height-control` | `20px` | 控件 / 表格 / 徽标统一行高 |
| `--content-max-width` | `1360px` | 首页内容最大宽 |
| `--column-document` | `760px` | 文档型页面的内容栏宽（设置 / 离线包），见 §7.3 |
| `--measure-prose` | `62em` | 长文行宽上限（CJK ≈ 60 字；12px 下 744px，略窄于文档栏） |
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
| `--shadow-focus` | `0 0 0 1px #fff, 0 0 0 3px var(--color-primary-strong)` | 键盘焦点环（1px 白隔断 + 墨档蓝实环，对任意底色 ≥3:1） |
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

**注入顺序（必踩的坑）**：EP 的组件 CSS 由 `ElementPlusResolver({ importStyle: 'css' })` 懒加载、**晚于** `element-plus.scss` 注入，
同权声明会被 EP 盖回。需要压过 EP 默认值的规则一律带 `html` / `.el-xxx .el-yyy` 前缀并在注释写明原因
（现有先例：`html .el-switch`、`html .el-table`、`html .el-alert`）。

## 5. UI 组件库

平台级组件库（27 个组件 + `icons.ts` 图标名表），源码在 `renderer/shared/components/ui/`，由 `unplugin-vue-components` 自动注册（模板内直接用，无需 import；composable 需显式 import）。以下是完整规范。

**使用约定（硬性）**

- **新工具页优先用组件**：卡片 / 分组 / 键值 / 提示 / 空态 / 表格 / 进度 / 徽章 / 对话框等模式一律走本库，禁止在业务文件里重写同类通用样式；组件确不满足时写局部样式并在注释说明原因。
- **表格与进度条必须走 `UiTable` / `UiProgress`**，不直接写 `el-table` / `el-progress`；状态标签用 `UiChip`（`variant="soft"`），不写 `el-tag`。`pnpm check:ui` 会断言这三类用法归零。
- EP 类名知识只允许存在于本库组件内部；组件对外只暴露语义 props（`tone` / `variant` / `padding` …），不暴露 EP 类名。
- `main.scss` 原 `.surface-card` / `.detail-grid` / `.detail-item` / `.kv-row` / `.form-hint` / `.chip` / `.inline-group` 已全部由本库取代并删除，**不得恢复**。

### 5.1 布局

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiPanel` | `title`、`variant`（`raised` 浮岛 / `outlined` 描边）、`padding`、`titleSize`（`sm`/`lg`）、`shadow`（`sm`/`md`）、`#title` / `#actions` 插槽 | 基础卡片 / 面板。`raised` = surface-raised + radius-lg + shadow；`outlined` = surface-raised + border-light + radius-lg |
| `UiGroup` | `gap`（xs/sm/md/lg）、`align`、`justify`、`block`、`direction`（row/column）、`wrap` | 行内 / 纵向控件组，替代裸 `display:flex` 布局 |
| `UiToolbar` | `bordered`、`surface`、`wrap`、`gap`、`padding`、`flush`、`#end` 插槽 | 工具条：默认插槽放左，`#end` 放右；`flush` 去除 EP 按钮原生左边距 |
| `UiSidebar` | `title`、`titleTone`（subdued/emphasis）、`width`（252px）、`padding`、`#title`/`#actions`/`#footer` 插槽 | 侧栏容器（border-right + surface-raised） |
| `UiDetailGrid` | `columns`（2） | 详情卡片网格，≤760px 折为单列 |
| `UiSectionHeader` | `title`、`count`、`#actions` 插槽 | 区块标题（无分隔线，仅计数） |
| `UiMenuHorizontal` | `modelValue`、`items`（`{ value, label, badge?, icon? }[]`）、`update:modelValue` | 横向分段菜单：选中胶囊 + 滑动指示条（`transform`/`width` 过渡）+ 横向滚动（滚动条隐藏）+ 选中项自动滚入视野。复刻 Telegram Web K 的 `.menu-horizontal-div`；条高 48、项高 40、字号取平台 14px；条容器走 `--radius-lg`，与卡片 / 面板圆角一致；`icon` 传 SVG 资源 URL（16px，与 label 间距 `--spacing-xs`，如离线包下载的品牌 logo）。**选中胶囊取当前工具的 `--tool-accent` 14% 浅底 + 中性黑标签**，计数徽章仍是墨档蓝（系统的注意信号不跟工具走） |

### 5.2 数据展示

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiKeyValue` | `label`、`labelWidth`（64px）、`mono`、`wrap`、`muted`、`#actions` 插槽 | 键值行（顶部分隔线式，label 左 / value 右） |
| `UiDetailItem` | `label`、`mono`、`wrap`、`size`（sm/xs） | 详情卡片单项（label 上 / value 下，描边卡片） |
| `UiCodeBlock` | `maxHeight`（200px）、`wrap` | 等宽代码块（app-bg 底 + radius-sm + 滚动） |
| `UiEmpty` | `text`、`variant`（plain/bordered）、`center`、`icon`、`padding` | 空状态（纯文本 / 虚线框） |
| `UiTable` | `data`、`loading`、`emptyText`、`height`、`maxHeight`、`rowKey`、`mono`、`rowClickable`、`#empty` 插槽；默认插槽放 `el-table-column` | 表格基座：内部 `el-table size="small"`，统一 loading、空态（渲染 `UiEmpty`）、整表等宽与可点行手型。其余属性 / 事件（`@row-click`、`@sort-change`、`row-class-name`、`:tree-props`、`default-expand-all`、`class`）由单根组件自动透传，树形表格也能直接用 |
| `UiProgress` | `percentage`、`strokeWidth`（6）、`status`（success/warning/exception）、`showText` | 进度条：百分比自动收敛 0–100；颜色与轨道走全局 EP 绑定（`--el-color-primary` / `--el-border-color-lighter`），两端胶囊圆角；**不要直接写 `el-progress`** |
| `UiBreadcrumb` | `items`、`navigate` 事件 | 面包屑导航 |

### 5.3 徽章 / 状态

| 组件 | Props / 变体 | 说明 |
| ------ | ------------- | ------ |
| `UiChip` | `tone`（neutral/primary/success/warning/danger/info）、`variant`（auto/soft/solid/outline）、`mono` | 小胶囊徽章。`variant="auto"`（默认）按 tone 取历史外观：neutral→描边、success→实底绿白字、其余→浅底彩字；`soft` 浅底彩字（对齐原 `el-tag` 默认样式）、`outline` 透明底彩边、`solid` 实底反白（计数徽章）。**底色取亮档、文字与实底取墨档**（`--chip-tone` / `--chip-ink`）：11px 状态胶囊永远是可读档 |
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
| `UiListCard` | `active` | 可点列表卡片。hover 只提描边（身份色 45%），`active` 才铺浅底（身份色 8% + 70% 描边）——鼠标路过与真正选中不再同一种视觉 |

### 5.7 通用状态约定

| 状态 | 表现 |
| ------ | ------ |
| hover | 卡片浮岛 hover 变浅底或抬描边（工具卡描边取**工具身份色** 42%）；按钮 hover 变浅（主按钮）/ 浅底（次按钮）；图标钮 hover 抬深 + 浅底 |
| active / 选中 | 身份色浅底（14%）+ 中性黑文字 + 身份色描边（页签 / 分段菜单 / 分段钮 / 列表卡同一套）；收藏星为**实底琥珀 + 白星**（与 hover 的浅底琥珀区分） |
| focus | `--shadow-focus` 蓝色内环（亮档蓝，3.31:1 ≥ 图形 3:1；输入框为蓝边框 + 无外发光） |
| disabled | EP 默认禁用灰（走全局绑定），图标/文字按钮降低透明度——**不**调容器 opacity |

## 6. 通用工具类

| 类 | 用途 |
| ---- | ------ |
| `.tool-page` | 工具页容器：填充主区域并在内部滚动 |
| `.muted` | 弱化文本（`--color-text-secondary`） |
| `.mono` | 等宽数字字体（`--font-mono` + tabular-nums） |
| `.ctl-xs/sm/md/lg` | 表单控件定宽阶梯（90/140/200/280px） |
| `.ctl-fill` | 弹性填充剩余宽度 |
| `.btn-flush` | 消除 EP 按钮间原生 12px 左边距 |
| `.radio-flush` | 消除 EP 单选钮原生 `margin-right` 与固定行高（单选用 `gap` 排版时加） |
| `.full-width` | 占满容器宽度 |

**使用约定**

- 弱化说明文字用 `.muted` 或 `--color-text-secondary`；**排版统一用语义色，不用 `--el-text-color-*`**（那是 EP 内部绑定入口）。
- 卡片 / 网格 / 键值 / 提示 / 行内组等通用模式一律用组件库（见 §5），不得在 `main.scss` 恢复旧通用类。
- **组件减法优先于样式微调**：手搓 `<table>` / 分段钮 / 侧栏菜单 / 输入框 / 下拉，先用平台组件（`UiTable` / `el-radio-button` / `el-menu` / `el-input` / `el-dropdown`）再谈覆写。
- **层级靠字号与色阶，不靠字重**：拉丁面只有 Regular / Medium 两个切面（§3.2.3），
  600 会让中英混排半边变粗。需要更强的标题时，加字号、加间距、抬色阶，不要换字重。
- 结构性间距 / 宽度 / 圆角见 §3.3–§3.5 的阶梯与豁免项，不要为一点差异新增魔法数字。

## 7. 布局模式

### 7.1 应用外壳

- 自定义标题栏（`titleBarStyle: hidden` + `titleBarOverlay`）：左侧品牌标 `edt`（Nunito 圆角，10% 品牌浅底 + 墨档蓝字）+ 工具页签。
- **页签带工具身份色**：每个工具页签前有一枚 6px 圆点（取该工具的 `color`，静息 65% 不透明、选中 100%），
  选中态是「身份色 14% 浅底 + 中性黑标签」。同一支色在首页卡片头像、卡片 hover 描边、
  页内 `UiMenuHorizontal` 选中胶囊上复用——**同色 = 同一个工具**；应用自带页面（设置）没有工具色，退化为品牌蓝。
  身份色只做图形，标签文字永远是中性黑：亮档蓝压浅底当 12px 文字只有 2.66:1。
- 无打开页签时仅显示品牌标。
- **设置入口固定在标题栏右端**（`.header-settings`，34px 方形图标钮，齿轮图标）：Windows / Linux 上正好落在原生「最小化」按钮左侧（右侧 148px 原生按钮区之外），mac 上落在标题栏右端、红绿灯在另一侧。点击**打开一个「设置」页签**（不是弹窗），与工具页签同构：可关闭、可切换、常驻挂载；设置页签处于激活态时入口同步高亮（primary-light 底 + primary 字）。**首页不再有右下角悬浮设置按钮**。
- **工具页签支持浏览器式拖拽排序**：拖拽中实时重排并用 FLIP 过渡，顺序随 `edt:tool-tabs` 持久化；拖拽浮层始终被钳在页签条可视区内（拖出边缘只停在首 / 尾槽，不会飞出页签区），`Esc` 取消；触屏保留横向滚动，不触发拖拽（指针类型不是鼠标 / 触笔时只滚动）。
- 标题栏整行 `-webkit-app-region: drag`，页签区与设置入口 no-drag。
- **标题栏默认无背景色**：不铺实色、不加分隔线，透出窗口画布；分层靠内容区上边界与原生窗口按钮。Windows 的 `titleBarOverlay` 底色同样设 `#00000000`，避免右上角露出一块实色矩形（见 `electron/main.ts` 的 `TITLEBAR_COLORS`）。
- **仅 acrylic 模式给标题栏铺半透明表面**（`.app-shell.is-acrylic .app-header`）：acrylic 是「强模糊 + 透光」的临时浮层材质，壁纸细节直接透上来，需压一层 `--color-header`（白 85%）+ `backdrop-filter: var(--glass-header)`（16px）稳住原生按钮与页签文字的对比度。mica / tabbed（壁纸取色）与 mac 的 vibrancy（轻模糊）都不铺——叠了反而糊成一片。
- 平台适配：mac 红绿灯左预留 88px，win/linux 右预留 148px（窗口按钮）。
- 页内菜单已移除，菜单动作由主进程系统菜单提供；底部状态栏已删除，主区直抵窗口底缘。
- 主区 `flex:1; min-height:0`，滚动只发生在内容区。
- **页签机制是工程约定**：应用级页面（设置等）与工具页共享同一套页签（`APP_TABS` 注册、`electronOnly` 裁剪、`subRoutes` 拍平），注册方式与命名约定见 [AGENTS.md](./AGENTS.md)「布局与页签机制」。

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
- **首页不再按分类分组**：所有工具一张平铺网格（收藏单独一块，顺序与「所有工具」一致）。
- 默认顺序按工具 `createdAt` 倒序（最新在前）；拖拽卡片可自定义顺序，落配置层 `app/ui-preferences.json`
  （LocalStorage 仅镜像），区块头提供「恢复默认排序」。
- 拖拽排序用「固定槽位 + transform 实时预览」：拖拽中 DOM 顺序不动，卡片用 CSS `transform`
  滑入目标槽位，松开后再一次性提交顺序；避免过渡动画与原生拖拽互相打断。
- 工具卡片：白底浮岛 + 字母头像行，hover 浅底提示；收藏星标为绝对定位浮层。
- **卡片用工具自己的色**：头像渐变、hover 描边（身份色 42%）、拖拽源虚线都取 `--tool-accent`；
  收藏星是全站唯一的琥珀：静息灰描边星 → hover 浅底琥珀星 → 已收藏实底琥珀 + 白星（4.89:1）。
  「我的收藏」区块标题前用同一支琥珀星，让这一区一眼可认。

### 7.3 工具页：两种骨架

工具页只有两种骨架。**选错骨架**（把表单铺满 1600px、或把数据网格塞进 760 栏）是这一层最常见的返工。

| 骨架 | 判据 | 页面骨架 | 谁 |
| ------ | ---------------- | ---------------------------------------------- | ------------------------------------------ |
| **文档型** | 读完 → 填 → 确认 | 内容栏 `--column-document`（760）居中；页面内边距 `24 / 32 / 32`（≤760 收 16）；同级区块 24 | 设置、离线包、身份证生成器 |
| **工作区型** | 边看边操作、多区域并行 | 铺满窗口，**不设内容栏**；面板 / 侧栏 / 表格可贴边，贴边时由各 pane 自己的内边距负责呼吸（≥12） | interceptor、telegram-cache、env-browser、chrome-sandbox、workbuddy2api |

- **文档型为什么要有栏**：不设栏时窗口一宽，「标签 → 输入框」能拉出 1500px，扫读要转头；
  说明文字又会因为 `--measure-prose` 在半途截断，右边缘和输入框对不齐。
  栏宽固定后，标题、正文、控件、说明的左右边缘落在**同一条线**上。
- **WXP 走「文档型」的全宽变体**：结构不变（状态 → 填 → 确认，标签 + 控件），但内容栏从 760 改为**铺满窗口**——
  它的 WXP 路径、启动参数、登录信息键值与收藏表格都靠宽度换可读性，居中窄栏在宽窗口下两侧空一大片。
  页面内边距仍取 `24 / 32 / 32`（≤760 收 16），面板自身内边距与内部节奏不变。
- **工作区型为什么不能有栏**：表格列、webview、双栏面板靠宽度换信息密度；加栏等于把可用区砍掉一截。
  它们只守一条：**页面级内边距 0–16，且内容不贴死窗口边**——pane 内部自己负责 12–16 的呼吸。
- 具体实现：
  - 侧栏 + 主区（chrome-sandbox / env-browser）：`grid-template-columns: <sidebar> 1fr`，≤760px 折为上下堆叠。
  - 页签 + 面板（interceptor / telegram-cache / offline-pack）：`tool-page` + `UiMenuHorizontal` + `KeepAlive` 包裹的 `<component :is>`，子视图由路由驱动；需要品牌图标时给 `items` 传 `icon`。
  - 顶栏 + 内容（treease / wxp）：`UiToolbar` 顶栏 + 下方内容（wxp 的内容全宽铺满，见上方全宽变体）。
  - 居中卡片（id-card-generator）：`tool-page` 内居中一张卡片（720），不铺栏。

### 7.4 面板与详情

- 面板内部节奏固定：标题→内容 16（`UiPanel` 自带 header 下边距 + 分隔线）、行与行 8；
  面板自身的内边距 16。**不要**在面板里再用 24 / 32 分隔同级内容——那是区块层的事（§3.3.1）。
- 详情用 `UiDetailGrid` + `UiDetailItem`（label + value 卡片，≤760px 单列）。
- 键值清单用 `UiKeyValue`（顶部分隔线式）。
- 分区用 `UiPanel variant="outlined"`（描边分区块）。

### 7.5 表格

- 统一用 `UiTable`（内部 `el-table size="small"`，几何由全局绑定：表头 / 行 hover 取 `--color-fill`、行底取 `--color-table`、容器 `radius-lg`、表体 12px、单元格行高 `--line-height-control`）。
- 列定义仍写 `el-table-column`；整表等宽传 `mono`（ID / 摘要 / 字节列），行可点击传 `rowClickable`，空态用 `emptyText`（内部渲染 `UiEmpty`）。
- 数字列用 `.mono`，时间列用 `.muted`，状态列用 `UiChip`（`variant="soft"`）。

## 8. 交互与动效

- **入场动画**：应用外壳顶栏下滑淡入；工具页侧栏左滑、状态面板右淡入（gsap）。
- **路由过渡**：`.page-*` 类实现淡入淡出 + 轻微位移。
- **卡片 hover 抬高**：列表卡 / 工具卡 hover 抬描边或浅底；标题栏设置入口 hover 铺 `--color-fill` 浅底。
- **prefers-reduced-motion**：全局降级（动画时长压缩到 0.01ms），已在 `main.scss` 处理。

## 9. 无障碍

- 图标按钮提供 `aria-label` / `title`。
- 键盘焦点统一 `--shadow-focus` 焦点环。
- 交互元素可键盘触发（列表卡支持 Enter / Space）。
- 文本对比遵循主/次级/三级分层：**文字只用墨档与中性文本令牌**，
  正文/小字 ≥ 4.5:1、`≥18.66px` 或粗体大字 ≥ 3:1、图形与图标线 ≥ 3:1。
- 改颜色后按「白底 + `--color-fill` 灰调底 + 自身 10% 浅底」三处验算，
  并在真实渲染的 DOM 上量（`getComputedStyle` + 混合透明度后的实际底色），不要只看色值。
- 状态不靠颜色单独表达：`UiStatusTag` 永远与文字标签同行，`UiChip` 带文字，拖拽态仍有虚线边框与缩放。
- **强调不只靠字重**：`<strong>` 同时抬色阶（正文说明是次级灰 → 主文本黑），
  这样只有 Regular/Medium 拉丁面的环境下，加粗不生效时仍读得出强调（§3.2.3）。
- **可缩放**：字号全部是 px 令牌，Chromium 缩放（Ctrl +/-）按比例放大，不写 `user-scalable=no`。

---

*本文档随 UI 演进维护；令牌与组件变更需同步本文件与 [AGENTS.md](./AGENTS.md)。*
