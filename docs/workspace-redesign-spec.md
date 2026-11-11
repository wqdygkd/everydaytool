# 工具页与首页布局改版 · 实施规格（v2）

> 这是**可执行规格**，不是设计说明。设计权威仍是 [`DESIGN.md`](DESIGN.md)（§5 外壳 / §6 首页 / §8 工具页 / §13 基线 v2）。本文只回答：改哪些文件、改成什么、怎么证明改对了。
>
> 可交互视觉预览：[`docs/preview/tool-workspace-layout.html`](preview/tool-workspace-layout.html)（单文件，浏览器直接打开；「现状 / 改版」可 A/B，玻璃与平台可切）。
>
> 读者：执行实施的下一个 agent。**按 §5 的顺序做，不要跳步**；每步都有可跑的验收断言。

---

## 1. 目标与非目标

**目标**：把工具页的「五条横带」压成「一条横带 + 一条竖脊」，让工具主体拿到更多纵向空间，同时保留工具切换能力。

**非目标**（明确不做）：

- 不动视觉世界：颜色、圆角阶梯、阴影、玻璃、字体全部沿用 `renderer/shared/styles/tokens.scss`。**不要**引入新的品牌色、新字体、新阴影。
- 不动工具业务逻辑：IPC、store 形状、生成算法、下载流程、代理开关一律不改，除非本文明确点名。
- 不动设计系统组件内核（`UiButton` / `UiTable` / `UiChip` 等）。
- 不合并工具页的 KeepAlive 模型（`ToolPane` 常驻行为保持现状）。

---

## 2. 硬验收（全部可脚本化）

在 1440×900 的窗口内容区（`pnpm dev` 真实窗口，或 `pnpm web` + 浏览器 1440×900）满足：

| # | 断言 | 判定 |
| --- | --- | --- |
| A1 | 每个工具页的横带高度等于 §4.2 表里的目标值 ±2px | 见 §6 脚本 |
| A2 | 任意工具页 DOM 中不存在 `.workspace-header`、`.lg-subnav` 类横排子导航；除白名单（skill-manager / workbuddy / wxp）外不存在 statusline | `document.querySelectorAll` 计数为 0 |
| A3 | 工作区栏内同时存在：工具切换器、说明、状态、主操作（各一） | 选择器计数 |
| A4 | 首页按 `1`–`8` 能切到对应工具；`⌘K` 打开命令面板 | 键盘脚本 |
| A5 | tweb 页面与影库同屏；分隔条可拖；影库宽度落在 360–760px | 拖拽脚本 |
| A6 | 文字对比度：实底 / 半透明 / 玻璃三档 × 深色壁纸 / 浅色壁纸，正文 ≥ 4.5:1 | 见 §6 脚本 |
| A7 | `pnpm typecheck`、`pnpm lint`、`pnpm data-layers:check` 全绿 | CLI |

---

## 3. 现状基线（改前实测，用于回归对照）

1440×900 内容区，单位 px：

| 工具 | 顶栏 | 重复 header | 横排子导航 | 工具条 | statusline | 横带合计 | 工作区 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 技能管理 | 48 | 70 | 34 | 48 | 31 | **231** | 655 |
| WorkBuddy2API | 48 | 70 | 34 | 48 | 31 | **231** | 655 |
| 拦截器 | 48 | 70 | 34 | 48 | – | **200** | 686 |
| WXP 增强 | 48 | 70 | – | 48 | 31 | **197** | 689 |
| Telegram 缓存 | 48 | – | 34 | 48 | – | **130** | 756 |
| Treease 编辑器 | 48 | – | – | 48 | – | **96** | 790 |
| 离线包下载 | 48 | – | – | – | – | **48** | 838 |
| 身份证号生成器 | 48 | – | – | – | – | **48** | 838 |
| 首页 | 48 | – | – | – | – | **48** | 852 |

---

## 4. 设计数值（直接照抄，不要重新设计）

### 4.1 尺寸

| 变量 | 旧值 | 新值 | 落点 |
| --- | --- | --- | --- |
| `--rail-width` | 68px | **56px** | `tokens.scss` |
| rail 图标钮 | 42×42 | **40×40**（圆角 11px，图标 18px） | `AppRail.vue` |
| rail 激活指示条 | `left: -13px` | **`left: -8px`**（贴窗口左缘；改轨道宽度必须同步改） | `AppRail.vue` |
| rail 分隔线 | 28px | **24px** | `AppRail.vue` |
| `--topbar-height` | 48px | 48px（不变） | `tokens.scss` |
| `--workspace-header-height` | 70px | **删除该变量与组件** | `tokens.scss` |
| `--workspace-toolbar-height` | 48px | 48px（不变） | `tokens.scss` |
| `--workspace-statusline-height` | 31px | 31px（保留变量，工具**默认不用**） | `tokens.scss` |
| `--spine-width` | — | **新增 98px** | `tokens.scss` |
| 工具页表面外边距 | `0 18px 18px` / `18px` | **`0 12px 12px`** | 各工具页根节点 |

