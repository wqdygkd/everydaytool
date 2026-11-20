# AGENTS.md

everydaytool（`edt`，包名 `everydaytool`）多功能工具平台的**工程约定**：目录边界、编码规范、IPC 约束、左轨 / 标题栏 / 路由机制、窗口状态持久化、命令与文件定位。

> **UI 设计规范不在本文件**：设计令牌、组件库、布局与动效、半透明与玻璃的唯一权威是 [DESIGN.md](./DESIGN.md)。改任何 UI 之前先读它的 §3（令牌）、§5（外壳）、§6（首页）、§8（工具页）、§13（布局基线）。

## 项目概览

Electron + Vue 3 + Pinia + Reka UI + Vite + SCSS 多工具平台，内置 8 个工具模块（interceptor / offline-pack / treease-editor / wxp-enhancer / id-card-generator / skill-manager / tweb-cache / workbuddy2api-panel）。

## 文档结构

- **平台整体方案**：工程约定、目录边界、IPC、外壳与路由机制只维护在本文件；UI 令牌、组件与布局只维护在 [DESIGN.md](./DESIGN.md)。
- **每个工具的设计细节**：`docs/<tool-id>.md`，一个工具一份，记录数据模型、关键事务、已知坑与验收手法；工具之间不共用文档。
- **`docs/` 只写当前方案**：不写过程记录、计划或静态设计稿；`docs/preview/` 只保留被 DESIGN 或工具文档引用的交互样张。
- 新增工具时同步建 `docs/<tool-id>.md`（无后端、无持久化的纯前端工具可省），并在本文件的「模块记忆」表登记。

## 编码规范

- 前端（`renderer/**`、`tools/*/renderer/**`、`tools/*/index.ts`）：TS 相对导入无后缀，Vue SFC 保留 `.vue`。
- Electron/后端（`electron/**`、`backend/**`、`tools/*/backend/**`）：Node ESM，源码相对 TS 导入写 `.ts` 后缀（`scripts/build-electron.mjs` 的 esbuild 插件在产物中还原为 `.js` 运行时后缀）。
- 构建是 **`bundle: false` 的逐文件转译**（不内联依赖）：`electron/*.ts` / `backend/**` / `shared/**` / `tools/*/backend/**` 会被当作入口逐个产出，`electron/` 与工具后端都是**自动发现**、新增文件不必登记（`preload.ts` 例外，单独打成 cjs）。新增主进程模块后必须确认产物里真有对应 `.js`——漏产出会在运行期以 `ERR_MODULE_NOT_FOUND` 崩在启动瞬间。
- 前端禁止直接 `import backend/**` 或 `import tools/*/backend/**`，必须经 preload 暴露的 IPC API 调用（`renderer/shared/ipc/createIpcHelpers` 工厂）。**每个工具的 `renderer/ipc.ts` 是唯一 helper 实例**，store / 页面不得自行 `createIpcHelpers`；外链统一走 `@renderer/shared/ipc/openExternal`（不得直接摸 `window.edtRuntime`）。
- `shared/**` 只能放纯类型 / 常量 / 纯函数，不依赖 Electron、Node、文件系统存储。
- `backend/**` 是**平台级后端基建**（logger / file-ops / 应用数据根目录 data-root / JSON 文档存储 json-store），被多个工具的后端共用；工具域专属逻辑留在各自 `tools/<id>/backend/`，禁止工具间互相 import 对方的 backend。
- 本地数据一律是 JSON 文件（`backend/utils/json-store.ts`：进程内缓存 + 临时文件 rename 原子写入），**不引入数据库 / 原生依赖**。
- **数据按层归位**：配置（不可再生）`<data>/config/<工具 id>/`、资产（用户归档）`<assets>/<工具 id>/`、会话（Chromium 拥有）`<data>/session/`、缓存（可再生）`<data>/cache/<工具 id>/`。判据与清单只在 `shared/data-layers.ts`；**路径一律经 `resolveLayerPath`**（`backend/utils/data-layers.ts`），不得自己拼 `getDataDirectory()`——`pnpm data-layers:check` 会拦（连 `const root = getDataDirectory()` 这种别名也拦）。新增落点先往 `DATA_LAYER_ENTRIES` 加一条；确实不能走层的（如用户自备 `<data>/.env`）必须写 `// data-layers:allow <原因>`，原因必填、逐行生效，没有别的豁免通道。详见 [docs/data-layers.md](./docs/data-layers.md)。
- 高度链必须完整：`flex` 容器 + `flex:1` 子项需配 `min-height:0`，避免内容溢出。
- 走 Teleport 的浮层（Reka 的 `TooltipContent` / `PopoverContent` 等）**不要把 scoped class 写在库组件上**：父组件的 scopeId 传不到 teleport 出去的元素，整条 scoped 规则会静默失效。把可样式化的结构放进**本组件模板里的内层元素**（范例 `UiTooltip.vue`），或改用 `:global(...)`。
- Vue scoped 样式里的 `:global(...)` **必须把整条选择器包进去**：写 `:global(.a .b) { ... }`，不要写 `:global(.a) .b`——后者会被 scoped 编译器截断成 `.a { ... }`，样式命中祖先（例如 `.app-shell` 而不是 `.app-rail`），且不会报错。

