# 布局验收基线

> 视觉契约与结构数值以 [`DESIGN.md`](../DESIGN.md) §13 为准；本文只保留可执行验收、命令与边界。

## 1. 必过验收

1. 八个工具与首页在 1440×900 下的横带 / 工作区落在 `DESIGN.md` §8.7 的数值上（±2px）。
2. 任何工具页都不得出现第二条横带、横排子导航或默认 statusline。
3. macOS 标题栏左内边距 84px；Windows / Linux 右侧预留 148px，不与窗口控件重叠。
4. 实底、半透明、玻璃三档在深浅壁纸上文字对比度 ≥ 4.5:1（正文 / 小字）、≥ 3:1（大字号）。
5. 首页 `1`–`8` 直启、`Ctrl/Cmd+K` 搜索、tweb 分隔条可拖且受 360–760px 约束。
6. `ToolPane` 常驻：切换工具不卸载，关闭工具必须卸载；未打开过的工具不挂载。
7. 透明外壳：左轨、标题栏、工具页容器的计算背景均为 `rgba(0,0,0,0)`；工具页外边距为 `0`；标题栏 `border-bottom-width: 0`。
8. hover：外壳图标 / 工具切换器 / 首页工具行 7% 品牌蓝，星标 6%，不得出现白色块。
9. 控制台除既有 Vue `defineAsyncComponent` 与 `<webview>` 自定义元素提示外无新增错误。

## 2. 命令

```bash
pnpm typecheck
pnpm lint
pnpm data-layers:check
pnpm vite build
```

## 3. 行为检查

- 打开工具 A 再打开 B：DOM 中存在两个 `ToolPane`，只有 B 可见；切回 A 保留表单、滚动与 webview 状态。
- 回首页：已打开工具保持挂载；关闭工具后对应根节点、webview guest、IPC 订阅与定时器全部消失。
- 工具内浮层经 `ui/overlay-target` 注入所属面板；切换工具时随面板隐藏并关闭。
- 设置页作为应用自带页面进入，不写 `toolTabs.openIds`，不出现在左轨运行列表。

## 4. 透明与材质边界

- 表面 alpha 由 CSS（`--alpha-*` + `color-mix`）合成；桌面模糊由 Windows DWM 材质或 macOS vibrancy 提供。
- Windows `transparent: true` 只提供逐像素 alpha，不模糊桌面。
- `acrylic` / `mica` / `tabbed` 失焦时由 DWM 退化为实色，不是 CSS 失效；需要失焦保持透明只能 `material: none`，并接受无桌面模糊。
- 左轨与标题栏不铺背景、不加 `backdrop-filter`、不画边线；`ToolSurface` 不用外阴影。

## 5. 回滚

- 令牌、外壳、首页、工具页按改动分组回滚；不要保留“双外壳”开关。
- 回滚后重新跑第 2 节命令与第 1 节验收。
