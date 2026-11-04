---
name: everydaytool
description: A desktop command deck for focused, local-first everyday tools.
colors:
  brand-blue: "#3390ec"
  brand-blue-strong: "#006dc3"
  launcher-canvas: "#edf3f8"
  glass-surface: "#fbfdff"
  ink: "#0b1724"
  ink-secondary: "#526273"
  ink-tertiary: "#5f6f80"
  border-light: "#dfe8ef"
  border: "#cbd8e3"
  success: "#007b54"
  warning: "#975f00"
  error: "#cf1c28"
  night-surface: "#121d29"
  night-ink: "#eef4fb"
typography:
  launcher-title:
    fontFamily: "Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "25px"
    fontWeight: 500
    lineHeight: 1.18
    letterSpacing: "-0.03em"
  page-title:
    fontFamily: "Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: "Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  xs: "7px"
  sm: "10px"
  control: "11px"
  md: "12px"
  lg: "16px"
  xl: "22px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  "2xl": "24px"
  "3xl": "32px"
components:
  app-rail:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    width: "68px"
  launcher-surface:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "7px"
  primary-action:
    backgroundColor: "{colors.brand-blue-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 13px"
  tool-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "78px"
    padding: "4px 6px"
  workspace-surface:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
---

# everydaytool UI 设计文档

> 本文件是 everydaytool（`edt`）当前及下一版 UI 的唯一视觉权威。它以 **Command Deck（工具指挥台）** 为设计世界，替换“卡片仪表盘 + 多面板堆叠”的旧首页与工具页观感。实现令牌位于 [`renderer/shared/styles/`](renderer/shared/styles/)，平台组件位于 [`renderer/shared/components/ui/`](renderer/shared/components/ui/)，可交互视觉预览位于 [`docs/redesign-preview.html`](docs/redesign-preview.html)，机器可读侧车位于 [`.impeccable/design.json`](.impeccable/design.json)，逐阶段落地清单位于 [`docs/redesign-implementation-plan.md`](docs/redesign-implementation-plan.md)。
>
> 迁移要求：**先令牌与外壳，再首页，再工具页**。不得跳过基础组件直接给单页堆局部样式。新增页面先复用 §4，再读 §8 选择工作区骨架。

## 1. 设计方向与非协商项

### 1.1 Creative North Star：Command Deck

everydaytool 不是监控台，也不是把每个工具变成一页“状态卡”的后台系统。它是一个**常驻桌面的工具指挥台**：左侧窄轨提供随时可达的工具入口；中央只承载当前任务；工具打开才加载，关闭即释放；所有辅助信息在需要时出现，不长期占版面。

**一句话**：一条导航轨、一个搜索入口、一个当前工作区。

视觉气质是“冷雾玻璃上的蓝色信号”：透明表面负责空间层次，细线负责结构，品牌蓝只负责动作、选中与焦点。装饰不制造层级，层级由位置、留白、字号和透明度完成。

**Key Characteristics**

- 工具优先，状态次之；首页不出现运行状态、版本号、分类徽章与说明面板。
- 单工具、单运行时；切走或关闭时组件卸载，停止轮询、webview guest 与工具级后端会话。
- 左侧 68px 导航轨 + 顶部 48px 工作区栏 + 单一 16px 主工作区表面。
- 冷白玻璃、淡蓝环境光、1px 半透明边线；无重阴影堆积，无多层卡片嵌套。
- 品牌蓝 `#3390ec` / 墨蓝 `#006dc3` 是唯一强调色；语义色只用于状态。
- 沿用现有 Roboto / Nunito / Cascadia Mono 字体体系与全部 `Ui*` 基础组件。

### 1.2 明确反例

- 不做首页工具统计看板、欢迎标语墙、运行状态总览、版本徽章矩阵。
- 不做“卡片里再放面板、面板里再放卡片”的嵌套表面。
- 不把设置、诊断、帮助、版本和路径默认铺在工具首屏。
- 不给每个工具分配独立品牌色；工具差异由图标、名称与内容表达。
- 不用紫色、渐变文字、彩色左边条、发光边框或无意义的玻璃装饰。
- 不保留“切到后台但页面仍挂载”的多工具常驻模型。

### 1.3 成功判据

1. 用户从任意位置最多两步打开任一工具：左轨点击一次，或 `Ctrl/Cmd + K` 后回车。
2. 首页首屏能在 3 秒内读完 8 个工具及其用途；无滚动才能读完的信息不属于首页。
3. 工具首屏 70% 以上面积用于当前任务内容，而不是状态卡与说明。
4. 关闭工具后，DOM、轮询、IPC 订阅、webview 与工具级后台任务均被释放；需要保护的任务在关闭前统一确认。
5. 半透明在 acrylic / mica / tabbed / vibrancy / transparent-only 与夜色玻璃下均保持文字可读。

## 2. 主题与色彩

### 2.1 浅色默认主题

| 角色 | 值 | 用途 |
| --- | --- | --- |
| 品牌蓝（图形） | `#3390ec` | 焦点环、选中轨、图标、进度、浅底来源 |
| 品牌墨蓝（文字 / 实底） | `#006dc3` | 链接、主按钮、选中文字、可读图标 |
| 品牌浅底 | `color-mix(in srgb, #3390ec 10%, transparent)` | 选中行、当前页签、rail 激活态 |
| 玻璃表面基准 | `#fbfdff` | 主工作区、launcher、浮层 |
| 冷雾画布 | `#edf3f8` | 不支持透明时的兜底；真实画布仍透明 |
| 主文本 | `#0b1724` | 标题、正文、表格主值 |
| 次级文本 | `#526273` | 描述、辅助行、表单标签 |
| 三级文本 | `#5f6f80` | 元信息、时间戳、占位符 |
| 细边线 | `#dfe8ef` | 表面边线、分隔线 |
| 输入边线 | `#cbd8e3` | 输入框、可交互控件 |
| 成功 | `#007b54` | 完成、健康、在线 |
| 警告 | `#975f00` | 待处理、风险、置顶星 |
| 错误 | `#cf1c28` | 失败、危险动作 |
| 实底前景 | `#ffffff` | 主按钮与实底徽章上的文字 |

**颜色分档规则**

- **图形档** `--color-primary` 只用于圆点、焦点、描边、图标线、进度和浅底；不得用作 11–14px 小字。
- **墨档** `--color-primary-strong` 才可用于文字、图标与承载白字的实底。
- 选中态使用 **品牌浅底 + 中性深色文字**，不使用高饱和大面积蓝底。
- 语义色只有一档，同时满足文字、图标、实底与自身 10% 浅底上的可读性。
- 三级文本在玻璃表面上的实际对比必须 ≥ 4.5:1；`#5f6f80` 是下限，不允许再调浅。

### 2.2 夜色玻璃

夜色玻璃是独立主题轴，与材质轴正交。开启后主进程同步 `nativeTheme.themeSource = 'dark'`；只覆写颜色与前景，不改变透明 alpha 与模糊半径。