### 4.2 目标横带

| 工具 | 目标横带 | 组成 |
| --- | --- | --- |
| 有工具条的 7 个工具 | **96** | 48 顶栏 + 48 工具条 |
| Telegram 缓存（无工具条） | **48** | 48 顶栏 |
| 首页 | **48** | 48 顶栏 |

> 收益只来自被删掉的那三条横带。离线包 / 身份证 / Treease 的目标值与现状相同——**这是正确结果**，不要为了「让每个工具都变小」而删内容。

### 4.3 竖脊（子视图导航）

- 宽 98px（内边距 8px），页签高 32px、圆角 10px、字号 12px、间距 3px。
- 激活态：`color-mix(in srgb, var(--color-primary) 9%, transparent)` 底 + `17%` 边线 + 主文本 + 500 字重。
- 计数徽章：10px、等宽、`--color-text-tertiary`。
- 顶部 10px 分组标签「子视图」；底部 18×3 grip。
- 只有 1 个子视图或单页工具 → **不渲染竖脊**（`noSpine`）。

### 4.4 工作区栏内容顺序

```
[红绿灯 84px（mac）/ 16px（win）] [工具切换器: 26px 图标 + 名称 + ▾] [说明 12px，可压缩，最大 46%]
  …… grow …… [状态: 6px 圆点 + 11px] [次操作] [主操作 primary] [⋯] [Win 原生按钮 148px 预留]
```

- 首页 / 设置页：`EDT 字标 + everydaytool + 本地工具工作区` 或 `icon + 页面名 + 职责`，**无操作区**。
- 主操作每个工具**只能出现一次**（顶栏或工具条，二选一，见 §5 表）。

---

## 5. 实施步骤

每一步结束都要能通过该步的验收，再进下一步。

### Step 1 — 令牌

**文件**：`renderer/shared/styles/tokens.scss`

1. `--rail-width: 68px` → `56px`。
2. 删除 `--workspace-header-height`（先 grep 确认只剩 `WorkspaceHeader.vue` 在用）。
3. 新增 `--spine-width: 98px;`（放在 `--workspace-toolbar-height` 旁）。
4. 其余令牌不动。

**验收**：`grep -rn "workspace-header-height" renderer tools` 返回空；`pnpm typecheck` 通过。

### Step 2 — 左轨收窄

**文件**：`renderer/shared/components/AppRail.vue`

1. 图标钮尺寸 42 → 40，圆角 `--radius-md`(12) → `--radius-control`(11)，图标 19 → 18。
2. 激活指示条 `left: -13px` → `left: -8px`，保持 `3×18px`、`border-radius: 0 2px 2px 0`。
3. 分隔线 28px → 24px。
4. 关闭钮、tooltip（`UiTooltip` portal）、`aria-label` 文案规则**全部不动**。

**验收**：断言 `rail.offsetWidth === 56`；激活指示条左边缘 == 窗口内容区左边缘（误差 ≤1px）；11 个图标在 800px 高窗口内不产生滚动。

### Step 3 — 工作区栏接管工具上下文

**文件**：`renderer/App.vue`

1. 顶栏结构改为 §4.4 的顺序；三种形态按路由切换（首页 / 工具页 / 应用自带页面）。
2. **工具切换器 = 复用现有命令面板**：点击调用 `useCommandPalette()` 的 open，不新建浮层组件。
3. 增加两个 teleport 容器（工具页往这里塞状态与操作）：

```vue
<header class="app-topbar">
  <!-- 身份块 / 说明 ... -->
  <div class="grow" />
  <div id="app-topbar-state" class="topbar-state-slot" />
  <div id="app-topbar-actions" class="topbar-actions-slot" />
</header>
```

4. `padding-left` 仍由 `.platform-darwin` 控制（84px / Win 148px 右预留），**不要**改成固定值。
5. 删除旧的「不显示打开工具按钮」禁令——现在顶栏就是入口，但只允许切换器与动作，不出现页签溢出物。

**工具页如何注入**（推荐契约，利用 `ToolPane` 已提供的 active 标记）：

