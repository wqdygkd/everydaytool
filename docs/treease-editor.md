# treease-editor 模块记忆

> 本项目为 Tauri 2 + Rust 原生后端，Electron 专有概念（preload / IPC 通道白名单 / 主进程）已替换为 Tauri command 口径。

## 会话 / 缓存位置（WebView2 profile 物理落盘）

- 子 Webview 由 `src-tauri/src/webviews.rs` 的 `edt_webview`（`op: "create"`）创建，页面侧传 `preset: 'treease'` + `profile: 'treease'`
  （`tools/treease-editor/pages/TreeaseEditorPage.vue`，webview id 为 `treease`）。
- 子 Webview 的数据目录由 `webviews.rs::profile_dir()` 计算：`<data>/webview-profiles/<profile>`，
  即 **`<data>/webview-profiles/treease`**（`appearance::webview_data_dir()` = `<data>/webview2`，profile 取它的父目录再拼 `webview-profiles`）。
  该目录作为 `WebviewBuilder::data_directory()`，Chromium 侧的全部会话数据（Cookies / LocalStorage / IndexedDB / HTTP Cache）
  物理写在这里，随设置页的数据目录走。
- 原 Electron 版的 `persist:treease-editor` 分区与 `app.setPath('sessionData', …)` 在本项目**不存在**：
  本项目没有 sessionData 概念，改为「一个子 Webview 一份 profile 目录」；主窗口的 WebView2 数据目录是 `<data>/webview2`。
- **不使用 junction / 软件链接**。首次创建 profile 目录时不迁移任何旧宿主缓存，新目录由 WebView2 重新生成；
  用户主动切换数据目录时才走下面的整体迁移。
- **初始化顺序**：本项目没有「ready 之前设置 sessionData」这一步——数据目录在 `run()` 最开始由
  `appearance::apply_pending_data_migration()` 落定，profile 目录在创建 Webview 时才按当前数据目录计算，
  因此不存在「设置太晚不生效」的坑（以代码为准）。
- 工具后端入口：`src-tauri/src/treease.rs::handle`，命令表 `shared/command-groups/treease.ts`（Tauri command `treease_command`），
  页面经 `createCommandHelpers('treeaseEditor', …)` 调用。本项目没有「initialize 里装协议层 handler」这一步，
  也没有 cache handler 预装/卸载。
- 切换数据目录：设置页只写 `data-root.pending.json` 并提示重启；下次启动在 `run()` 最开始把旧目录整体复制到新目录
  （含 `webview2` 与 `webview-profiles`），全部成功后才切换，失败保留旧目录并继续使用，因此登录态与缓存不会失效。
  **应用自身的 localStorage（收藏 / 页签 / 拦截规则）在主 WebView2 数据目录下，也一并迁移。**

## 拦截与缓存

- 原 Electron 版由协议层 handler 接管 HTTP(S)：本项目**没有对应实现**——Tauri / WebView2 没有等价的公开协议拦截 API，
  改为拦截脚本 `src-tauri/assets/treease-interceptor.js`，在 `preset == 'treease'` 时通过
  `initialization_script_for_all_frames` 在文档启动最早时刻注入（fetch / XHR 接管）：
  `modify` 按 patches 改写 JSON 响应，`block` 直接返回 403（不向上游发起请求）。
- 规则与开关存在渲染层 localStorage（`shared/storage-keys.ts`：`treeaseInterceptRules` → `edt:treease-intercept-rules`、
  `treeaseInterceptEnabled` → `edt:treease-intercept-enabled`），规则由 `treease.rs` 校验后动态下发；
  命中数由注入运行时统计，Rust 侧轮询后经 `treease:intercept-log` 事件回推。
  规则容量限制：最多 200 条、pattern 最长 512 字符、每条最多 64 个 patches（`treease.rs::sanitize_rules`）。
- **停止拦截只下空规则，不移除注入运行时**：注入发生在 `create` 时，运行时生命周期跟随 webview；
  `treease:intercept-stop` 只把规则清空并复位状态（webview 已关也照样复位）。
- 缓存落盘位置由 WebView2 的 `data_directory`（即 profile 目录）决定，因此 HTTP 缓存自然写入数据目录；
  不要在业务代码里另建缓存目录。清缓存走 `treease:cache-clear` → `webview.clear_all_browsing_data()`。