| 角色 | 夜色值 |
| --- | --- |
| 画布兜底 | `#0d1017` |
| rail / surface 基准 | `#111c28` |
| header / pop 基准 | `#0e1721` |
| fill 基准 | `#172330` |
| 控件基准 | `#1a2837` |
| 主文本 | `#eef4fb` |
| 次级文本 | `#aab9c8` |
| 三级文本 | `#75879a` |
| 细边线 | `#253647` |
| 输入边线 | `#30465b` |
| 品牌图形蓝 | `#67a9ff` |
| 品牌文字蓝 | `#a9ccff` |

**禁止**：夜色模式使用纯黑 `#000` 作为文字、纯白作为大面积底、或把语义色直接反相。

### 2.3 品牌蓝使用边界

**The One Signal Rule.** 一个界面里只有品牌蓝承担“动作 / 当前 / 焦点”，其余强调交给字号、间距和中性色阶。品牌蓝覆盖面积目标 ≤ 画面 8%。

**The Neutral Label Rule.** 除链接、主按钮与图标外，页签、行选中和 rail 激活态的文字保持中性主文本色，避免亮蓝小字对比不足。

## 3. 设计令牌

### 3.1 颜色与透明表面

以下为 `renderer/shared/styles/tokens.scss` 的目标值。旧变量名尽量保留，新增 `rail` 角色。

```scss
:root {
  --color-primary: #3390ec;
  --color-primary-strong: #006dc3;
  --color-primary-soft: color-mix(in srgb, var(--color-primary) 10%, transparent);
  --color-primary-light: color-mix(in srgb, var(--color-primary) 20%, transparent);

  --color-success: #007b54;
  --color-warning: #975f00;
  --color-error: #cf1c28;
  --color-on-solid: #ffffff;

  --color-app-bg: #edf3f8;
  --color-text-primary: #0b1724;
  --color-text-secondary: #526273;
  --color-text-tertiary: #5f6f80;
  --color-border-light: #dfe8ef;
  --color-border: #cbd8e3;

  --color-rail-base: #f7fbff;
  --color-raised-base: #fbfdff;
  --color-input-base: #ffffff;
  --color-field-base: #ffffff;
  --color-table-base: #fbfdff;
  --color-button-base: #ffffff;
  --color-fill-base: #edf3f8;
  --color-header-base: #f9fcff;
  --color-pop-base: #fbfdff;
  --color-overlay-base: #fbfdff;
}
```

**表面角色**

| 角色 | 用途 | 变量 |
| --- | --- | --- |
| `rail` | 左侧导航轨 | `--color-rail`、`--alpha-rail`、`--glass-rail` |
| `header` | 顶部工作区栏 | `--color-header`、`--alpha-header`、`--glass-header` |
| `raised` | 主工作区、launcher、抽屉 | `--color-raised`、`--alpha-raised`、`--glass-raised` |
| `input` | 浮在画布上的搜索框 / 导航控件 | `--color-input`、`--alpha-input`、`--glass-input` |
| `field` | 表面内的输入框 | `--color-field`、`--alpha-field` |
| `table` | 表格行底 | `--color-table`、`--alpha-table` |
| `button` | 普通玻璃按钮 | `--color-button`、`--alpha-button` |
| `fill` | 表头、hover 行、分段控件槽 | `--color-fill`、`--alpha-fill` |
| `pop` | 下拉、菜单、命令面板候选层 | `--color-pop`、`--alpha-pop`、`--glass-pop` |
| `overlay` | dialog / toast / 模态 | `--color-overlay`、`--alpha-overlay`、`--glass-overlay` |
| `canvas` | 页面画布 | 恒 `transparent` |

**不透明默认模式**

所有 alpha = `1`，所有 glass = `none`。不透明窗口不产生 `backdrop-filter` 合成开销。

**acrylic 模式**

| rail | raised | input | field | table | button | fill | header | pop | overlay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .62 | .78 | .88 | .30 | .88 | .88 | .80 | .60 | .94 | .92 |

对应玻璃：

| 角色 | 值 |
| --- | --- |
| rail | `blur(20px) saturate(135%)` |
| raised | `blur(18px) saturate(135%)` |
| input | `blur(14px) saturate(135%)` |
| header | `blur(16px) saturate(135%)` |
| pop | `blur(24px) saturate(135%)` |
| overlay | `blur(28px) saturate(135%)` |

**mica / tabbed / vibrancy / transparent-only**

| 模式 | rail | raised | header | rail glass | raised glass |
| --- | --- | --- | --- | --- | --- |
| mica | .95 | .96 | .96 | 10px | 10px |
| tabbed | .97 | .98 | .98 | 8px | 8px |
| vibrancy | .95 | .96 | .96 | 12px | 12px |
| transparent-only | .86 | .88 | .88 | 20px | 20px |

其余角色继续沿用现行 `translucency.scss` 的 mica / tabbed / vibrancy / transparent-only 数值。新增 `rail` 时必须同时更新 `tokens.scss`、`translucency.scss` 的模式覆写、夜色重算与 `prefers-reduced-transparency` 降级。

**The Glass Boundary Rule.** 玻璃只做“表面 ↔ 背景”一层。`field`、`table`、`button`、`fill` 永不加 `backdrop-filter`；抽屉压工作区时用 `overlay`，不要玻璃叠玻璃。

**The Content Is Opaque Rule.** 文字、图标、状态点、进度条和滑块始终不透明。透明只属于大面积表面。

### 3.2 字体与字阶

**字体**

- 拉丁正文与 UI：`Roboto` 400 / 500（自托管）。
- 中文正文：`PingFang SC` / `Microsoft YaHei`。
- 品牌标与字母头像：`Nunito` ExtraBold 800。
- 数字、ID、路径、代码、快捷键：`Cascadia Mono` / `Roboto Mono` / `SF Mono` / `Menlo` / `Consolas`。