## UI 规范的落点（工程侧）

样式与组件在代码里的位置固定，**细则见 DESIGN.md，不要在本文件另立规范**：

- 全局样式入口 `renderer/shared/styles/main.scss`（按 tokens → base → utilities → translucency 顺序 `@use`）。
- Tailwind v4 入口 `renderer/shared/styles/tailwind.css`（`source(none)` + 显式 `@source` 收敛扫描范围；主题变量在此桥接设计令牌）。
- 反馈基座 `renderer/shared/feedback/`：`confirm` / `alert` / `prompt` 的统一入口；toast 使用 `vue-sonner`。
- 平台组件库在 `renderer/shared/components/ui/`，由 `unplugin-vue-components` 自动注册（模板直接用，无需 import）。
- 组件用法硬约束（`UiTable` / `UiProgress` / `UiChip` 的强制范围）由评审与类型检查保证；业务页面优先复用平台组件。
- 样式块统一 `<style scoped lang="scss">`（需要穿透到 body 的全局块用 `<style lang="scss">`）；`eslint.config.mjs` 的 `vue/block-lang` 会拦下漏写 `lang` 的块——纯 CSS 既用不了 `@use` / mixin，`&` 嵌套也只能靠 `:is()` 展开，保留两种方言没有收益。
- **外壳底板与内容表面分层**：`.app-shell` 铺 `--color-shell`（80% 白纸），`AppRail.vue` 与 `.app-topbar` 恒 `background: transparent`、不加 `backdrop-filter`、不画边线（它们透出的是底板，不是桌面）；`ToolSurface` 在底板之上叠 `--color-sheet`（纯白 92%，正文区近实色）、不画高光。其余层次由首页面板 / 浮层 / 表格与井（`--color-well`）承担。hover 统一 7% 品牌蓝透明底，不要用白色 hover 块。详见 DESIGN §3.1、§13.3。

## 布局、左轨与标题栏（工程侧）

- **设置不是页签，也不是弹窗**：入口固定在左侧导航轨底部，点击打开 `/settings` 页。应用自带页面注册在 `renderer/config/app-tabs.ts`（含 `id` / `icon` / `description` / `routeName` / 组件），路由由 `router/routes.ts` 拍平成顶层记录并带 `meta.toolId`。首页与应用自带页面按当前路由渲染；工具页走常驻 `ToolPane`（见下条）。**应用自带页面不进已打开工具列表**：不写 `toolTabs.openIds`，不出现在左轨运行列表与「最近使用」里，也不占运行名额。
  桌面端专属页面（如设置：数据目录 / 分层用量 / 缓存清理 / 窗口大小与位置都依赖主进程）必须标 `electronOnly: true`——路由、标题栏上下文与 rail 入口统一走 `getAppTabs()` / `findAppTab()`，网页预览下该页面整体不存在（深链落到兜底回首页），不会去调不存在的 IPC。
  命名上刻意区分：`AppTab` / `APP_TABS` 指应用自带页面，**不要写成 `Shell*`**——Electron 的 `shell` 模块（`openPath` / `openExternal`）在 backend 里随处可见，两套 `shell` 并存会让阅读反复停顿。
