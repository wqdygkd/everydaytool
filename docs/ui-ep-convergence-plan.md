# Element Plus 收敛与视觉收紧 · 实施计划（Step 1–3）

> 本文是「不迁移 shadcn、改为收敛 EP 接触面」路线的可执行计划，覆盖上一轮分析中的 Step 1（视觉收紧）、Step 2（组件收敛）、Step 3（`:deep(.el-*)` 归位）。
> 前置结论见本轮分析：迁移 shadcn 约 45–60 人日，收益已被现有「EP 行为 + `Ui*` 外观 + 令牌主题」组合覆盖。
> 相关规范：[DESIGN.md](../DESIGN.md)（设计系统）、[AGENTS.md](../AGENTS.md)（编码约定）、[element-plus.scss](../renderer/shared/styles/element-plus.scss)（唯一全局覆写点）。

---

## 1. 目标与验收指标

### 1.1 目标

1. **Step 1**：把 EP 组件的几何（高度 / 圆角 / 密度 / 半透明底色）全部改为令牌驱动，消除样式层的魔法数字与「死白」底色。
2. **Step 2**：把 4 类重复模式收敛进平台组件库——`el-tag → UiChip`、`el-empty → UiEmpty`、`el-progress → UiProgress`（新增）、`el-table → UiTable`（新增）。
3. **Step 3**：把业务组件里的 `:deep(.el-*)` 归位——搬进 `Ui*` 封装、搬进全局样式、或登记为明确的 exception。

### 1.2 验收指标（可 grep 复核，命令见附录 D）

> **实施状态（2026-10-26 完成 B0–B5）**：下表「结果」列为实测值，由 `pnpm check:ui` 断言。

| 指标 | 基线（2026-10-26） | 目标 | 结果 |
| --- | --- | --- | --- |
| 不同 `el-*` 组件 | 36 种 | 32 种 | **34 种**（`UiTable` / `UiProgress` 内部各保留 1 种） |
| `el-*` 模板出现次数 | 519 处 | ≈ 464 处 | **466 处** |
| `el-tag` | 36 处 / 9 文件 | 0 | **0** ✅ |
| `el-empty` | 1 处 | 0 | **0** ✅ |
| `el-progress` | 4 处 | ≤ 1（仅 UiProgress） | **1** ✅ |
| `el-table` 直接使用 | 14 处 / 11 文件 | ≤ 1（仅 UiTable） | **1** ✅ |
| 全局 `.el-*` 选择器 | 72 处（element-plus.scss 64 / utilities.scss 7 / base.scss 1） | 新增规则只写在 element-plus.scss | 新增 9 条（表格字阶/密度 3、alert 5、控件尺寸 1），utilities 新增 `.radio-flush` 1 条 |
| `:deep(.el-*)` 总数 | 26 处 / 10 文件 | 12 处 | **23 处**；其中**业务侧 15 → 8** ✅ |
| 样式层魔法数字（圆角/阴影/间距） | element-plus.scss 内 3 处 + 业务内多处 | 0 | 本轮新增样式全部走令牌 |

> **口径修正**：上一轮分析写的是「26 → ≤10」，实施后按三档记：
> `Ui*` 封装内部 12 处（`UiSearchInput` 6 / `UiTable` 2 / `UiProgress` 2 / `UiPathField` 1 / `UiChip` 0）+
> 应用外壳标题栏 4 处（App.vue 的 card tabs，标题栏专用样式，保留为 exception）+
> **业务组件侧 8 处**（`RulesPanel` 7 + `EnvBrowserPage` 1，均有明确理由，见 §9.3）。
> 业务侧从 15 降到 8：删 5 处（tag 宽度 / mono 表格 / 行指针 / 两处 cell 密度）、
> 用全局 `.radio-flush` 工具类抵掉 2 处。

### 1.3 非目标

- 不引入 Tailwind / shadcn / reka-ui，不换组件库。
- 不改业务逻辑、IPC、路由、store。
- 不重做 interceptor 规则面板的布局（只替换其中的 tag / table 用法）。
- 不动 `ElMessage`（191 处）/ `ElMessageBox`（~21 处）命令式 API——那是换库才会付的成本。
- 不新增颜色/圆角令牌；缺值一律就近取既有阶梯。

---

## 2. 基线快照

采集时间 2026-10-26，采集命令见附录 D。

| 指标 | 值 | 备注 |
| --- | --- | --- |
| 使用 EP 的 `.vue` 文件 | 44 / 67 | |
| `el-*` 模板行 | 519 | 等于重写规模的量纲 |
| 用量分布 | 30+ 处：4 文件；10–29：13；3–9：17；1–2：10 | 重灾区：RulesPanel 109、TreeaseEditorPage 34、DiagnosticsPanel 31、TrafficPanel 31、IdCardGeneratorPage 27、WxpEnhancerPage 25 |
| 全局 `.el-*` 选择器 | 72 | element-plus.scss 64、utilities.scss 7、base.scss 1 |
| 组件内 `:deep(.el-*)` | 26 / 10 文件 | UiSearchInput 6、RulesPanel 9、App 4、UiPathField 1，其余各 1 |
| `element-plus.scss` | 286 行 | 唯一全局覆写点 |
| 平台组件库 | 25 个 `Ui*` | 无 `UiTable` / `UiProgress` |

**样式层当前缺口（Step 1 要补的）**：`el-tag`、`el-alert`、`--el-component-size` 三者**完全未纳入**元素绑定（`grep` 为 0 命中）；`el-progress` 颜色已随 `--el-border-color-lighter` 生效，缺的是统一封装（§7）；`.el-button` 的 `border-radius: 14px` 仍是字面量。

---

## 3. 批次划分

> **状态：B0–B5 已完成（2026-10-26），B6 的文档同步已完成，手工回归待执行。** 实测数据见 §1.2 与 §15。

每批独立提交、独立可发布、独立回滚；后一批依赖前一批的产物。