**字阶**

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--font-size-xs` | 11px | 元信息、表头、徽章、快捷键 |
| `--font-size-sm` | 12px | 工具描述、辅助正文、表格正文、次级按钮 |
| `--font-size-base` | 14px | 正文、控件、工具名、行主文本 |
| `--font-size-lg` | 16px | 分区标题、状态名 |
| `--font-size-xl` | 18px | 文档页标题、独立编辑器标题 |
| `--font-size-display` | 25px | 仅首页“工具台”标题；不进入工具页 |

**字重**

- 400：正文、表格、说明。
- 500：标题、按钮、标签、页签、强调。全站唯一常规强调档。
- 700：正文 `<strong>` 与数字看板；不用于 UI 标题。
- 800：仅 Nunito 品牌标与字母头像。

**行高**

- 单行控件 / 表格：`20px`。
- 正文与说明：`1.5`。
- 长文：`1.6`。
- 首页标题：`1.18`。

**The No Micro Type Rule.** 生产界面不得使用 9–10px 文本；最小字号为 11px。表头、状态行、快捷键也必须遵守。

**The One Display Size Rule.** 25px 只属于首页标题；工具页标题 17px，分区标题 16px，不靠继续放大字号建立层级。

### 3.3 间距与节奏

基础间距保持：`4 / 8 / 12 / 16 / 20 / 24 / 32`。

| 结构常数 | 值 |
| --- | --- |
| rail 宽 | 68px |
| topbar 高 | 48px |
| rail 控件 | 42 × 42px |
| 首页左右内边距 | 42px |
| 首页内容最大宽 | 1160px |
| 搜索坞高 | 54px |
| launcher 行高 | 78px |
| 工具页左右内边距 | 18px |
| 工具页 header 高 | 70px |
| surface toolbar 高 | 48px |
| statusline 高 | 31px |
| 表单工作区左栏 | 360px |
| 处理型 inspector | 268px |

**节奏**

- 同一组：`8–12px`。
- 标题到内容：`12–16px`。
- 同级区块：`20–24px`。
- 页面边缘：`18–42px`，按区域宽度决定，不用相同值机械铺满。
- 标题上方空间必须大于标题与内容之间空间。

### 3.4 圆角、边线与深度

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--radius-xs` | 7px | 小图标钮、键帽 |
| `--radius-sm` | 10px | 页签、次级按钮、分段钮 |
| `--radius-control` | 11px | 主 / 次按钮、搜索输入 |
| `--radius-md` | 12px | 工具行、rail 激活、列表卡 |
| `--radius-lg` | 16px | launcher、主工作区、抽屉 |
| `--radius-xl` | 22px | 命令面板、dialog |

边线：

- 玻璃表面外缘：`1px solid rgba(255,255,255,.58)`。
- 内部结构线：`1px solid var(--color-border-light)`。
- 禁止在同一个表面同时使用“实色边框 + 大阴影”形成 ghost card；玻璃边缘高光不算第二层 elevation。

阴影：

```scss
--shadow-sm: 0 10px 34px rgba(27, 57, 87, 0.10);
--shadow-md: 0 18px 48px rgba(29, 62, 94, 0.10);
--shadow-lg: 0 24px 70px rgba(22, 50, 78, 0.16);
--shadow-focus: 0 0 0 1px var(--color-on-solid), 0 0 0 3px var(--color-primary-strong);
--shadow-window-frame: 0 12px 48px rgba(0, 0, 0, 0.28);
```

静止的主工作区只使用 `--shadow-sm` 或仅边线；只有浮层使用 `--shadow-md/lg`。hover 不靠大幅位移，最多 `translateY(-1px)`。

### 3.5 动效

```scss
--duration-fast: 140ms;
--duration-base: 190ms;
--duration-overlay: 220ms;
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
```

- 视图切换：透明度 + `translateY(4px)`，190ms。
- 命令面板：透明度 + 上移 8px + `scale(.985)`，220ms。
- hover：背景 / 边线 / 文字颜色，140ms。
- rail 激活条：150ms 的 `scaleY` 或高度过渡。
- 页面进入时不编排多段动画；工具是工作界面，不是品牌宣传页。
- 尊重 `prefers-reduced-motion`，全部降为 0.01ms。

## 4. 组件内核

### 4.1 复用优先

| 需求 | 使用 |
| --- | --- |
| 按钮 | `UiButton`、`UiIconButton` |
| 搜索 | `UiSearchInput` |
| 分段 / 页内切换 | `UiMenuHorizontal`；少量选项可用 `UiRadioGroup` + `UiRadio` |
| 表格 | `UiTable`、`UiTableColumn` |
| 状态 | `UiStatusTag`、`UiChip`；只在工具内使用 |
| 表单 | `UiFormField`、`UiInput`、`UiSelect`、`UiSwitchField`、`UiPathField`、`UiSlider` |
| 进度 | `UiProgress` |
| 空态 | `UiEmpty` |
| 提示 | `UiHint`、`UiAlert` |
| 弹层 | `UiDialog`、Reka UI Popover / Dropdown |
| 悬停提示 | `UiTooltip`（Reka UI，portal 到 body；overflow 容器内必须用它，不能用伪元素）。视觉样式必须挂在本模板的内层元素上——Teleport 出去的内容拿不到父组件 scopeId，写在 `TooltipContent` 上的 scoped class 不生效 |
| 详情 | `UiDetailGrid`、`UiDetailItem`、`UiKeyValue` |
| 反馈 | `renderer/shared/feedback/`、`vue-sonner` |
| 图标底板 | `UiIconTile`；`sm` 31px / `md` 38px / `lg` 40px |

### 4.2 新增的“组合型”组件

这些组件只负责布局与交互编排，不复制 `Ui*` 的视觉内核：

| 组件 | 职责 | 约束 |
| --- | --- | --- |
| `AppRail.vue` | 68px 左侧导航；首页、置顶工具、已打开工具、搜索、设置 | 不读工具业务状态；置顶 id 来自 `UiPreferences`，已打开列表来自 `toolTabs` store |
| `CommandPalette.vue` | `Ctrl/Cmd+K` 工具检索与打开 | 只读工具注册表；键盘完整；无状态面板 |
| `WorkspaceHeader.vue` | 工具图标、名称、单行状态、主操作、更多 | 状态只显示一行；不承载配置表单 |
| `ToolSurface.vue` | 主工作区玻璃表面、toolbar、body、statusline 槽位 | 不嵌套第二个 `ToolSurface`；内部不再套 `UiPanel` |
| `LauncherRow.vue` | 首页工具入口行 | 图标 / 名称 / 最多两行描述 / 置顶 / 箭头；打开与置顶是两个并列按钮 |
| `ToolSideInspector.vue` | 右侧可收起检查器 | 与主内容同表面分隔；宽度 268 / 320 / 360 |

### 4.3 按钮

- **主按钮**：高 32px，圆角 11px，墨蓝实底，白字；仅用于当前工具的主要前进动作（启动代理、启动 WXP、生成、下载）。
- **次按钮**：玻璃底 `var(--color-button)`，边线 `var(--color-border)`；用于重置、外部打开、暂停。
- **图标按钮**：28px 点击区，圆角 8px；hover 为白色 48% 或 `--color-fill`。
- **危险按钮**：只在确会发生删除 / 停止的操作中使用实底红或红字；不要用红色装饰。
- 焦点：统一 `--shadow-focus`。禁用：降低文字与图标对比，不给容器写 `opacity`。

### 4.4 输入与表单

- 高 32px，圆角 9–11px，玻璃底，1px 中性边线。
- 标签 11px / 500 / 次级文本色；输入正文 12px / 主文本色。
- focus：品牌蓝 1px 边线 + 3px 9% 外环；不发光。
- 错误：错误色边线 + 同组错误文案，不只靠颜色。
- 表单工作区不把每个字段放进小卡片；字段直接排在左栏。

### 4.5 表格