- **左轨（`AppRail.vue`）宽 48px**，与 48px 标题栏等高（图标钮 36×36、图标 16px、圆角 11px、激活指示条 `left: -6px` 贴窗口左缘、分隔线 24px），从**整宽标题栏下方**开始；不要在 rail 上加 `padding-top` 给红绿灯让位。顺序 = 首页 → 已打开的工具（`toolTabs.openIds` 顺序，关闭即从列表移除）→ 底部固定搜索 / 设置。左轨**没有置顶 / 收藏概念**，图标**可拖拽任意换位**，松手直接重排 `toolTabs.openIds`（`setOpenOrder`）。**rail 本身恒透明**（无背景、无右缘线、无 `backdrop-filter`）；图标 hover 是 7% 品牌蓝透明底、无边框。运行列表区独立滚动（提示必须用 portal 的 `UiTooltip`，伪元素会被裁掉）；关闭钮是图标按钮的**兄弟节点**（HTML 不允许按钮嵌套）。
- **标题栏（`App.vue` 的 `.app-topbar`）铺满整宽**（`.app-shell` 是「标题栏 + `.app-body`（rail + 内容）」两行）。它是**工具页唯一的横带**：工具页上同时承载「切换器（图标 + 名称 + ▾，点击复用命令面板）+ 一行说明 + 运行状态 + 主/次操作」，首页 / 应用页承载 `EDT` 字标或页面元数据、无操作区。**标题栏恒透明**：无背景色、无 `backdrop-filter`、下沿无边框；切换器 hover 为 7% 品牌蓝透明底。macOS 红绿灯落在左侧，内容左内边距 84px 让开灯组（全屏时回到 16px）；Windows / Linux 右侧为原生按钮预留 148px。**标题栏不含页签**，但工具页的工具名是可点开的切换器，其余区域仍是窗口拖拽区。工具页的操作与状态经 `#app-topbar-actions` / `#app-topbar-state` 两个 teleport 槽位注入，**必须用 `TOOL_PANE_ACTIVE` 做 `v-if` 门控**——`ToolPane` 会让多个工具同时挂载，不门控会在顶栏叠出多套按钮。页签拖拽排序 / 键盘导航不属于当前外壳。
- **工具页常驻（打开 ≠ 当前路由）**：`App.vue` 用 `renderer/shared/components/ToolPane.vue` 把**本次会话打开过的工具**全部保持挂载，切换工具只切可见性，因此表单、滚动位置、webview guest 与 IPC 订阅都不丢；只有从左轨关闭才从 `openIds` 移除并卸载，各工具页现有的 `onUnmounted` 清理继续作为“关闭即停止”的唯一入口。未打开过的工具不挂载、不启动运行时。`toolTabs` 的 `lastRoute` 负责记住每个工具最后停留的子路由，切回来回到原页签。工具内浮层（`UiDialog` / `UiPopover` / `UiDropdown` / `UiSelect` / `UiTooltip`）经 `ui/overlay-target` 注入到所属面板，切换工具时随面板一起隐藏并主动关闭，不要改回直接 teleport 到 body。
- **`stores/toolTabs.ts`** 的职责是「已打开的工具 + 最近使用顺序」：`openIds` 与 `openedAt`（每个工具最近一次打开时间）持久化到 localStorage（key 为 `toolTabs`），`recentIds` 只存在内存里，启动时用「打开顺序」播种（后打开的更新）。首页「正在运行 / 最近打开」的相对时间读 `openedAtById`。关闭当前工具时必须**先取 `recentFallback(toolId)` 再 `close()`**——close 会把该工具从两个列表里摘掉，顺序反了就永远只能回首页。
- 工具子路由：工具定义可声明 `subRoutes`（`ToolSubRoute`，`shared/types/tool.ts`），由 `renderer/router/routes.ts` 拍平为 `/tools/<工具>/<子路径>`；子路由继承主路由组件与 `meta.toolId`（标题栏上下文与活动组件解析依赖它），主路由是纯 redirect 记录（无 component）落到第一个子路由。工具内多视图（页签 / 列表分类）优先走子路由 + 路由驱动状态，不用纯本地 ref；入口统一按 `tool-<id>` / 子路由 name 跳转。范例：interceptor（4 页签 + 10 规则类型），映射集中在 `tools/interceptor/renderer/tabs.ts`。**子视图渲染为贴在主表面左缘的竖脊（`WorkspaceSpine`，98px），不使用横排 `UiMenuHorizontal`**；只有一个子视图或单页工具不渲染竖脊。**工具页内解析子路由必须用 `useToolPath()`（`renderer/shared/composables/useToolPath.ts`），不要直接读 `useRoute().path`**：隐藏面板仍在挂载态，全局路由已经切到别的工具，直接读会把子页签重置。
- 工具页**没有第二条 header**：身份、说明、状态、主操作都在标题栏，工具条只放筛选与低频动作；statusline（31px）默认不渲染，只有确实承载低频数据时由工具自己保留。工具页表面外边距为 `0`（表面铺满主区域）；`ToolSurface` 铺 92% 纯白薄层（`--color-sheet`）、不画高光、不用外阴影（外加 1px 外缘），工具页容器不得再补底色。
- **左右布局工具的左栏表单统一用 `ToolFormPane`**（360px / 窄屏 320px，48px 标题头，内边距 16px，独立滚动，右缘 1px 分隔）；栏内分节用 `ToolFormSection`，字段用 `UiFormField` 直排。表单类工具不再自写 `config-pane` / `pane-title` / `pane-section` 一类骨架与栏目样式。
- 主壳标题栏、左轨、首页索引、工具页布局与动效的视觉规范见 [DESIGN.md](./DESIGN.md) §5.2、§5.3、§6、§8、§13（动效尊重 `prefers-reduced-motion`）；验收清单与命令见 DESIGN §13.2 / §13.4。