| 批次 | 内容 | 依赖 | 预估 | 产出 |
| --- | --- | --- | --- | --- |
| **B0** | 基线采集 + grep 断言脚本（附录 D） | — | 0.5 h | 可复现的度量 |
| **B1** | Step 1 视觉收紧（§4） | B0 | 0.5–1 d | element-plus.scss 全部令牌化、同批删 2 处表格密度覆写 |
| **B2** | Step 2A `UiChip` variant + `el-tag` 迁移（§5） | B1 | 0.5–1 d | `el-tag` 归零、删 1 处 `:deep` |
| **B3** | Step 2B `el-empty` + Step 2C `UiProgress`（§6、§7） | B1 | 0.25 d | `el-empty` 归零、进度条统一 |
| **B4** | Step 2D `UiTable` + 14 处接入（§8） | B1 | 1 d | `el-table` 直接使用归零、删 2 处 `:deep` |
| **B5** | Step 3 `:deep` 归位 + tabs 变体全局化（§9） | B2–B4 | 1 d | 9 处搬进全局、业务侧 `:deep` ≤ 5 |
| **B6** | 文档同步 + 全量回归（§10、§13） | 全部 | 1 d | DESIGN/AGENTS 更新、回归记录 |
| **合计** | | | **4–6 人日** | |

> 比上一轮的「3–5 人日」略上调：`UiTable` 要一次性接 14 张表（11 文件），且 `UiChip` 需要兼容现有 32 处用法。

---

## 4. Step 1 · 视觉收紧（B1）

**唯一改动文件**：[renderer/shared/styles/element-plus.scss](../renderer/shared/styles/element-plus.scss)。业务文件零改动，可独立发布。

### 4.1 控件尺寸与圆角

| 改动 | 现状 | 改为 |
| --- | --- | --- |
| 控件高度入口 | 未绑定，EP 默认 32 / small 24 / large 40 | `:root` 增加 `--el-component-size: var(--control-height)`，并显式声明 `--el-component-size-small: 24px` / `--el-component-size-large: 40px`（EP 阶梯，不新增令牌） |
| 按钮圆角 | `.el-button { border-radius: 14px }`（字面量，line 52） | `var(--radius-control)` |
| 输入框圆角 | 走 `--el-border-radius-base` = `--radius-sm`（已正确） | 不动 |
| 选择器高度 | 同上，随 `--el-component-size` | 不动（点击区变大由该变量统一控制） |

### 4.2 表格密度与排版（DESIGN §3.2：表格正文 12px）

| 改动 | 说明 |
| --- | --- |
| `.el-table { font-size: var(--font-size-sm) }` | 统一表体字阶；现在继承 14px 与设计文档不符 |
| `.el-table th.el-table__cell { font-weight: var(--font-weight-medium); font-size: var(--font-size-sm) }` | 表头字重显式化（避免依赖 EP 默认 600） |
| `.el-table .cell { padding-top: var(--spacing-xs); padding-bottom: var(--spacing-xs) }` | **吸收** ResourcesPanel / TasksPanel 两处 `:deep(.el-table .cell)` 的 4px 密度——**B1 同批删除这两处覆写**，否则会叠成 8px。注意：这是**全站生效**的表格纵向密度，14 张表行高统一 +8px，需在 B1 验收时逐表目测；12px 表体 + 4px 内边距正是 DESIGN 的密度取向 |
| `--el-table-text-color: var(--color-text-primary)` | 现有只绑了 header / row-hover / tr-bg |

### 4.3 半透明一致性（补 `el-alert` 的令牌底色）

| 组件 | 现状 | 改为 |
| --- | --- | --- |
| `el-alert` | EP 默认不透明浅色底（`--el-color-warning-light-9` 等），是玻璃模式下唯一「死白」的表面 | `.el-alert--warning.is-light` → `color-mix(in srgb, var(--color-warning) 10%, transparent)`；success / error / info 同理；统一 `border-radius: var(--radius-md)`、`padding: var(--spacing-sm) var(--spacing-md)` |
| `el-progress` | 轨道底色取 `--el-border-color-lighter`（已绑 `--color-border-light`），颜色无需处理；高度/圆角交给 `UiProgress`（§7） | 本节不动 |
| `el-tag` | 未处理（B2 直接迁 `UiChip`，**不写临时样式**） | B2 |

> `el-tag` 的决策：若 B1 与 B2 一起发版，跳过 `el-tag` 临时样式；若 B1 需要单独发布，则临时给 `el-tag` 加 pill 几何（`border-radius: 999px; font-size: var(--font-size-xs); padding: 2px var(--spacing-sm)`），B2 完成后删除。

### 4.4 EP 样式注入顺序（已知坑）

EP 的组件 CSS 由 `ElementPlusResolver({ importStyle: 'css' })` 懒加载、**晚于本文件注入**，同权声明会被盖回。已有先例：`html .el-switch`（line 251）。**新增规则若需压过 EP 默认，一律带 `html`/`.el-xxx .el-yyy` 前缀**，并在注释里写明原因。

### 4.5 验收

- [ ] `pnpm lint` / `pnpm typecheck` 通过。
- [ ] 表格：interceptor 两张表、telegram-cache 全部 7 张表、offline-pack 两张表、id-card 结果表、wxp 树形表的行高与字号一致（12px 表体、表头 medium）。
- [ ] 按钮：默认 / small / primary / danger / link 五态高度与圆角符合令牌。
- [ ] `el-alert`：8 处（EnvBrowser / Interceptor ×2 / offline-pack ×2 / telegram-cache ×2 / treease）在半透明模式下不再出现不透明白块。
- [ ] 五种窗口外观模式（默认 / acrylic / mica / tabbed / transparent-only）× 表格 / 按钮 / 输入 / 弹层，逐个目测。

---

## 5. Step 2A · `UiChip` variant 扩展 + `el-tag` 迁移（B2）

### 5.1 为什么需要改 `UiChip`

现状（[UiChip.vue](../renderer/shared/components/ui/UiChip.vue)）：`neutral` = 描边、`success` = **实底绿白字**、其余 = 浅底彩字。
而 `el-tag` 的默认风格是**浅底彩字**、`effect="plain"` 是**透明底彩边彩字**。直接替换会让 14 处表格状态标签变成实底胶囊（行内视觉过重）。

### 5.2 API 扩展（向后兼容）