- 表格只放在主工作区表面内，容器的圆角由 `ToolSurface` 提供，内部不再套一层圆角卡片。
- 表头 11px / 500 / 中性三级；表体 12px；行高 39–44px。
- 表头底 `--color-fill`；行 hover 白色 36%；选中行品牌蓝 7.5%。
- 数字、ID、URL、状态码使用 `.mono`；数字列右对齐或按扫描需要对齐。
- 表格空态用 `UiEmpty`，文案必须说明下一步。

### 4.6 状态与徽章

- `UiStatusTag` 只出现在工具 header 或状态行，不能出现在首页工具入口。
- 状态必须“点 + 文字”同时出现，不能只靠颜色。
- `UiChip` 用于计数、筛选、轻量标签；不得承载价格、版本等首页元信息。
- 全局同一时刻只允许一个 live 脉冲点；没有真实任务时不脉冲。

### 4.7 浮层

- 命令面板 `CommandPalette`：宽 `min(650px, calc(100vw - 48px))`，圆角 22px，`--color-overlay` + `--glass-overlay`，上方 13vh。
- 下拉用 Reka / `UiSelect`，必须 teleport；不得被父级 `overflow:hidden` 裁剪。**Reka 的 `SelectContent` 会被传送到 `body`，其表面 / viewport 样式必须使用 `:global(.ui-select-content)` / `:global(.ui-select-viewport)`，否则 scoped 样式不会命中，浮层会退化为透明裸列表。**
- 下拉表面：`pop` 表面 + `--glass-pop`，圆角 16px，5px 内边距，阴影 `--shadow-md`；宽度取 `max(触发器宽, 220px)` 并封顶 360px / 可用宽度，最大高度 320px。
- 选项：最小高度 34px，圆角 7px，字号 12px；hover / 键盘高亮用 `--color-fill`，选中用品牌 10% 浅底 + 中性主文本 + 左侧 13px 勾选图标。选项获得键盘焦点时不再叠加按钮式 `--shadow-focus` 外环，避免出现第二个输入框轮廓。
- 设置抽屉宽 360–420px；展示为右侧 inspector，避免把所有配置堆进主区域。
- 关闭 dialog 后必须销毁内部状态（`destroyOnClose`），除非该工具仍处于打开状态且用户正在编辑草稿。

## 5. 应用外壳

### 5.1 结构

```text
┌──────────────────────────────────────────────────────────┐
│ 48px Titlebar（整宽：mac 红绿灯在左，Win/Linux 按钮在右） │
├───────────┬──────────────────────────────────────────────┤
│ 68px Rail │ [icon] 名称  一行说明                        │
│  home     ├──────────────────────────────────────────────┤
│  pinned   │                                              │
│  opened   │                Active workspace              │
│  tools    │                                              │
│  search   │                                              │
│  settings │                                              │
└───────────┴──────────────────────────────────────────────┘
```

### 5.2 左侧导航轨

- 宽 68px，整列玻璃，右缘 1px 分隔线 + 内侧 1px 白色高光（两者画在 rail 的伪元素上）；不铺纯白实底。
- 自上而下：**首页 → 置顶工具 → 已打开的非置顶工具 →（底部固定）搜索工具 / 设置**。首页下方 1px 分隔线。
- 置顶工具 = **常驻启动器**（Dock 语义）：用户可在首页星标，最多 4 个；关闭只停止运行，图标留在原位、位置不因开关而移动；顺序跟随首页收藏顺序。
- 已打开的非置顶工具：打开时按打开顺序追加到置顶段之后；关闭即从列表移除。
- 同一个工具只出现一次，永远取置顶那一位（置顶 + 已打开不重复）。
- 图标钮 42×42，激活态品牌 10% 浅底 + 蓝色图标 + 左侧 3×18px 指示条。
- **运行中标识**：已打开但未激活 → 图标右下角 4px 品牌色圆点；激活态已有浅底 + 指示条，不再重复标记。该圆点位置专用于「运行中」，短任务提示不得复用它。
- **关闭钮**：15px 圆形，位于图标右上角，hover / 键盘聚焦才显现。置顶项的 tooltip / `aria-label` 写“关闭 X（保留置顶）”，非置顶项写“关闭 X”。关闭钮必须是图标按钮的**兄弟节点**——HTML 不允许按钮嵌套按钮。
- 运行列表区独立滚动（`overflow-y: auto`，隐藏滚动条）：工具多到一列放不下时只滚这一段，首页与底部两个入口始终可见。
- tooltip 悬停 180ms 后显示名称，深色玻璃、不阻挡指针。运行列表是 overflow 容器，伪元素提示会被裁掉，**必须用 `UiTooltip`（portal 到 body）**，不得回到 `::after` 方案。
- 图标必须来自统一 SVG 图标集，线宽 1.6–1.8px；不得用 emoji 或临时文字代替。
- 所有控件 `-webkit-app-region: no-drag`；rail 空白区域可拖动窗口。
- **rail 从标题栏下沿开始**，不再用顶部 padding 给红绿灯让位：macOS 红绿灯由**整宽标题栏**承载（`electron/main.ts` 的 `trafficLightPosition`，y=18 让 12px 灯组在 48px 栏内居中），标题栏内容左内边距 84px（`.platform-darwin .app-topbar`，见 §5.3）。给 rail 加 `padding-top` 会重新把红绿灯压在 rail 右缘上——分隔线会从灯中间穿过。

### 5.3 标题栏（整宽顶栏）

- 高 48px，玻璃 header；整行可拖拽。**不含页签**：工具切换由左轨图标与 `Ctrl/Cmd + K` 命令面板承担。
- 内容只有一块「当前页面上下文」：图标块 + 名称 + 一行说明，三者水平排列。
  - 首页：`EDT` 字标（31×31 品牌浅底，Nunito 800、11px、0.04em 字距）+ `everydaytool` + “本地工具工作区”。
  - 工具页：工具 icon（`UiIconTile` sm）+ 工具名 + `ToolDefinition.description`。
  - 应用自带页面（设置）：icon + 页面名 + 一句话职责（`AppTab.description`）。
- 名称 14px / 500，说明 11px 三级文本色；图标与名称不收缩，说明是唯一可压缩项（单行省略号）。
- 整个上下文块不可点击（首页入口在左轨），从而保证整行都是窗口拖拽区；**不要**把标题栏做成可点回首页的按钮。
- 不显示“打开工具 / Ctrl K”按钮，也不显示页签溢出、拖拽排序等任何页签附属物。
- **标题栏铺满整宽**（不是只覆盖 rail 右侧的工作区）：下面才是「左轨 + 内容」这一行。
- Windows / Linux 右侧为原生窗口按钮预留 148px；macOS 红绿灯直接落在标题栏左侧，标题栏内容左内边距 84px（灯组右缘约 72px + 12px 间距），其余平台 16px；macOS 全屏隐藏红绿灯时回到 16px。

### 5.4 工具生命周期（硬约束）

这是本次改版的产品行为核心，不只是视觉：