```vue
<script setup lang="ts">
import { inject } from 'vue'
import { TOOL_PANE_ACTIVE } from '@renderer/shared/components/ui/overlay-target'
const paneActive = inject(TOOL_PANE_ACTIVE, ref(true))
</script>

<template>
  <Teleport v-if="paneActive" defer to="#app-topbar-actions">
    <UiButton type="primary" @click="mountProxy">挂载代理</UiButton>
  </Teleport>
  <Teleport v-if="paneActive" defer to="#app-topbar-state">
    <span class="tb-state" :class="tone"><i class="dot" />{{ label }}</span>
  </Teleport>
</template>
```

> `v-if="paneActive"` 是硬要求：`ToolPane` 会让多个工具同时挂载，不加会在顶栏叠出多套操作。

**验收**：断言 A3；切到首页时两个 slot 为空；两个工具来回切，slot 内始终只有一套按钮。

### Step 4 — 删除 `WorkspaceHeader`

**文件**：删除 `renderer/shared/components/workspace/WorkspaceHeader.vue`；清理 4 处引用：

| 文件 | 处理 |
| --- | --- |
| `tools/interceptor/renderer/pages/InterceptorPage.vue` | 删除组件与 import；主/次操作改 teleport 到顶栏 |
| `tools/skill-manager/renderer/pages/SkillManagerPage.vue` | 同上（重新扫描 / 安装技能 / 设置 / 回收站） |
| `tools/wxp-enhancer/renderer/pages/WxpEnhancerPage.vue` | 同上（启动） |
| `tools/workbuddy2api-panel/renderer/pages/Workbuddy2apiPanelPage.vue` | 同上（启动） |

**验收**：`grep -rn "WorkspaceHeader" renderer tools` 为空；四个工具的横带降到 96（有工具条）或按 §4.2。

### Step 5 — 表面与 statusline

**文件**：`renderer/shared/components/workspace/ToolSurface.vue` + 各工具页根节点

1. 工具页根节点外边距统一 `0 12px 12px`（原 `0 18px 18px` / `18px`）。
2. `ToolSurface` 保留 `#toolbar` 与 `#statusline` 槽位，但**删除默认 statusline**：三个工具（skill-manager / workbuddy / wxp）把 statusline 里的信息并入工具条右端，然后去掉 `#statusline` 内容。
3. 表面圆角 16px、1px 边框、`--shadow-sm` 不变。

**验收**：A2；三个工具的横带从 231 / 231 / 197 降到 96。

### Step 6 — 竖脊组件

**新增**：`renderer/shared/components/workspace/WorkspaceSpine.vue`

```vue
<script setup lang="ts">
export interface SpineItem { key: string; label: string; count?: string | number }
const props = withDefaults(defineProps<{
  items: SpineItem[]
  modelValue: string
  label?: string
}>(), { label: '子视图' })
const emit = defineEmits<{ 'update:modelValue': [key: string] }>()
</script>

<template>
  <nav class="spine" role="tablist" :aria-label="label">
    <div class="spine-label">{{ label }}</div>
    <button
      v-for="it in props.items" :key="it.key" type="button" role="tab"
      class="spine-tab" :class="{ 'is-on': it.key === props.modelValue }"
      :aria-selected="it.key === props.modelValue"
      @click="emit('update:modelValue', it.key)"
    >
      <span class="cap">{{ it.label }}</span>
      <span v-if="it.count !== undefined && it.count !== ''" class="badge">{{ it.count }}</span>
    </button>
    <div class="spine-grow" />
  </nav>
</template>
```

样式按 §4.3 写死在该组件 `scoped lang="scss"`；宽高用 `--spine-width`。

**接入点**（把 `UiMenuHorizontal` 换成竖脊，位置在 `ToolSurface` **外侧**、与之并排）：

`tools/interceptor` / `tools/skill-manager` / `tools/workbuddy2api-panel`。`tools/tweb-cache` 的页签**整组删除**（见 Step 8）。`tools/offline-pack/components/GitHubDownloader.vue` 内的 `UiMenuHorizontal` 是产物内切换，不在本次范围，保留。

**验收**：竖脊在 900px 高窗口下不滚动；点页签后路由变化且 `useToolPath()` 读到的子路径正确。

### Step 7 — 拦截器四子视图

**文件**：`tools/interceptor/renderer/pages/InterceptorPage.vue` + 子组件

按 DESIGN §8.5 落地：状态 / 处理名单 / 规则 / 流量各自成屏，工具条随页签变化：