## 窗口外观（固定磨砂 · 工程侧）

颜色 / alpha / 玻璃的取值见 DESIGN §3.1、§13.3；**这里是工程约束**：

- **外观不可切换，也没有第二份状态**：每个平台只有一种形态——macOS `vibrancy: under-window`、Windows 11 22H2+ `backgroundMaterial: acrylic`、低版本 Windows 退回 `transparent: true`。没有开关、不落盘、没有夜色轴；判定只在 `shared/appearance.ts` 的 `resolveWindowBlur(platform, windowsBuild)`，**不要在别处再写 `process.platform ===` 分支**。
- 窗口构造参数由 `electron/main.ts` 的 `buildWindowBackdropOptions()` 一处给出：磨砂窗口 + 全透明 `backgroundColor`（Windows 额外 `thickFrame` / `roundedCorners`）。磨砂 / 透明窗口上**任何不透明底色都会把玻璃糊死**，不要在别处补 `backgroundColor`。
- 透明度只有一个调档点：`renderer/shared/styles/tokens.scss` 的 `--alpha-shell: 0.8`（外壳底板，`.app-shell` 背景）与 `--alpha-sheet: 0.92`（`ToolSurface`，基准色 `--color-sheet-base: #ffffff`，叠在底板上 ≈ 98% 白）。**不要在页面里覆盖这两层**，也不要再引入按模式分支的 alpha。
- 桌面模糊只能由窗口材质提供（CSS `backdrop-filter` 糊不到窗口背后的桌面），所以「毛玻璃」不是样式效果，而是窗口形态；霜感只放在**外壳底板**（80%），正文区保持近白——系统糊过的壁纸带灰调，透进正文区就是「蒙一层灰」。`--glass-*` 只给页面内浮层（`pop` / `overlay` / `input`），主表面与卡片一律 `none`。
- 外壳 `.app-shell` 不画外阴影：磨砂窗口是常规窗口，系统自带投影；再补 `box-shadow` 会在窗内多出一道暗边（`--shadow-window-frame` 令牌已删除）。
- 系统「降低透明度」由 `translucency.scss` 的 `prefers-reduced-transparency` 块兜底（alpha 全 1、玻璃 none）；新增表面角色时也要把它加进那个块。
- 只有 darwin / win32 有磨砂形态（darwin vibrancy、win32 acrylic；Win10 退回逐像素 alpha，仍半透明但壁纸清晰）；其它平台落到 `OPAQUE_WINDOW_BG` 实底（不在发布矩阵，仅保证不白屏）。