1. **只有当前活动页挂载组件。** `App.vue` 只渲染当前路由对应的工具 / 应用页组件；切换工具时旧组件卸载、新组件挂载。
2. **首页不挂载任何工具运行时。** 回到 `/` 时卸载当前工具；不能为了“返回更快”保留隐藏 webview / store 轮询。
3. **关闭工具 = 销毁。** 关闭（左轨 ✕）后组件根节点、webview guest、IPC 订阅、定时器与工具级后端会话全部释放；现有 `onUnmounted` / `dispose` 必须逐一核对。
4. **打开 ≠ 预热。** 会话恢复时可以恢复左轨里的已打开列表，但不实例化组件；用户点击图标后才加载。
5. **后台任务必须显式。** 若某工具关闭后仍需继续下载 / 服务，必须在关闭前明确询问；默认策略是“停止并释放”。WorkBuddy2API 关闭时停止服务，WXP 关闭时停止其托管的 CDP 会话。
6. **草稿可以保留数据，不可以保留运行时。** 草稿写入 JSON store；重新打开时恢复数据，但组件、轮询和子进程从头初始化。
7. **子视图 KeepAlive 仅限工具内部。** `UiMenuHorizontal` 的子视图在工具仍打开时可以 KeepAlive；切走活动工具时整棵子树必须卸载。

推荐实现：保留 `useToolTabsStore` 的已打开列表持久化，但 `App.vue` 始终只挂载当前页：

```vue
<Transition name="workspace" mode="out-in">
  <component
    :is="pageComponents[currentTabId]"
    v-if="currentTabId"
    :key="currentTabId"
  />
</Transition>
```

并用 `onBeforeUnmount` / `onUnmounted` 统一清理工具资源。`KeepAlive` 不得包住跨工具容器。

## 6. 首页 / 工具启动台

### 6.1 版面

- 页面左右内边距 42px，顶部 34px；内容最大宽 1160px，居中。
- 标题“工具台”25px / 500 / -0.03em；下一行 12px 说明使用真实工具数：“8 个本地工具；打开时运行，关闭即释放”。
- 不在标题右侧重复工具数量或 `LOCAL-FIRST` 元信息；标题栏只承载当前页面语境（图标 + 名称 + 说明，见 §5.3）。
- 搜索坞高 54px；下方 22px 为工具列表。
- `launcher` 是**一个**玻璃表面：圆角 16px、内边距 7px、顶栏 44px；内部工具行两列排列。

### 6.2 搜索坞

- 高 54px，圆角 16px，玻璃表面，左内边距 17px。
- 左：搜索图标 18px，三级文本色。
- 中：输入框 14px；占位“搜索工具、能力或关键词”。
- 右：`快速打开` 11px + `Ctrl K` 键帽。
- 聚焦时边线变品牌蓝 38%，外环品牌蓝 12%；不使用发光。
- 点击、聚焦或 `Ctrl/Cmd+K` 都打开 `CommandPalette`，输入内容同步到命令面板。

### 6.3 工具行

每行展示**只展示完成任务所需的信息**：

1. 38×38 图标底，圆角 11px，品牌 10–24% 浅底，蓝色 SVG 图标。
2. 工具名 14px / 500 / 主文本。
3. 12px 描述最多两行，超出省略；两列布局下优先展示完整用途，而不是截成同一句前缀。
4. 右侧置顶按钮与进入箭头；置顶按钮默认 58% 可见，行 hover 100%。
5. 不展示版本号、分类、创建时间、“新”徽章、运行状态、路径或进程信息。

行高 78px，圆角 12px，间距 4/8px；hover 白色 46%，上移 1px；不出现卡片描边堆叠。

### 6.4 置顶与排序

- 收藏语义改为“置顶”：星标工具排到列表前部，并最多取前 4 个显示在左侧 rail。
- 置顶操作即时写入 `UiPreferences.favoriteToolIds`；LocalStorage 仍只做镜像。
- 保留拖拽排序与 `tool-order.ts` 的纯函数；拖拽时使用当前行样式，不新增独立拖拽卡片。
- “恢复默认排序”放在 launcher 顶栏右侧，使用 28px 图标按钮，仅在存在自定义顺序时出现。

### 6.5 空态

- 搜索无结果：在 launcher 内显示 `UiEmpty`，文案“没有匹配的工具”，副文案“试试工具名、能力或关键词”。
- 工具注册为空：显示“还没有可用工具”，提供“打开设置 / 检查安装”的次按钮。
- 加载：3 条 78px 骨架行，保持两列布局；不使用中央 spinner。

## 7. 命令面板

- 入口：`Ctrl/Cmd + K`、rail 搜索按钮、首页搜索坞。
- 宽 `min(650px, calc(100vw - 48px))`，位置距顶 13vh。
- 遮罩：`rgba(23,42,61,.16)` + `blur(8px)`；面板使用 `overlay` 表面。
- 搜索框高 59px，15px 正文；右端 `Esc` 键帽。
- 默认展示全部可用工具（当前 8 条，上限 8 条）；每条最小 58px，图标 31px，名称 12px，描述 11px 且最多两行。
- 结果区最大高度随视口收敛并在内部滚动；键盘移动时当前项保持在可视区内。
- 分组标签只有“所有工具”；不按分类切分，不展示运行状态。
- 键位：`↑/↓` 移动，`Enter` 打开，`Esc` 关闭；点击遮罩关闭。
- 打开后焦点自动进入输入；关闭后焦点回到触发元素。
- 结果匹配名称、描述、关键词与分类 key；排序优先级：名称前缀 > 名称包含 > 关键词 > 描述。
- 关闭面板不改变当前工具；选择结果才触发路由与组件挂载。

## 8. 工具页

### 8.1 四种工作区骨架

| 骨架 | 判据 | 结构 | 工具 |
| --- | --- | --- | --- |
| 流式工作台 | 持续扫读表格 / 流量 | header + 子视图导航 + 单一大表格表面 | 拦截器 |
| 内嵌工作区 | 主体是 webview / 浏览器页面 | header + 浏览器工具条 + 全幅 webview + 可收起 inspector | Telegram 网络优化、tweb、Treease、WorkBuddy2API |
| 表单工作室 | 左侧参数，右侧结果 | header + 左 360px 表单 / 右侧结果表 | 身份证号生成器 |
| 处理控制台 | 启动 / 下载 / 同步 + 检查结果 | header + 左 268px inspector + 主任务表面 | WXP 增强、离线包下载 |

### 8.2 工具页 header

- 高 70px，无 `UiPanel` 包裹。
- 左：40×40 工具图标、17px 标题、12px 一句用途；状态以 10–11px 内联显示在标题旁，仅一行。
- 右：最多一个主按钮 + 一个次按钮 + 一个“更多”；不显示版本、数据路径或帮助长文。
- 工具详情 header 右上角不出现“打开工具 / Ctrl K”框；避免与全局命令面板、左轨搜索形成三入口重复。
- 主按钮只对应工具的主要动作：启动、生成、下载、打开等。
- 状态卡、说明卡和安装卡不得进入 header。