| 页签 | 工具条 | 主体 |
| --- | --- | --- |
| 状态 | 代理未运行 + `0 origins · 0 rules` + 刷新 | 运行灯 + 键值组 + 浏览器连接空态 + fail-open 说明；右侧 31px 栏放扩展接入三步与根证书 |
| 处理名单 | 启用 N / M + 加入名单 | 表格 `origin / 启用 / 强制回源 / 加入时间 / 操作` |
| 规则 | 全部 / 已固定 / 已启用 + 新建规则 | 表格 `✓ / 规则 / 类型 / 状态 / 更新时间 / 操作` |
| 流量 | 搜索 + `N / 1000 条` + 清空 | 表格 `时间 / 方法 / URL / 状态 / 耗时 / 标记`（URL 单列，不拆主机与路径） |

**验收**：四屏的工具条与主体互不相同；横带恒为 96；状态页右侧栏在 1280 宽下不挤压主区。

### Step 8 — tweb 左右分栏

**文件**：`tools/tweb-cache/renderer/pages/TwebCachePage.vue`

1. 删除 概览 / 影库 两个页签（`UiMenuHorizontal` 整组移除，`subRoutes` 收敛为单一路由或保留重定向）。
2. 主体改为左右分栏：左 `webview`（`flex: 1`）+ 7px `role="separator"` 分隔条 + 右影库面板。
3. 影库面板默认 **504px**，可拖范围 **360–760px**；聚焦分隔条后 `←/→` 每次 24px；拖拽时按窗口缩放比换算（`window.devicePixelRatio` 无关，但若使用 CSS `zoom` 或 `transform: scale` 需除以缩放系数）。
4. **保留现有六列表格**：`会话 / 消息 | 消息 ID | 预览 | 大小 | 状态 | 操作`；消息 ID、大小右对齐等宽数字。低于最小宽度时横向滚动，不压缩列宽。
5. 表格下方保留「回收站」区块与计数。
6. 概览的统计并入面板标题行右侧（`312 条 · 4.2 GB`）。
7. 工具条：搜索 + 全部暂停 + 刷新。

**验收**：A5；影库宽度 clamp 生效；表格在 504px 下无横向滚动。

### Step 9 — 首页

**文件**：`renderer/pages/HomePage.vue`（+ `renderer/stores/toolTabs.ts`）

1. 版面按 DESIGN §6：内边距 36/40/32，最大宽 1264，两栏（索引 `flex:1` + 右侧 286px，间距 34px）。
2. 索引行 52px：序号（等宽，右对齐 16px）+ 30px 图标块 + 名称 14/500 + 说明 12 单行省略 + 状态（圆点 + 11px）。
3. 删除：搜索坞卡片、`launcher` 卡片与「所有工具 / 拖动调整顺序」标题行、每行常驻星标列。
4. 星标改为行 hover 时出现在状态右侧的 28px 按钮（仍写 `favoriteToolIds`）。
5. 标题行右侧「搜索 ⌘K」按钮 → 打开命令面板。
6. 键盘 `1`–`8` 直启：全局 keydown，输入框聚焦时忽略。
7. **`toolTabs` 补时间戳**（右侧「最近打开」需要）：

```ts
// 兼容旧值：数组 → 对象
type Persisted = { openIds: string[]; openedAt?: Record<string, number> }
```

读取时 `Array.isArray(raw) ? { openIds: raw } : raw`；关闭工具时同时删 `openedAt[id]`。

**验收**：A4；一屏看全 8 行（1280×800 不滚动）；最近 3 个按时长倒序。

### Step 10 — 收尾

1. 同步 `AGENTS.md`：rail 56 / 按钮 40 / 无 `WorkspaceHeader` / 竖脊取代横排子导航 / statusline 默认不渲染 / 外边距 12px。
2. 跑 A7 三条命令。
3. 用 §6 脚本复核 A1 / A2 / A6，把结果贴进 PR 描述。
4. 若本轮新增了 data 落点（本规格没有），补 `DATA_LAYER_ENTRIES`。

---

## 6. 验收脚本（Chrome DevTools MCP `evaluate_script` 可直接跑）

```js
() => {
  const H = el => el ? el.offsetHeight : 0;          // 布局像素，不受缩放影响
  const band =
    H(document.querySelector('.app-topbar')) +
    H(document.querySelector('.workspace-toolbar, .tool-surface-toolbar'));
  const body = H(document.querySelector('.tool-surface-body'));
  return {
    band, body,
    hasOldHeader: !!document.querySelector('.workspace-header'),
    hasHMenu: !!document.querySelector('.ui-menu-horizontal'),
    hasStatusline: !!document.querySelector('.tool-surface-statusline'),
    topbarSlots: ['#app-topbar-state', '#app-topbar-actions']
      .map(s => document.querySelectorAll(`${s} > *`).length),
  }
}
```