```ts
type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
type ChipVariant = 'auto' | 'soft' | 'solid' | 'outline'
// tone 默认 neutral；variant 默认 auto
// auto 映射（= 现有视觉，零回归）：
//   neutral → outline；success → solid；其余 → soft
```

实现要点：

1. `resolvedVariant = computed(...)`，模板输出 `is-variant-${resolvedVariant}`。
2. 引入单一下钻变量 `--chip-tone`（按 tone 指向 `--color-success/warning/error/primary/text-tertiary`），把现有 4 组 tone 规则改成「设 tone 变量 + 设 auto 变体」，避免规则爆炸：

```css
.ui-chip.is-variant-soft {
  background: color-mix(in srgb, var(--chip-tone) 10%, transparent);
  border-color: color-mix(in srgb, var(--chip-tone) 35%, transparent);
  color: color-mix(in srgb, var(--chip-tone) 85%, #000);
}

.ui-chip.is-variant-outline {
  background: transparent;
  border-color: color-mix(in srgb, var(--chip-tone) 35%, transparent);
  color: var(--chip-tone);
}
```

3. 现有 32 处 `UiChip` 用法**一行不改**（auto 覆盖）；`ToolCard` 的「NEW」徽章、`DiagnosticsPanel` 的 success 实底保持原样。

### 5.3 `el-tag → UiChip` 映射规则

| el-tag | UiChip |
| --- | --- |
| 无 `type` | `tone="neutral" variant="outline"`（等价于现状 default 外观） |
| `type="success"` | `tone="success" variant="soft"` |
| `type="warning"` | `tone="warning" variant="soft"` |
| `type="danger"` | `tone="danger" variant="soft"` |
| `type="info"` | `tone="info" variant="soft"` |
| `effect="plain"` | 同 tone，`variant="outline"` |
| `size="small"` | 无需传（`UiChip` 只有一档 xs 尺寸） |
| 计数徽章（原本若用 tag 当数字） | `variant="solid"`（本项目无此用法，记录备查） |

> 附录 A 给出 36 处的逐条落点，可直接照表替换。

### 5.4 迁移后要删的样式