### 8.3 子视图导航

- 使用 `UiMenuHorizontal` 或等价 30px 分段按钮。
- 激活态：品牌蓝 9% 浅底 + 17% 边线 + 主文本。
- 路由驱动，保留深链与前进后退；不要用仅本地 ref。
- 子视图内的 KeepAlive 可保留草稿与筛选，但跨工具不得常驻。

### 8.4 主工作区表面

- 一个工具只有一个主 `ToolSurface`，圆角 16px，玻璃 raised。
- 顶部 `surface-toolbar` 高 48px：搜索、筛选、次要动作；底部 `statusline` 高 31px：记录数 / 进程 / 路径等低频信息。
- 表格、webview、表单结果都直接占用表面；不额外套 `UiPanel`。
- 详细设置、安装、说明、错误日志进入右侧 inspector 或按需抽屉。
- 背景透明，工具页不得再铺整页 `--color-app-bg`；画布统一透明。

## 9. 每个工具的落地方案

| 工具 | 骨架 | 首屏必须突出 | 必须移出首屏 | 交互与状态 |
| --- | --- | --- | --- | --- |
| 拦截器 | 流式工作台 | 启动 / 停止、当前流量表、规则命中 | 设置说明、CA 证书长文、诊断卡 | 状态改为 header 内联一行；4 个子路由不变；规则编辑器用右侧抽屉；表格始终占满剩余高度 |
| Telegram 网络优化 | 内嵌工作区 | Telegram webview、页面导航、影库入口 | 概览三卡、站点详情、缓存说明 | 主区域 webview 全幅；右侧 inspector 默认收起；任务 / 影库 / 诊断按需展开 |
| Telegram 缓存（tweb） | 内嵌工作区 | tweb 页面、影库入口、缓存操作 | 站点 / 归档 / 媒体缓存的概览卡 | 与 Telegram 同构；侧栏页签保留，但不再堆三张概览面板 |
| Treease 编辑器 | 内嵌工作区 | 全幅编辑器页面、拦截状态 | 拦截规则弹窗外的状态文案 | 顶栏只保留来源、状态 chip、设置、刷新；规则编辑继续用 dialog |
| 离线包下载 | 处理控制台 | 来源选择、下载参数、进度 | 大段说明、历史列表 | 左侧 5 个来源切换；主表面单一下载器；历史收进底部抽屉 |
| WXP 增强 | 处理控制台 | 启动 / 停止、路径与端口、缓存结果 | 三块并列面板、长说明 | header 内联状态；左 inspector 放启动设置；主区放缓存 / 收藏表 |
| WorkBuddy2API | 内嵌工作区 | 上游面板 webview、启动 / 停止 | 安装、更新、说明、错误四块并列 | header 单行状态与启停；右 inspector 分“运行 / 安装 / 诊断”三段；关闭工具停止服务 |
| 身份证号生成器 | 表单工作室 | 参数、生成动作与生成结果同时可见 | 外层面板、重复标题、说明卡、页面 header 操作 | 左 360px 表单；主按钮紧贴参数并显示“生成 N 条”；右结果表按内容收缩、最高 320px，超出时表内滚动；复制全部位于结果标题；生成后自动选中首行 |

### 9.1 身份证号生成器

**结构**

```text
WorkspaceHeader（仅图标 / 标题 / 一句用途）
└─ ToolSurface
   ├─ 左 config-pane（360px）
   │  ├─ 出生方式 → 年龄或出生日期 → 性别 → 地区 → 生成数量
   │  ├─ 1px 分隔线 + “生成 N 条”主按钮
   │  └─ 免责声明（贴左栏底部）
   └─ 右 result-pane
      ├─ 48px 结果标题：说明 + 结果数 chip + “复制全部”
      └─ UiTable（内容自适应，max-height 320px）
```

**参数列**

- 左栏固定 `360px`；宽度不足 `1180px` 时收至 `320px`。表单字段间距 `17px`，标签宽 `72px`，全部复用 `UiFormField` / `UiRadioGroup` / `UiSlider` / `UiSelect`。
- 字段顺序固定为出生方式、年龄范围或出生日期、性别、地区、生成数量。按年龄显示一个双滑块 slider，轨道上方两端分别显示当前“最小 / 最大”年龄值（如“18 岁 / 60 岁”）；数值行使用 11px 次级文本、tabular-nums，距轨道 5px。双滑块圆点为 16px，圆心必须与 6px 轨道中心线重合。按出生日期显示两个原生 date input，中间用“至”连接。
- 地区使用省 / 市 / 区三级 `UiSelect` 级联；未选省级时不显示市级，未选市级时不显示区级。每个 select 在左栏内独占一行，不并排压窄。
- 生成数量限制 `1–20`，右侧显示“最多 20 条”。主按钮文案实时显示 `生成 {{ count }} 条`，数量与动作必须处于同一视觉组。
- 主按钮在全宽参数列内占满一行，高 `32px`，使用 `UiButton type="primary"`。按钮上方是 `12px` 间距 + `12px` 内边距 + `1px` 分隔线；从数量输入框底部到按钮顶部保持约 `25px`，不得再放回页面 header。
- 免责声明使用 `UiHint size="xs"`，贴参数列底部；它不是主操作，不占用字段之间的节奏。

**结果列**

- 结果标题固定 `48px` 高。左侧为“生成结果 + 点击号码行即可复制”；右侧依次为结果数 `UiChip` 与 `UiButton size="small"` 的“复制全部”。结果数为零时复制按钮 disabled。
- 表格复用 `UiTable`，使用 `max-height="320"`，不再使用 `height="100%"`。单条结果时表格约 `70px` 高；20 条时表格停在 `320px` 并在表内滚动。
- 结果表与 `ToolSurface` 左右边缘各保留 `16px` 呼吸空间，表格自身使用 `--radius-md` 圆角；不额外套 `UiPanel`。列顺序固定为身份证号、地区、出生日期、性别、操作；号码与日期使用 mono / tabular-nums。
- 生成后选中第一条；点击整行或行内“复制”都复制该号码并保持选中。复制全部复制换行分隔的全部号码。
- 空结果保持紧凑空态，不撑满整个工作区；不得用大块空白或说明卡填补右侧。

**表面与状态**

- 只使用一个玻璃 `ToolSurface`；参数列、结果标题、表格都是实色内容面，不再叠加 backdrop-filter。
- 年龄 / 日期切换、地区级联和数量变化不得使生成按钮离开首屏；1280 / 1440 / 1600 宽均不得出现页面级横向溢出。
- 行 hover 使用 `--color-fill`，选中行使用品牌蓝 `7.5%` 与 `--color-table` 混合；焦点、disabled、空态与滚动条沿用全局组件令牌。

**迁移落点**