## 窗口大小与位置（记住上次几何）

- 主进程同样是唯一事实来源（`backend/utils/window-bounds-store.ts` → `<data>/config/app/window-bounds.json`），渲染层（设置页 →「窗口大小与位置」）只经 IPC 读取状态、提交开关 / 重置，**不自己记几何**。
- **恢复判定是纯逻辑**：`shared/window-bounds.ts` 的 `resolveWindowPlacement` 只认「仍落在某块屏工作区内、且可见面积足够拖动」的记录；外接屏拔掉 / 分辨率变小时返回 `null`，主进程改用默认尺寸让 Electron 居中——绝不允许把窗口还原到屏幕外。坐标换算 / 越界收敛都写在这里，主进程只做传参。
- `enabled` / `maximized` / `bounds` 三个字段：关闭开关即不记录也不恢复；最大化只记标记，几何恒取 `getNormalBounds()`（还原后的尺寸），下次先按普通态建窗再 `maximize()`。
- 存储走**同步** JSON 存储（`backend/utils/json-store.ts`），不用外观那套异步写：`move` / `resize` 高频触发，关窗时还必须在进程退出前落盘。写入用 400ms debounce + 值不变不写，`close` 时立刻 flush。

## 安装版与开发版并存

「装好的 everydaytool」和「`pnpm dev`」同机同时运行是**受支持场景**，靠的只有一条：应用身份（userData）按形态分开。

- `backend/utils/app-instance.ts` 的 `configureInstanceIdentity()` 必须在 `ready` 之前、**任何 `app.getPath('userData')` 读取之前**执行（`electron/main.ts` 顶部第一件事）：未打包运行（`pnpm dev` / `pnpm start`，判定沿用 `data-root.ts` 的 `isDevEnvironment`）把 userData 换成 `<appData>/<应用名>-dev`，安装版保持默认 `<appData>/<应用名>`。
- 原因：Chromium 的目录级单实例锁（`app.requestSingleInstanceLock()`）以 userData 为命名空间。共用目录时后启动的一方拿不到锁直接 `app.quit()`——表现为「装好的 app 开着，`pnpm dev` 秒退（exit 0、无报错）」。
- 同一形态内仍是单实例：dev 也不会开出第二个；`second-instance` 聚焦逻辑只作用于同一份 userData。
- 目录必须**先 `mkdir` 再 `setPath`**：userData 根不存在时 Chromium 建不出 `SingletonLock`，会被判成「已有实例」直接退出。准备失败时降级回默认 userData 并 warn（宁可抢锁也要能启动）。
- 数据根目录与此无关，本来就是分开的（dev `<仓库>/data`、安装版 `<userData>/data`）；**不要手动把两者切到同一个数据目录**——JSON store 是进程内缓存 + 原子写，双进程并发只会 last-writer-wins。
- **图标也带标识**：`electron/dev-icon.ts` 在未打包运行时把 Dock（macOS，`app.dock.setIcon`）/ 窗口与任务栏（Windows / Linux，`BrowserWindow.icon`，Windows 用 `.ico`）换成 `resources/dev/icon-dev.*`（品牌蓝底 + `edt` + 琥珀色 `DEV` 底边带）。素材由 `scripts/make-dev-icon.py` 生成（macOS 字体 + Pillow，仅生成时用，不参与构建），文件缺失时静默退回系统默认图标；安装版始终用默认图标。