- [StatusPanel.vue:145](../tools/chrome-sandbox/renderer/components/StatusPanel.vue#L145) `:deep(.el-tag) { width: fit-content; max-width: 100% }` —— `UiChip` 本身是 `inline-flex` + `max-width: 100%` 语义，删除即可。

### 5.5 验收

- [ ] `grep '<el-tag'` = 0。
- [ ] interceptor 流量表「状态 / 标记」列：1200 行级别数据下，行高与 B1 表格密度一致（soft 胶囊与实底胶囊的高度相同，不引起抖动）。
- [ ] chrome-sandbox 沙箱卡片的 `effect="plain"` 标签改用 outline 后，与卡片描边层次仍可读。
- [ ] treease 的「拦截中 · N 个接口 · 命中 M 次」长文本标签：`max-width: 100%` + 省略不破坏布局。

---

## 6. Step 2B · `el-empty → UiEmpty`（B3）

唯一一处：[RulesPanel.vue:812](../tools/interceptor/renderer/components/RulesPanel.vue#L812) `<el-empty description="暂无规则" :image-size="72" />`

```diff
- <el-empty description="暂无规则" :image-size="72" />
+ <UiEmpty center text="暂无规则" padding="var(--spacing-2xl)" />
```

说明：平台空态无插图（`UiEmpty` 只支持可选 `UiIcon`），这是刻意的设计语言统一——插画风与本应用「无插图」的界面基调不符。若需要图形，用 `icon="layers"`。

验收：规则列表为空 / 过滤后为空两种状态均显示居中文案；表格内空态（`UiTable` 内置）不受影响。

---

## 7. Step 2C · 新增 `UiProgress`（B3）

### 7.1 现状

4 处 `el-progress`，几何与语义各写一半：

| 位置 | props |
| --- | --- |
| [DownloadSection.vue:37](../tools/offline-pack/renderer/components/DownloadSection.vue#L37) | `:percentage`、`:show-text="false"`（无 stroke-width） |
| [DiagnosticsPanel.vue:610](../tools/telegram-cache/renderer/components/DiagnosticsPanel.vue#L610) | `:stroke-width="6"`、`:show-text="false"`、`:status` = exception |
| [OverviewPanel.vue:195](../tools/telegram-cache/renderer/components/OverviewPanel.vue#L195) | `:stroke-width="6"`、`:show-text="false"`、`:status` = warning ≥ 95% |
| [TasksPanel.vue:72](../tools/telegram-cache/renderer/components/TasksPanel.vue#L72) | `:stroke-width="6"`、`:show-text="false"`、`:status` = success |

### 7.2 API

```ts
withDefaults(defineProps<{
  percentage: number                    // 内部 clamp 到 0–100
  strokeWidth?: number                  // 默认 6（当前三处手写值的收敛）
  showText?: boolean                    // 默认 false（当前四处一致）
  status?: 'success' | 'warning' | 'exception'   // 走 EP 语义色，不自造颜色
}>(), { strokeWidth: 6, showText: false })
```

实现：包一层 `el-progress`，`class="ui-progress"`，`percentage` 先 `Math.min(100, Math.max(0, …))`。**不自绘**——EP 的 `status` 已把成功/警告/异常映射到语义色并可访问，重写无收益。

### 7.3 替换清单

| 文件 | 替换 |
| --- | --- |
| `DownloadSection.vue` | `<UiProgress :percentage="percentage(progress)" />` |
| `DiagnosticsPanel.vue` | `<UiProgress :percentage="mtProgress" :status="mtActive.phase === 'failed' ? 'exception' : undefined" />` |
| `OverviewPanel.vue` | `<UiProgress class="cache-bar" :percentage="cacheUsagePercent" :status="cacheUsagePercent >= 95 ? 'warning' : undefined" />`（`.cache-bar` 的 `margin-top` 保留在业务侧） |
| `TasksPanel.vue` | `<UiProgress :percentage="progressOf(row)" :status="row.status === 'completed' ? 'success' : undefined" />` |

验收：四处进度条高度一致（6px）、圆角一致；`status` 三态颜色分别对齐 `--color-success` / `--color-warning` / `--color-error`；半透明模式下轨道随 `--color-fill` 透出。

---

## 8. Step 2D · 新增 `UiTable`（B4）

### 8.1 现状与收益

14 张表 / 11 文件（附录 B 全量），当前每张表都重复写 `size="small"`，带 loading 的另写 `v-loading`（1 处），空态文案有 8 处 `empty-text`、1 处靠 `v-if` + `UiPanel` 兜底（HistorySection），另有 5 处 `:deep` 只为微调表格密度/字体/指针（B5 的目标）。

`UiTable` 的收益：**密度、空态、loading、等宽表格、可点行**五件事各写一次；表格几何将来只改一个组件。

### 8.2 API

```ts
withDefaults(defineProps<{
  data: unknown[]
  loading?: boolean                     // 内部 v-loading（指令由 unplugin-vue-components 解析）
  emptyText?: string                    // 默认「暂无数据」；空态渲染 UiEmpty
  height?: string | number              // 固定高度（8 处在用）
  maxHeight?: string | number           // 最大高度（2 处在用：id-card 340 / Docker 240）
  rowKey?: string
  mono?: boolean                        // 整表等宽（吸收 id-card 的 :deep(.el-table__cell) 字体覆写）
  rowClickable?: boolean                // hover 指针（吸收 TrafficPanel 的 :deep(.el-table__row) cursor）
}>(), { loading: false, mono: false, rowClickable: false })
```

**其余能力靠属性透传**：`UiTable` 是单根组件且不声明这些 props/emits，Vue 会自动把未声明的属性与监听器落到根上的 `el-table`，因此 `@row-click`、`@row-dblclick`、`@sort-change`、`row-class-name`、`:tree-props`、`default-expand-all`、`class` **都不需要在 UiTable 里转发**。这是 wxp-enhancer 树形表格（`:tree-props` + `default-expand-all`）能无痛接入的前提。

模板骨架：

```vue
<el-table
  v-loading="loading"
  :data="data" :height="height" :max-height="maxHeight" :row-key="rowKey"
  size="small" class="ui-table"
  :class="{ 'is-mono': mono, 'is-row-clickable': rowClickable }"
>
  <slot />
  <template #empty>
    <slot name="empty">
      <UiEmpty center :text="emptyText ?? '暂无数据'" padding="var(--spacing-xl)" />
    </slot>
  </template>
</el-table>
```

局部样式（仅两条，均走令牌）：

```css
.ui-table.is-mono :deep(.el-table__cell) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.ui-table.is-row-clickable :deep(.el-table__row) { cursor: pointer; }
```

> 这两条 `:deep` 属于 `Ui*` 封装内部（§9 口径 A），允许存在。

### 8.3 接入清单（逐表）

| 文件:行 | 现有 props | 目标调用 |
| --- | --- | --- |
| [IdCardGeneratorPage.vue:119](../tools/id-card-generator/renderer/pages/IdCardGeneratorPage.vue#L119) | `size` + `max-height="340"` + `.result-table` | `<UiTable :data="results" max-height="340" mono>` |
| [DockerDownloader.vue:391](../tools/offline-pack/renderer/components/DockerDownloader.vue#L391) | `size` + `max-height="240"` | `<UiTable :data="manifest.layers" max-height="240">` |
| [HistorySection.vue:117](../tools/offline-pack/renderer/components/HistorySection.vue#L117) | `v-if` + `v-loading` + `size` | `<UiTable :data="items" :loading="loading" empty-text="暂无下载记录">`（外层 `UiPanel` 可保留，空态改由 `UiTable` 提供） |
| [DiagnosticsPanel.vue:673](../tools/telegram-cache/renderer/components/DiagnosticsPanel.vue#L673) | `size` + `height="220"` + `empty-text` | `<UiTable :data="benchmarkRecords.slice(0, 10)" height="220" empty-text="…">` |
| [OverviewPanel.vue:211/231/256](../tools/telegram-cache/renderer/components/OverviewPanel.vue#L211) | `size` + `height` + `empty-text` | 三处同构替换 |
| [ResourcesPanel.vue:114/187](../tools/telegram-cache/renderer/components/ResourcesPanel.vue#L114) | `size` + `height` + `empty-text` | 两处同构替换 |
| [TasksPanel.vue:50](../tools/telegram-cache/renderer/components/TasksPanel.vue#L50) | `size` + `height="520"` + `empty-text` | `<UiTable :data="store.tasks" height="520" empty-text="…">` |
| [RulesPanel.vue:729](../tools/interceptor/renderer/components/RulesPanel.vue#L729) | 多行 props + `@sort-change` + `@row-dblclick` + `row-class-name` | `<UiTable :data="visibleRules" …>`（事件与 `row-class-name` 透传）；置顶行高亮保留业务 `:deep` |
| [TargetsPanel.vue:109](../tools/interceptor/renderer/components/TargetsPanel.vue#L109) | `row-key="id"` + `empty-text` | `<UiTable :data="store.targets" row-key="id" empty-text="…">` |
| [TrafficPanel.vue:86](../tools/interceptor/renderer/components/TrafficPanel.vue#L86) | `height="460"` + `@row-click` | `<UiTable :data="filteredTraffic" height="460" row-clickable @row-click="openDetail">`，删除业务 `:deep(.el-table__row)` |
| [WxpEnhancerPage.vue:489](../tools/wxp-enhancer/renderer/pages/WxpEnhancerPage.vue#L489) | 树形表格：`row-key` + `:tree-props` + `default-expand-all` | `<UiTable :data="favTree" row-key="id" :tree-props="{ children: 'children' }" default-expand-all>`（透传） |

**保留不变**：`<el-table-column>` 子元素一律不动（列宽/`show-overflow-tooltip`/排序都是列级配置，包一层反而丢灵活性）。

### 8.4 风险

| 风险 | 处理 |
| --- | --- |
| `v-loading` 指令在封装组件内是否解析 | `unplugin-vue-components` 默认 `directives: true`，HistorySection 现已在用；B4 首个接入即验证 |
| 属性/事件透传是否完整 | 单根组件 + 不声明这些 props/emits → 自动透传；wxp 树形表格是验收样本（`tree-props` / `default-expand-all`） |
| `height` / `max-height` 语义不同 | API 分开暴露，禁止互转（`height` 固定 + 内部滚动，`max-height` 自适应到上限） |
| 空态由 EP 默认文案换成 `UiEmpty` | 8 处 `empty-text` 文案逐字保留，只换渲染层；空态高度变化需目测（表格空态区高度由行数决定，`UiEmpty` 有 padding） |
| `mono` 表整表等宽影响列宽 | 只用于 id-card（身份证号）/ Docker 层摘要；接入后检查列宽是否溢出 |

### 8.5 验收

- [ ] 业务文件里 `grep '<el-table[ >]'` = 0（UiTable.vue 内部 1 处；`el-table-column` 不计）。
- [ ] 14 张表：列宽/排序/横向滚动/空态/loading 五项逐个过。
- [ ] RulesPanel 排序（`sortable="custom"` + `@sort-change`）行为不变。
- [ ] TrafficPanel 行点击打开详情、行 hover 指针正常。

---

## 9. Step 3 · `:deep(.el-*)` 归位（B5）

### 9.1 三档口径

| 档 | 范围 | 基线 | 目标 | 说明 |
| --- | --- | --- | --- | --- |
| A | `Ui*` 封装内部 | 7 | 12（新增 UiTable/UiProgress） | EP 类名知识允许只在这一层 |
| B | 应用外壳标题栏（App.vue） | 4 | 4（保留 exception） | 标题栏专用 card tabs（34px、no-drag、关闭图标常驻），与业务表格/表单无关，迁全局只会把 app-shell 细节塞进主题层 |
| C | **业务组件** | 15 | **8** | 真正要消灭的部分 |

### 9.2 26 处逐条去向

| # | 位置 | 作用 | 实际处理 |
| --- | --- | --- | --- |
| 1 | [UiSearchInput.vue:67/87/94/100/104](../renderer/shared/components/ui/UiSearchInput.vue#L67) | pill/box 输入框几何 | **保留**（A） |
| 2 | [UiPathField.vue:53](../renderer/shared/components/ui/UiPathField.vue#L53) | 等宽字体 | **保留**（A） |
| 3 | [App.vue:344/351/356/360](../renderer/App.vue#L344) | 标题栏 card tabs | **保留 exception**（B）：见 §9.1 理由 |
| 4 | [EnvBrowserPage.vue:420](../tools/env-browser/renderer/pages/EnvBrowserPage.vue#L420) | 环境页签 header（`margin: 0`） | **保留 exception**（C）：单行几何，包一层 tab 变体收益低于复杂度 |
| 5 | [StatusPanel.vue:145](../tools/chrome-sandbox/renderer/components/StatusPanel.vue#L145) | `el-tag` 宽度自适应 | **已删除**（B2 迁 `UiChip`） |
| 6 | [IdCardGeneratorPage.vue:187](../tools/id-card-generator/renderer/pages/IdCardGeneratorPage.vue#L187) | 整表等宽 | **已删除**（`UiTable mono`） |
| 7 | [TrafficPanel.vue:259](../tools/interceptor/renderer/components/TrafficPanel.vue#L259) | 行指针 | **已删除**（`UiTable row-clickable`） |
| 8 | [ResourcesPanel.vue:262](../tools/telegram-cache/renderer/components/ResourcesPanel.vue#L262) | cell 上下 4px | **已删除**（B1 全局表格密度） |
| 9 | [TasksPanel.vue:153](../tools/telegram-cache/renderer/components/TasksPanel.vue#L153) | cell 上下 4px | **已删除**（同上） |
| 10 | RulesPanel `dest-radio-group` / `request-body-mode-group` 的 `.el-radio` 覆写（2 处） | radio 间距 / 行高 | **已删除**：改用全局工具类 `.radio-flush`（与 `.btn-flush` 同构，写进 `utilities.scss`），间距交给 `gap` |
| 11 | [RulesPanel.vue:1392/1400/1404](../tools/interceptor/renderer/components/RulesPanel.vue#L1392) | `el-menu` 侧栏菜单 | **例外保留**（C）：全项目唯一 `el-menu`，样式与规则类型分组强耦合 |
| 12 | [RulesPanel.vue:1480](../tools/interceptor/renderer/components/RulesPanel.vue#L1480) | 规则标题输入字号 | **例外保留**（C）：编辑器内专属排版 |
| 13 | [RulesPanel.vue:1257](../tools/interceptor/renderer/components/RulesPanel.vue#L1257) | 置顶行左侧高亮 | **例外保留**（C）：业务状态可视化 |
| 14 | RulesPanel `.dest-input` 输入框底色（1 处） | 让输入框与 raised 面板同底 | **例外保留**（C）：有意的层次差异，不是全局密度 |

**结果**：`A 12 + B 4 + C 8 = 24`（脚本实测 23，`UiChip` 无 deep 规则）。业务侧 15 → **8**：删 5 处、`.radio-flush` 抵 2 处；剩余 8 处中 7 处在 `RulesPanel`（唯一的重交互编辑器）、1 处是环境页签单行几何，每处都带注释。

### 9.3 剩余 exception 清单（需长期保留）

| 位置 | 为什么不能归位 |
| --- | --- |
| `App.vue` ×4 | 标题栏 card tabs：34px 行高、`-webkit-app-region`、关闭图标常驻占位，属 app-shell 而非 EP 主题 |
| `EnvBrowserPage.vue` ×1 | 环境页签仅需 `header { margin: 0 }`，为单行几何建变体不划算 |
| `RulesPanel.vue` ×7 | `el-menu` 分组侧栏（3）、规则标题字号（1）、置顶行高亮（1）、目标输入框底色（1）、请求体模式 radio 标签字号（1）——全部是编辑器内语义，不是可复用的密度规则 |

### 9.4 验收

- [x] 业务侧 `:deep(.el-*)` 由 15 降到 8，`pnpm check:ui` 断言通过（≤8）。
- [ ] EnvBrowser 环境页签视觉与迁移前一致（未改动）。
- [ ] RulesPanel：radio 间距（改 `gap`）、目标输入框、菜单选中态与迁移前对比（截图对照）。

---

## 10. 验证与回归

### 10.1 自动

```bash
pnpm lint
pnpm typecheck
pnpm check:ui   # EP 用法断言（--strict：el-tag / el-empty 归零、el-progress / el-table ≤1、业务侧 :deep ≤8）
```

沙箱环境下 `pnpm vite build` 会因 `spawn EPERM` 失败（vite 需要子进程），改用临时 SFC 编译校验脚本（本轮 offline-pack 重构时用过同一手法）：用 `@vue/compiler-sfc` 的 `parse` + `compileScript` + `compileTemplate` 逐个编译改动文件。

### 10.2 手工回归清单（按批次勾选）

| 批次 | 必测路径 |
| --- | --- |
| B1 | 每张表（14 张）行高/表头；8 处 alert；按钮五态；输入/选择高度 |
| B2 | interceptor 流量表状态列（14 处 tag）、chrome-sandbox 卡片标签、treease 长文本标签 |
| B3 | offline-pack 下载进度；telegram-cache 三处进度（含 warning/exception 态）；规则空态 |
| B4 | §8.5 五项；另加 RulesPanel 排序、TrafficPanel 行点击 |
| B5 | EnvBrowser 与 App 页签对照；RulesPanel 三处 exception 目测 |
| B6 | 11 个工具 + 设置页冒烟；五种窗口外观 × 玻璃/alpha 组合 |

### 10.3 外观矩阵

五种窗口外观（默认 / acrylic / mica / tabbed / transparent-only）× 六类表面（卡片 / 表格 / 弹层 / 输入 / 按钮 / 标签），重点看是否出现「不透明死白」与「双层模糊」。

---

## 11. 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
| --- | --- | --- | --- |
| EP 样式懒加载晚于全局文件 | B1 规则被盖回 | 带 `html` 前缀（已有先例） | 单文件 revert |
| `UiChip` variant 默认值改变现有观感 | 32 处 chips 变化 | `auto` 默认严格等价现状；先合 variant，再逐个换 tag | 组件单文件 revert |
| `UiTable` 空态高度变化 | 表格区域跳动 | `UiEmpty` padding 取 `--spacing-xl`，接近 EP 默认 | 单表回退为 `el-table` |
| 表格密度全局化影响 14 张表 | 行高整体变化 | B1 单独发布 + 截图对照；B1 同批删掉两处已有的 4px 覆写，避免叠成 8px | element-plus.scss revert |
| `:deep` 归位遗漏 | 局部视觉回退 | §9.2 表格逐条勾选 + 业务 exception 注释 | 按文件 revert |

每批一个 commit / PR，commit message 前缀：`refactor(ui/ep-收敛): B<n> …`。

---

## 12. 工作量与依赖

| 批次 | 人日 | 前置 |
| --- | --- | --- |
| B0 | 0.1 | — |
| B1 | 0.5–1 | B0 |
| B2 | 0.5–1 | B1 |
| B3 | 0.25 | B1 |
| B4 | 1 | B1 |
| B5 | 1 | B2–B4 |
| B6 | 1 | 全部 |
| 合计 | **4.4–5.4（含缓冲取 4–6）** | |

---

## 13. 文档同步项（B6 内完成）

- [ ] DESIGN.md §5.2 数据展示：新增 `UiTable`、`UiProgress` 两行（props / 说明 / 何时用）。
- [ ] DESIGN.md §5.3：`UiChip` 增加 `variant`（auto/soft/solid/outline）与映射规则。
- [ ] DESIGN.md §7.5 表格：改为「统一用 `UiTable`（内部 `el-table size="small"`）」，并写明 `mono` / `rowClickable` 用法。
- [ ] AGENTS.md「UI 组件库」段落：组件数 25 → 27；补一句「表格与进度条必须走 `UiTable` / `UiProgress`」。
- [ ] AGENTS.md 文件定位速查：新增本计划文档一行。

---

## 14. 后续可选批次（不在本计划内，需另行评估）

本计划只覆盖「重复模式最明显、收益/风险比最好」的四类组件。若之后想把 EP 接触面从 32 种继续压到 ~20 种，候选顺序（按性价比排序）：

| 候选 | 规模 | 收益 | 结论 |
| --- | --- | --- | --- |
| `el-select` + `el-option` → `UiSelect` | 7 文件 / 21 处 | 统一下拉密度与空态；`filterable`/`allow-create` 仍由 EP 承担 | 建议做（0.5–1 d） |
| `el-form` / `el-form-item` → `UiFormItem` | 10 文件 / 39 处 | 统一标签宽度、必填星号、间距（EP 校验逻辑不变） | 建议做（0.5–1 d） |
| `el-checkbox` / `el-radio*` → `UiCheckbox` / `UiRadio` | 4 文件 / 27 处 | 与 `el-radio-button` 分段钮规范对齐 | 可选 |
| `el-menu` → `UiSideMenu` | 1 文件 / 3 处 | 消掉 RulesPanel 的 3 处 exception | 可选（与规则面板重构合并做） |
| `el-tooltip` / `el-dropdown` / `el-popover` → `Ui*` | 2 文件 / 9 处 | 收口浮层玻璃实现 | 收益低，暂缓 |
| `el-tabs` → 保留 | 2 处 | 标题栏/环境页签是「可关闭标签」，与视图切换语义不同 | **不做** |
| `el-alert` → 保留 | 8 处 | B1 已令牌化 | **不做** |

---

## 15. 实施结果（2026-10-26）

### 15.1 交付物

| 批次 | 交付 | 位置 |
| --- | --- | --- |
| B0 | EP 接触面度量 / 断言脚本，新增 `pnpm check:ui` | [scripts/ui-ep-check.mjs](../scripts/ui-ep-check.mjs)、[package.json](../package.json) |
| B1 | 视觉收紧：控件尺寸 / 按钮圆角 / 表格字阶与密度 / `el-alert` 半透明底色 | [element-plus.scss](../renderer/shared/styles/element-plus.scss) |
| B2 | `UiChip` 新增 `variant`（auto/soft/solid/outline，auto 严格等价旧观感）；36 处 `el-tag` → `UiChip`；删 1 处 `:deep(.el-tag)` | [UiChip.vue](../renderer/shared/components/ui/UiChip.vue) + 9 个业务文件 |
| B3 | 新增 `UiProgress`（4 处接入）；`el-empty` → `UiEmpty` | [UiProgress.vue](../renderer/shared/components/ui/UiProgress.vue)、[RulesPanel.vue](../tools/interceptor/renderer/components/RulesPanel.vue) |
| B4 | 新增 `UiTable`（14 张表接入）；删 2 处表格专用 `:deep` | [UiTable.vue](../renderer/shared/components/ui/UiTable.vue) + 11 个业务文件 |
| B5 | 新增全局 `.radio-flush` 工具类，删 2 处 radio `:deep`；删 2 处 cell 密度 + 1 处 tag 宽度 | [utilities.scss](../renderer/shared/styles/utilities.scss)、[RulesPanel.vue](../tools/interceptor/renderer/components/RulesPanel.vue) |
| B6 | DESIGN.md（组件表 / UiChip variant / 表格规范 / `.radio-flush`）、AGENTS.md（27 组件 / 用法硬约束 / 命令与定位表） | [DESIGN.md](../DESIGN.md)、[AGENTS.md](../AGENTS.md) |

### 15.2 与计划的偏差（都是有理由的收缩）

| 计划 | 实际 | 原因 |
| --- | --- | --- |
| `App.vue` 4 处 tabs 迁全局 `.el-tabs--bar` | **后续改为自研页签** | 标题栏页签需要浏览器式拖拽排序与自定义拖拽浮层，已改为 `HeaderTabs.vue`（不再使用 `el-tabs`），原 exception 失效 |
| 业务侧 `:deep` 目标 ≤5 | **实测 8** | 其中 7 处在 `RulesPanel`（菜单 / 标题字号 / 置顶行 / 输入底色 / radio 标签字号），都是编辑器内语义；再压只能造一次性工具类，违背「反过度设计」 |
| `el-progress` / `el-table` 归零 | **各 1 处（封装内部）** | 组件基座本身必须写 EP 标签，断言已限定「业务文件 0」 |
| `el-tag` 迁移覆盖 36 处 | 36 处全部迁移 | — |
| 表格密度只在 B1 动 | 同批删掉 telegram-cache 两处 4px 覆写 | 否则全局 4px + 原 4px 会叠成 8px |

### 15.3 验证记录

| 项 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm check:ui --strict` | 5/5 PASS（el-tag 0、el-empty 0、el-progress 1、el-table 1、业务侧 `:deep` 8） |
| `@vue/compiler-sfc` 全量编译 | 69 个 SFC + 2 个 SCSS 全部通过（沙箱内 `vite build` 会 `spawn EPERM`） |
| 视觉回归（5 种窗口外观 × 表格 / 弹层 / 标签） | **待执行**（见 §10.2、§10.3） |

### 15.4 遗留

- 手工视觉回归：§10.2 逐批清单 + §10.3 五种窗口外观矩阵（需要在 Electron 里点一遍，含 RulesPanel 的 radio 间距与表格行高）。
- 后续可选批次见 §14（`el-select` / `el-form` 封装，可把 34 种继续压到 ~24 种）。

---

## 附录 A · `el-tag` 36 处逐条映射

规则见 §5.3。`plain` = 原 `effect="plain"`。

| 文件:行 | 原 type / effect | 目标 |
| --- | --- | --- |
| chrome-sandbox/SandboxCard.vue:26 | danger / plain | `tone="danger" variant="outline"` |
| chrome-sandbox/SandboxCard.vue:29 | danger / plain | `tone="danger" variant="outline"` |
| chrome-sandbox/SandboxCard.vue:32 | info / plain | `tone="info" variant="outline"` |
| chrome-sandbox/StatusPanel.vue:37 | success / info 条件 | `:tone="… ? 'success' : 'info'" variant="soft"` |
| chrome-sandbox/StatusPanel.vue:56 | success / info 条件，plain | `:tone` + `variant="outline"` |
| chrome-sandbox/StatusPanel.vue:64 | danger / plain | `tone="danger" variant="outline"` |
| chrome-sandbox/StatusPanel.vue:67 | danger / plain | `tone="danger" variant="outline"` |
| env-browser/EnvCard.vue:24 | success | `tone="success" variant="soft"` |
| interceptor/InterceptorStatusPanel.vue:123 | success / info 条件 | `:tone` + `variant="soft"` |
| interceptor/InterceptorStatusPanel.vue:163 | 无 | `tone="neutral" variant="outline"`（appId 元信息） |
| interceptor/InterceptorStatusPanel.vue:167 | success / warning 条件 | `:tone` + `variant="soft"` |
| interceptor/InterceptorStatusPanel.vue:216 | 动态 `caTagType` | `:tone="caTone"` + `variant="soft"`（原 type 映射到同义 tone） |
| interceptor/TargetsPanel.vue:70 | success | `tone="success" variant="soft"` |
| interceptor/TrafficPanel.vue:110 | danger | `tone="danger" variant="soft"` |
| interceptor/TrafficPanel.vue:113 | 动态 `statusTagType` | `:tone` + `variant="soft"` |
| interceptor/TrafficPanel.vue:126 | danger | `tone="danger" variant="soft"` |
| interceptor/TrafficPanel.vue:129 | warning | `tone="warning" variant="soft"` |
| interceptor/TrafficPanel.vue:132 | info | `tone="info" variant="soft"` |
| interceptor/TrafficPanel.vue:135 | warning / plain | `tone="warning" variant="outline"` |
| interceptor/TrafficPanel.vue:138 | info / plain | `tone="info" variant="outline"` |
| interceptor/TrafficPanel.vue:157 | 无 | `tone="neutral" variant="outline"`（method） |
| interceptor/TrafficPanel.vue:160 | 动态 `statusTagType` | `:tone` + `variant="soft"` |
| interceptor/TrafficPanel.vue:163 | danger | `tone="danger" variant="soft"` |
| interceptor/TrafficPanel.vue:166 | warning | `tone="warning" variant="soft"` |
| interceptor/TrafficPanel.vue:169 | info | `tone="info" variant="soft"` |
| interceptor/TrafficPanel.vue:172 | warning | `tone="warning" variant="soft"` |
| interceptor/TrafficPanel.vue:175 | info | `tone="info" variant="soft"` |
| telegram-cache/OverviewPanel.vue:274 | danger | `tone="danger" variant="soft"` |
| telegram-cache/OverviewPanel.vue:277 | 动态 | `:tone` + `variant="soft"` |
| telegram-cache/TasksPanel.vue:53 | 动态 `statusInfo().type` | `:tone="statusInfo(row.status).tone"` + `variant="soft"`（`statusInfo` 需同步改返回 tone） |
| treease-editor/TreeaseEditorPage.vue:346 | success | `tone="success" variant="soft"` |
| treease-editor/TreeaseEditorPage.vue:349 | info | `tone="info" variant="soft"` |
| treease-editor/TreeaseEditorPage.vue:352 | warning | `tone="warning" variant="soft"` |
| treease-editor/TreeaseEditorPage.vue:396 | danger | `tone="danger" variant="soft"` |
| treease-editor/TreeaseEditorPage.vue:454 | success | `tone="success" variant="soft"` |
| treease-editor/TreeaseEditorPage.vue:457 | info | `tone="info" variant="soft"` |

> 动态取值的两处（`statusTagType()` / `statusInfo()`）需要把函数返回值从 EP 的 `type` 字面量改为 `UiChip` 的 `tone` 字面量，**同名同义**，只改类型标注与返回值。

---

## 附录 B · `el-table` 14 处现状

| 文件:行 | height / max-height | empty-text | v-loading | 特殊需求 |
| --- | --- | --- | --- | --- |
| id-card-generator:119 | max 340 | — | — | 整表 mono |
| interceptor/RulesPanel:729 | — | — | — | `row-class-name` + `@row-dblclick` + `@sort-change`、置顶行高亮 |
| interceptor/TargetsPanel:109 | — | ✅ | — | `row-key="id"` |
| interceptor/TrafficPanel:86 | 460 | ✅ | — | `@row-click` + 指针 |
| offline-pack/DockerDownloader:391 | max 240 | — | — | — |
| offline-pack/HistorySection:117 | — | 外部 UiEmpty | ✅ | 空态由面板兜底 |
| telegram-cache/DiagnosticsPanel:673 | height 220 | ✅ | — | — |
| telegram-cache/OverviewPanel:211 | height 180 | ✅ | — | — |
| telegram-cache/OverviewPanel:231 | height 180 | ✅ | — | — |
| telegram-cache/OverviewPanel:256 | height 260 | ✅ | — | — |
| telegram-cache/ResourcesPanel:114 | height 420 | ✅ | — | cell 4px 密度 |
| telegram-cache/ResourcesPanel:187 | height 240 | ✅ | — | cell 4px 密度 |
| telegram-cache/TasksPanel:50 | height 520 | ✅ | — | cell 4px 密度 |
| wxp-enhancer:489 | — | — | — | **树形表格**：`row-key` + `:tree-props` + `default-expand-all` |

---

## 附录 C · 全局样式层现状（Step 1 的改动基线）

| 区块 | 行 | 现状 |
| --- | --- | --- |
| `:root` 令牌绑定 | 4–46 | 颜色/圆角/底色/按钮变量；**缺** `--el-component-size` |
| `.el-button` | 49–62 | `border-radius: 14px`（字面量）；primary 三态 |
| `.el-table` | 64–79 | 圆角 lg、表头/行 hover/tr-bg；**缺**字号、表头字重、cell 密度 |
| 输入类 wrapper | 86–101 | field 角色 + 边框 + 聚焦环（已令牌化） |
| `el-input-number` 控件底色 | 110–113 | 已处理 |
| dialog / popper / 下拉 / message / message-box | 115–207 | 已令牌化 + 玻璃 |
| `html .el-switch` | 251–265 | 注入顺序先例（带 `html` 前缀） |
| `el-radio-button` | 268–286 | 分段钮统一 |
| **未覆盖** | — | `el-tag`、`el-alert`、`el-collapse`、`el-menu`、`el-checkbox`（`el-progress` 颜色已随 `--el-border-color-lighter` 生效，缺的是封装，见 §7） |

---

## 附录 D · 基线采集命令（PowerShell）

```powershell
# 1) 各 el-* 组件出现次数 / 文件数
$files = Get-ChildItem -Recurse -Include *.vue -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\release\\' }
$m = Select-String -Path $files.FullName -Pattern '<el-[a-z0-9-]+' -AllMatches
$m | ForEach-Object { $_.Matches } | ForEach-Object { $_.Value.Substring(1) } |
  Group-Object | Sort-Object Count -Descending |
  ForEach-Object { '{0,-18} {1,4} 处' -f $_.Name, $_.Count }

# 2) 组件内 :deep(.el-*)
Select-String -Path $files.FullName -Pattern ':deep\(\.el-' |
  ForEach-Object { '{0}:{1}  {2}' -f $_.Path, $_.LineNumber, $_.Line.Trim() }

# 3) 全局 .el-* 选择器
(Select-String -Path renderer\shared\styles\*.scss -Pattern '\.el-[a-zA-Z0-9_-]+' -AllMatches |
  ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum

# 4) Step 验收断言
(Select-String -Path $files.FullName -Pattern '<el-tag\b').Count           # 期望 0（B2 后）
(Select-String -Path $files.FullName -Pattern '<el-empty\b').Count         # 期望 0（B3 后）
(Select-String -Path $files.FullName -Pattern '<el-progress\b').Count      # 期望 1（仅 UiProgress.vue 内部）
(Select-String -Path $files.FullName -Pattern '<el-table[ >]').Count       # 期望 1（仅 UiTable.vue 内部；el-table-column 不计）
```

> 断言 3/4 的「1」是封装组件自身，业务文件必须为 0：用 `Select-String … | Where-Object { $_.Path -notmatch 'components\\ui\\Ui(Table|Progress)\.vue' }` 过滤后再计数。