- 修改 `tools/id-card-generator/renderer/pages/IdCardGeneratorPage.vue`：删除 `WorkspaceHeader` 的 actions / status 槽位；把主按钮移入 `config-pane`；把复制全部移入 `result-head`；将 `UiTable` 从 `height="100%"` 改为 `:max-height="320"`。
- 不改生成算法、JSON 配置恢复、选中首行、行点击复制与 IPC；不新增工具级 store 或独立设计令牌。
- 样式只落在页面 scoped SCSS；公共 `UiButton` / `UiChip` / `UiTable` 的视觉内核不改。

### 9.2 设置页

- 作为应用自带页面挂载（不是页签、不进左轨已打开列表），入口固定在 rail 底部；标题栏显示齿轮 + “设置” + 一句话职责（`AppTab.description`）。
- 使用单列文档栏 `760px`，与工具工作区区分。
- 区块顺序：数据目录 → 分层用量 → 缓存清理 → 窗口外观 → 窗口大小与位置。
- 设置项仍使用 `UiFormField` / `UiSwitchField` / `UiButton`，不引入新的配置卡样式。

## 10. 交互、状态与无障碍

### 10.1 状态矩阵

| 状态 | 表现 |
| --- | --- |
| hover | 玻璃行 / 按钮变亮；边线轻微转品牌色；最多上移 1px |
| focus | 统一 `--shadow-focus`；命令面板与工具行必须可按 Tab 到达 |
| active / selected | 品牌 9–10% 浅底 + 17–22% 边线 + 中性主文本 |
| loading | 表格 / 列表使用 3 行骨架；按钮显示内置 spinner；不替换整页 |
| empty | `UiEmpty` + 下一步动作；不写“暂无数据”了事 |
| error | 就地显示问题、原因、重试动作；日志进 inspector |
| disabled | 颜色降对比，保留可读标签；不给容器 opacity |

### 10.2 键盘

- `Ctrl/Cmd+K`：命令面板。
- `Esc`：关闭命令面板 / 抽屉 / dialog；若处于拖拽则取消拖拽。
- `Enter`：打开高亮工具 / 确认当前主操作。
- `↑/↓`：命令面板与列表导航。
- `Tab/Shift+Tab`：焦点顺序保持“rail → topbar → tool header → nav → content → statusline”。
- 首页工具行使用真实按钮语义；打开与置顶必须是两个并列按钮，不得把置顶按钮嵌套进工具行按钮。

### 10.3 无障碍

- 正文、标签与占位符 ≥ 4.5:1；图形 / 焦点环 ≥ 3:1。
- 状态不仅靠颜色，必须同时有文字或图标。
- 所有图标按钮提供 `aria-label` / tooltip。
- 文字缩放 125–150% 时，表格可横向滚动，rail 与 topbar 不重叠。
- `prefers-reduced-transparency: reduce` 时 alpha 全部回 1、玻璃回 `none`。
- `prefers-reduced-motion: reduce` 时过渡降到 0.01ms。

## 11. 工程迁移计划

> 目标：不改产品功能与 IPC 边界，只重构外壳、首页、工具页布局与运行时挂载策略。每个阶段单独可运行、可回滚。

### Phase 0 — 基线与保护

1. 读取并记录当前首页、设置页、8 个工具页在 1280 / 1440 / 1600 宽度的截图。
2. 标记所有工具页的 `onUnmounted`、`dispose`、`onBeforeUnmount`、IPC 取消订阅与 webview 清理。
3. 保留 `git status` 中与本任务无关的用户改动，不覆盖 `TODO.md`、`telegram-tt/`、`tweb/`。
4. 在 `docs/redesign-preview.html` 对照本文档逐项验收视觉，不先改业务组件。

### Phase 1 — 令牌、玻璃与基础组件

1. 更新 `renderer/shared/styles/tokens.scss`：新色阶、rail 角色、圆角、display 字号、阴影与动效。
2. 更新 `renderer/shared/styles/translucency.scss`：合成 rail、各材质 alpha/glass、夜色重算与 reduced-transparency。
3. 更新 `renderer/shared/styles/base.scss`：文本色阶、滚动条、选区、focus-visible 与最小字号检查。
4. 调整基础组件，但不改 API：
   - `UiButton`：32px 高、11px 圆角、主按钮改为墨蓝实底，移除过强光晕。
   - `UiSearchInput` / `UiInput` / `UiSelect`：9–11px 圆角、玻璃底、focus 外环。
   - `UiPanel`：圆角 16px；只在设置与辅助区使用，不再作为工具主容器。
   - `UiTable`：表头 11px，表体 12px，行高 39–44px，表头 fill。
   - `UiChip` / `UiStatusTag`：保持单档语义色，字号不低于 11px。
5. 运行 `pnpm typecheck`、`pnpm lint`，并检查不透明 / acrylic / 夜色三态。

### Phase 2 — 应用外壳与运行时

1. 新增 `renderer/shared/components/AppRail.vue`，移除 `HeaderTabs` 的品牌标与设置入口依赖（后续“标题栏收敛”已把 `HeaderTabs` 整体删除，见 §5.2 / §5.3）。
2. 重构 `renderer/App.vue`：
   - 68px rail + 48px topbar；
   - 只挂载 `activeId`；
   - 首页不挂载工具；
   - 关闭工具执行 destroy；
   - 保留 `runTabCloseGuard`。
3. 新增 `renderer/shared/components/CommandPalette.vue`，接入工具注册表与 `Ctrl/Cmd+K`。
4. ~~`HeaderTabs.vue` 改为 32px 紧凑页签~~（已废弃：页签整体移除，工具切换改由左轨运行列表承担，见 §5.2）。
5. 将设置入口移到 rail 底部；标题栏右侧只保留窗口控件预留。
6. 验证：
   - 首页零工具实例；
   - 切换 tab 时旧工具 `onUnmounted` 必达；
   - 关闭 tab 后无 webview / 定时器 / IPC 残留。

### Phase 3 — 首页 / 启动台

1. 重写 `renderer/pages/HomePage.vue`：搜索坞 + 单一 launcher 表面 + 两列工具行。
2. 新建 `renderer/shared/components/LauncherRow.vue`；`ToolCard.vue` 进入弃用状态，待全部引用移除后删除。
3. 保留 `tool-order.ts` 的排序逻辑；收藏改名置顶，默认取前 4 个进入 rail。
4. 搜索直接打开命令面板；首页行内搜索可选保留，但不能出现两套互不一致的结果。
5. 移除版本号、分类、运行状态、`isNew` 徽章与右侧说明；保留最多两行的 `description`。
6. 回归 `UiPreferences` 同步、LocalStorage 镜像、拖拽排序与恢复默认。

### Phase 4 — 工具工作区框架与逐工具迁移

1. 新增 `WorkspaceHeader.vue`、`ToolSurface.vue`、`ToolSideInspector.vue`。
2. 按风险从低到高迁移：
   1. 身份证号生成器 → 验证表单工作室。
   2. 拦截器 → 验证流式工作台与路由子视图。
   3. Telegram 网络优化、tweb → 验证 webview + inspector。
   4. Treease 编辑器 → 验证全幅 webview。
   5. 离线包下载 → 验证处理控制台与历史抽屉。
   6. WXP 增强 → 验证进程状态、设置与缓存表。
   7. WorkBuddy2API → 验证安装 / 启停 / 关闭销毁。