## 常用命令

```bash
pnpm install      # 安装依赖（Node ≥22.18 / pnpm 10+，勿用 npm）
pnpm dev          # 开发模式（Electron + Vite），默认不自动打开 DevTools
EDT_DEVTOOLS=1 pnpm dev   # 同上，但启动时自动打开 DevTools（调试启动问题用）
pnpm web          # 纯浏览器预览（无 preload / IPC：只列 supportedTargets 含 web 的工具，桌面端专属页面不注册）
pnpm create:tool <id>     # 脚手架：新建工具目录并自动注册
pnpm vite build   # 仅构建前端
pnpm typecheck    # TS 类型检查（前端 + 后端两套 tsconfig）
pnpm test         # Node 内置 test runner（backend + 各工具测试）
pnpm data-layers:check   # 分层断言：清单一致 + 禁止绕过 resolveLayerPath 拼数据根（含别名）
pnpm lint         # ESLint（含 tools 内文件）
pnpm lint:fix     # ESLint 自动修复
pnpm build        # 完整构建
pnpm start        # 运行已构建产物
pnpm dist         # 打包安装程序
```

> **开发窗口白屏**（DevTools 控制台一串 `504 (Outdated Optimize Dep)`）＝ 依赖预构建缓存被搅乱，不是业务代码问题。两个来源都已处理：① `pnpm dev` 同时起 Renderer Vite 与 WXT，两者原本共用仓库根 `node_modules/.vite`，WXT 的优化会覆盖渲染层的 metadata 并删掉 dep 文件 → `browser-extension/wxt.config.ts` 已给它独立 `cacheDir`；② Vite 8 冷启动时 `?v=` 与 metadata 的 browserHash 可能不同步 → 渲染层 `vite.config.ts` 设了 `optimizeDeps.ignoreOutdatedRequests`（仅 dev 生效）。仍白屏时再「停 dev → 删 `node_modules/.vite` → 重跑」；`scripts/dev-electron.mjs` 会等 `/main.ts` 的 dep 哈希连续两次一致后才拉窗口。

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
  icon: 'toolbox',
  category: { key: 'general', name: '通用工具' },
  keywords: ['tool-name'],
  supportedTargets: ['win', 'mac'], // web 网页端 / win Windows / mac macOS（Linux 不在发布矩阵）
  route: {
    path: 'tool-name',
    name: 'tool-tool-name',
    component: () => import('./renderer/pages/ToolPage.vue'),
    meta: { toolId: 'tool-name', title: '工具名称' },
  },
})
```

- 路由由 `renderer/config/tools.ts` 的注册表自动汇总，无需手工登记路由。
- `meta.toolId` 必填：标题栏上下文与活动组件解析依赖它。
- 发布矩阵只含 Windows / macOS；除身份证号生成器（无 IPC 依赖）外不要声明 `web`，Linux 也不在当前发布范围。
- 依赖本机独有产物、装包时可能不存在的工具：能随包内置的在 `scripts/after-pack.mjs` 复制并在定义里标 `requiresBundledSite: true`（如 `tweb-cache` 的 `tweb/dist|public`）；确实无法分发的才标 `devOnly: true`，安装版自动隐藏。
- 工具内多视图（页签 / 分类）用 `subRoutes` + 路由驱动状态，不要用纯本地 ref（详见「布局、左轨与标题栏」）。
- **UI 一律先读 [DESIGN.md](./DESIGN.md)**：新页面优先复用 §5 的组件与 §6 的工具类，不要在业务文件里重写卡片 / 分组 / 表格 / 提示的通用样式。

## 文件定位速查

### 样式与 UI

| 查找内容 | 位置 |
| ---------- | ------ |
| 设计令牌 / 主题(浅色) | `renderer/shared/styles/tokens.scss` |
| 全局样式入口（@use 顺序） | `renderer/shared/styles/main.scss` |
| Tailwind v4 入口 / 主题变量 | `renderer/shared/styles/tailwind.css` |
| **反馈基座（confirm / alert / prompt）** | `renderer/shared/feedback/` |
| 半透明固定档 / 玻璃（合成 `--color-*`） | `renderer/shared/styles/translucency.scss` |
| **UI 组件库（面板/分组/键值/表格/进度/对话框/分裂按钮等）** | `renderer/shared/components/ui/` |
| UI 设计规范（令牌 / 组件 / 布局 / 动效） | `DESIGN.md` |

### 浏览器插件（平台层）

| 查找内容 | 位置 |
| ---------- | ------ |
| **平台浏览器插件方案** | `docs/browser-extension.md` |
| WXT 工程 / 产物 | `browser-extension/`（产物 `.output/chrome-mv3`） |
| 信封协议 / 扩展 ID / 控制端口 | `shared/extension.ts` |
| Feature 注册（interceptor 等） | `browser-extension/lib/features/` |

### 外壳与页面

| 查找内容 | 位置 |
| ---------- | ------ |
| 应用外壳 / 标题栏上下文（平台适配 / 图标 + 名称 + 说明 / 全屏） | `renderer/App.vue` |
| **应用自带页面注册（设置等，含标题栏 icon / description）** | `renderer/config/app-tabs.ts` |
| 设置页（数据目录 / 数据分层用量 / 窗口大小与位置） | `renderer/pages/SettingsPage.vue` |
| 首页工具索引（编号 / 运行状态 / 拖拽排序） | `renderer/pages/HomePage.vue` |
| 左轨（首页 / 已打开工具 / 拖拽排序 / 关闭 / 运行圆点） | `renderer/shared/components/AppRail.vue` |
| 工具页常驻容器（打开即挂载、切换只切可见性） | `renderer/shared/components/ToolPane.vue` |
| 工具页主表面（92% 纯白 `--color-sheet` + 1px 外缘，无高光 / 无外阴影） | `renderer/shared/components/workspace/ToolSurface.vue` |
| 左右布局工具的左栏骨架（48px 标题头 + 独立滚动，360px / 窄屏 320px） | `renderer/shared/components/workspace/ToolFormPane.vue` |
| 左栏分节（标题 + 说明 + 动作，默认底部分隔线） | `renderer/shared/components/workspace/ToolFormSection.vue` |
| 工具子视图竖脊（98px） | `renderer/shared/components/workspace/WorkspaceSpine.vue` |
| 已打开工具列表 + 最近使用（`openIds` / `recentIds`） | `renderer/stores/toolTabs.ts` |
| 悬停提示（portal，rail 等 overflow 容器内唯一可用方案） | `renderer/shared/components/ui/UiTooltip.vue` |
| 首页工具排序（创建时间 / 拖拽 / 合并保存顺序） | `renderer/shared/tool/tool-order.ts` |
| 工具注册 | `renderer/config/tools.ts` |
| 路由配置 | `renderer/router/routes.ts` |

### 后端与 IPC

| 查找内容 | 位置 |
| ---------- | ------ |
| IPC 通道 | `tools/interceptor/backend/ipc/channels.ts` |
| IPC 处理 | `tools/interceptor/backend/ipc/handlers.ts` |
| 拦截配置与规则（`config.json` / `rules.json`） | `tools/interceptor/backend/store/` |
| 平台后端基建（logger / file-ops / 数据根目录 / JSON 存储） | `backend/utils/` |
| 主进程日志落盘（缓存层 `app/logs`，5 MB 轮转，设置页可打开目录） | `backend/utils/logger.ts` |
| **应用身份（安装版 / 开发版 userData 隔离）** | `backend/utils/app-instance.ts` |
| **开发态图标（Dock / 任务栏 DEV 标识）** | `electron/dev-icon.ts`；素材 `resources/dev/`（`scripts/make-dev-icon.py` 生成） |
| IPC 调用方白名单（safeHandle / safeOn sender 校验） | `backend/utils/ipc-safety.ts` |
| IPC 发送方 URL 白名单（主进程 + 导航闸共用） | `backend/utils/ipc-sender.ts` |
| 路径边界守卫（路径包含 / 数据目录合法性） | `backend/utils/path-guard.ts` |
| **数据目录 / 分层 / 备份（唯一文档）** | `docs/data-layers.md` |
| **数据分层清单（归属 / 备份与清理策略）** | `shared/data-layers.ts` |
| 分层路径解析 / 按层用量 / 清缓存 | `backend/utils/data-layers.ts`、`backend/utils/data-root-scan.ts` |
| 资产根（独立归档位置 / pending 切换 / 路径守卫） | `backend/utils/assets-root.ts`；`path-guard.ts` 的 `isSafeAssetsDirectory` |
| **备份包导出 / 预检 / 恢复（.edtbackup）** | `shared/backup.ts`（格式声明）、`backend/utils/backup-format.ts`（容器）、`backend/utils/backup-service.ts`（业务） |
| 凭据静态加密（safeStorage 信封 `edt-secret:`） | `backend/utils/secret-box.ts` |
| 应用壳 UI 偏好（首页排序 / 左轨三态） | `backend/utils/ui-preferences-store.ts` |
| 清理后的状态自愈钩子（索引修剪 / 已安装重算） | `backend/utils/data-root-scan.ts` 的 `registerCacheIntegrityHandler` |
| **Chromium 会话目录（sessionData）重定向** | `backend/utils/session-data.ts` |
| 数据目录切换 | `backend/utils/data-root.ts`、`backend/utils/data-migration.ts` |
| JSON 文档存储（同步缓存 + 原子写入） | `backend/utils/json-store.ts` |
| 应用数据根目录 / 数据目录切换 | `backend/utils/data-root.ts` |
| 平台磨砂判定（vibrancy / acrylic / 逐像素 alpha）与底色常量 | `shared/appearance.ts` |
| 窗口大小 / 位置持久化（记住上次几何） | `backend/utils/window-bounds-store.ts` |
| 窗口几何恢复 / 越界收敛（纯逻辑） | `shared/window-bounds.ts` |

### 模块记忆（工具域）

| 查找内容 | 位置 |
| ---------- | ------ |
| **wxp-enhancer 模块记忆（目标应用逆向 / 注入脚本约束 / 验证手法）** | `docs/wxp-enhancer.md` |
| **offline-pack 模块记忆（下载任务 store / Docker 镜像改写 / 历史抽屉与数据落点）** | `docs/offline-pack.md` |
| **treease-editor 当前占位状态** | `docs/treease-editor.md` |
| **workbuddy2api-panel 模块记忆（托管上游二进制 / 探活 / 更新回滚）** | `docs/workbuddy2api-panel.md` |
| **tweb-cache 模块记忆（tweb 页面侧归档客户端 / 触点重放 / SW 与 PeerId 坑；安装包内置 tweb 站点，未内置时安装版隐藏）** | `docs/tweb-cache.md` |
| **skill-manager 模块记忆（skills-lock 兼容 / 安装与更新事务 / 禁用与回收站 / 预设）** | `docs/skill-manager.md` |
| **interceptor 模块记忆（MITM / 证书 / 规则 / 流量与扩展桥）** | `docs/interceptor.md` |