对比度脚本（正文 ≥ 4.5）：

```js
() => {
  const parse = s => {
    if (s.startsWith('color(')) {
      const m = s.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/)
      return m ? [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]] : null
    }
    const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  const bgOf = el => {
    const stack = []; let e = el
    while (e) {
      const c = parse(getComputedStyle(e).backgroundColor)
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 0.999) break }
      e = e.parentElement
    }
    let b = [255, 255, 255]                       // 玻璃场景换成壁纸色
    for (let i = stack.length - 1; i >= 0; i--) {
      const c = stack[i]; b = [0, 1, 2].map(k => c[k] * c[3] + b[k] * (1 - c[3]))
    }
    return b
  }
  const lin = v => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  const L = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
  const bad = []
  document.querySelectorAll('.app-shell *').forEach(el => {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return
    const c = parse(cs.color); if (!c) return
    const l1 = L(c), l2 = L(bgOf(el))
    const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const need = parseFloat(cs.fontSize) >= 18 ? 3 : 4.5
    if (r < need - 0.02) bad.push({ text: el.textContent.trim().slice(0, 16), ratio: +r.toFixed(2) })
  })
  return bad
}
```

> 玻璃 / 半透明档必须把 `b` 的初值改成壁纸实际颜色再跑一次（浅色壁纸 + 深色壁纸各一次），否则会假绿。

---

## 7. 边界与失败模式

| 场景 | 必须的行为 |
| --- | --- |
| 说明文字过长 | 顶栏说明 `max-width: 46%` 单行省略；名称与图标不收缩 |
| 工具名很长（“Telegram 缓存（tweb）”） | 切换器 `max-width: 268px` 省略，`title` 给全名 |
| 只有 1 个子视图 | 不渲染竖脊（`noSpine`），主体占满 |
| 窗口窄到 1100px | 竖脊 98 → 86px，页签徽章隐藏；左轨保持 56px；不出现横向滚动 |
| 多个工具同时挂载（`ToolPane`） | 顶栏 slot 只允许活动面板 teleport；非活动面板 `v-if` 关掉 |
| tweb 分隔条拖到极限 | clamp 360–760，表格横向滚动，不压缩列宽 |
| 首页工具数变化（新增/禁用工具） | 索引行数 = 已注册工具数；`1`–`8` 只绑定前 8 个，超出不绑定 |
| 玻璃档 + 深色壁纸 | 半透明表面必须用加深后的墨色（见 DESIGN §2.2）；验收脚本把基底换成壁纸色再跑 |

---

## 8. 风险与未决（实施前请确认）

1. **`recentIds` 无时间戳**：右侧「最近打开」需要 `openedAt`，属新增持久化字段。旧数据是纯数组，必须做向后兼容解析（见 Step 9.7）。
2. **置顶入口变化**：首页星标从常驻列改为 hover 按钮，可发现性下降。若产品不接受，备选：把星标放在索引行最右侧常驻（会多占 32px 横向）。
3. **Windows 标题栏未真机验证**：`titleBarOverlay` 的 148px 预留是按 3×46 + 间距推算的，需在 Windows 上截一次图核对右预留是否够。
4. **DESIGN §5.4 与实现漂移**：文档写「只有当前活动页挂载」，实现是 `ToolPane` 常驻。本次不改行为，但文档需单独修订（已在 §13.5 标注）。
5. **拦截器规则类型**：竖脊只放 4 个子视图；`/rules/<type>` 的 10 种类型仍走工具条筛选，不做二级竖脊。若要二级，需先确认竖脊能容纳 14 项而不滚动。

---

## 9. 回滚

- 本次改动是**渐进式**的：Step 1–2（令牌 + 左轨）可独立回滚；Step 4（删 header）是唯一破坏性步骤，回滚方式是恢复 `WorkspaceHeader.vue` 与 4 处引用（git revert 单文件即可）。
- 不要为回滚预留「两套顶栏」的开关：双形态会让 `ToolPane` 与 teleport 契约变复杂。

---

## 10. 交付物清单

- [ ] Step 1–10 全部完成，A1–A7 全绿
- [ ] `DESIGN.md` §5 / §6 / §8 / §13 与实现一致（本轮已更新，若实施中偏离需回写）
- [ ] `AGENTS.md` 的「布局、左轨与标题栏」段同步
- [ ] PR 描述附：改前 / 改后横带对照表 + A6 对比度脚本输出
- [ ] 预览稿 `docs/preview/tool-workspace-layout.html` 与本规格数值一致（发现不一致时以本规格为准，并修预览）