3. 每个工具迁移时只允许保留一个主 `ToolSurface`；删除首屏 `UiPanel` 堆叠。
4. 页面级滚动仍只发生在 `.app-main` 或工具自身主区域；任何 `flex:1` 子项必须配 `min-height:0`。
5. 替换后运行对应工具的实际操作：启动、停止、生成、下载、打开外部、关闭工具。

### Phase 5 — 设置、反馈与边界状态

1. 设置页改用新表单令牌与 rail 入口。
2. `UiDialog` 圆角 22px，遮罩 `blur(8px)`，按钮顺序保持“取消 / 危险动作 / 主操作”。
3. toast 使用 `vue-sonner`，圆角 12px，深色玻璃，不遮挡 statusline。
4. 检查 125% / 150% 缩放、1024px 宽、页签溢出、长工具名、搜索空态、错误态。

### Phase 6 — 视觉与行为验收

必须全部通过：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm data-layers:check`
- `pnpm vite build`
- `pnpm web`：首页、命令面板、3 个工具骨架在浏览器可见
- `pnpm dev`：Electron 外壳、半透明、设置页、关闭销毁
- 1280 / 1440 / 1600 宽度截图
- 不透明 / acrylic / mica / 夜色玻璃 / reduced-transparency 截图
- `Ctrl/Cmd+K`、Tab、Enter、Esc、方向键全键盘路径
- 关闭工具后检查：
  - DOM 中无该工具根节点；
  - webview guest 计数回落；
  - store 订阅 / 定时器 / 子进程已停止；
  - 重新打开时从头初始化；
  - 草稿与配置仍从 JSON store 恢复。

### 文件落点

| 工作 | 文件 |
| --- | --- |
| 设计令牌 | `renderer/shared/styles/tokens.scss` |
| 玻璃 / 夜色 | `renderer/shared/styles/translucency.scss` |
| 基础排版 / focus / 滚动条 | `renderer/shared/styles/base.scss` |
| 应用外壳 | `renderer/App.vue` |
| 左侧导航 | `renderer/shared/components/AppRail.vue`（新增） |
| 命令面板 | `renderer/shared/components/CommandPalette.vue`（新增） |
| 左轨运行列表 / 标题栏上下文块 | `renderer/shared/components/AppRail.vue`、`renderer/App.vue` |
| 首页 | `renderer/pages/HomePage.vue` |
| 工具入口行 | `renderer/shared/components/LauncherRow.vue`（新增） |
| 工具 header / surface / inspector | `renderer/shared/components/workspace/`（新增） |
| 设置页 | `renderer/pages/SettingsPage.vue` |
| 工具页 | `tools/<tool>/renderer/pages/*.vue` |
| 可交互预览 | `docs/redesign-preview.html` |

## 12. Do's and Don'ts

### Do

- **Do** 让一个工具页只有一个主工作区表面。
- **Do** 把设置、诊断、说明和安装收进 inspector / 抽屉 / 子路由。
- **Do** 让首页工具行只保留图标、名称、一句描述、置顶与进入箭头。
- **Do** 使用 `Ctrl/Cmd+K` 和左轨保证任意位置快速打开工具。
- **Do** 使用品牌蓝表达“当前、可操作、聚焦”，并让选中文字保持中性主文本。
- **Do** 在所有材质和夜色下检查玻璃上的文字对比。
- **Do** 在关闭前只对真实的未完成任务弹确认，完成后直接释放。

### Don't

- **Don't** 在首页展示运行状态、版本、分类、进程、路径或统计卡片。
- **Don't** 用 `UiPanel` 堆出工具首屏的三四块并列面板。
- **Don't** 保留所有已打开工具的隐藏挂载或跨工具 `KeepAlive`。
- **Don't** 在工具之间使用不同强调色或给工具定义 `color`。
- **Don't** 把 9–10px 文本、亮蓝小字、彩色左边条或渐变文字带入生产界面。
- **Don't** 给每一层表面都加 `backdrop-filter` 或阴影。
- **Don't** 用弹窗承载可以直接在工作区内完成的任务。

## 13. Agent 维护地图

本设计系统刻意拆成四层，后续 agent 不应把所有内容重新塞回一个文件：

| 层 | 文件 | 权威范围 | 更新时机 |
| --- | --- | --- | --- |
| 人读设计契约 | `DESIGN.md` | 视觉世界、令牌语义、组件规则、布局骨架、生命周期硬约束、验收标准 | 任何设计方向、令牌、组件 API 或工具骨架变化 |
| 机器可读侧车 | `.impeccable/design.json` | 颜色、字体、圆角、间距、核心组件契约 | 与 DESIGN 的 frontmatter / 令牌表同步 |
| 可执行迁移计划 | `docs/redesign-implementation-plan.md` | Phase 0–6 复选框、证据路径、未完成项、回归方法 | 每完成一个阶段或一次验收 |
| 交互视觉预览 | `docs/redesign-preview.html` | 首页、命令面板、工具工作区、夜色玻璃与材质状态 | 视觉方向变更前先改预览，再改产品代码 |

**实现索引**

- 设计令牌：`renderer/shared/styles/tokens.scss`
- 玻璃与夜色：`renderer/shared/styles/translucency.scss`
- 全局浏览器表面：`renderer/shared/styles/base.scss`
- 平台组件：`renderer/shared/components/ui/`
- 组合型工作区组件：`renderer/shared/components/workspace/`
- 应用壳与生命周期：`renderer/App.vue`、`renderer/shared/components/AppRail.vue`
- 首页与启动台：`renderer/pages/HomePage.vue`、`renderer/shared/components/LauncherRow.vue`

**维护顺序（不可跳步）**

1. 先改本文件或预览，明确是“重构世界”还是“保真细化”。
2. 同步 `.impeccable/design.json` 与令牌表；令牌名不改语义，旧名保留兼容。
3. 先生成 / 更新 `Ui*` 基础组件，再迁移应用壳，再迁移首页，最后迁移单工具页。
4. 单工具页只能选择 §8.1 的四种骨架之一；辅助信息进入 inspector、抽屉或子路由。
5. 修改运行时挂载或关闭路径时，必须验证“切走、关闭工具、回首页、退出应用”四条路径，并在实施计划里记录端口 / DOM / 进程证据。
6. 每个阶段完成后更新 `docs/redesign-implementation-plan.md` 的复选框与证据路径；只改产品代码、不改契约视为未完成。

---

*本文档是 Command Deck 改版的实现契约。任何令牌、外壳或工具页视觉变更必须同步本文件；预览文件 [`docs/redesign-preview.html`](docs/redesign-preview.html) 用于在正式改代码前确认方向。*
