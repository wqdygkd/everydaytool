# 数据目录与缓存位置（全局约定）

目标：**所有可持久化数据都放在用户选择的数据目录**，每个工具独立一个子目录；
切换数据目录后，各工具的缓存与登录态仍然有效。

## 1. 位置总览

数据根目录记为 `<data>`（默认：开发态 `仓库/data`，安装版 `<userData>/data`，可在设置中修改）。

**userData 本身也按形态分开**：安装版 `<appData>/everydaytool`，开发态（debug 构建，即 `pnpm dev`）
`<appData>/everydaytool-dev`（见 `src-tauri/src/appearance.rs::user_data_dir_name`）。
两种形态的引导配置互不覆盖，可以同时运行；数据目录本身也按形态分开
（dev 默认仓库 `data/`，安装版默认 `<userData>/data`），**不要手动把两者指向同一个 `<data>`**。

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 数据目录引导（硬限制） | `userData/data-root.json`、`data-root.path`、`data-root.pending.json`、`setup-state.json` | 必须先知道数据目录在哪，不能放进数据目录；随 userData 按安装版 / 开发版分开 |
| 应用级配置 | `<data>/window-appearance.json`、`<data>/window-geometry.json` | 窗口外观 + 记住的窗口大小 / 位置；旧版留在 userData 根目录的副本由 `migrate_legacy_config` 一次性迁入 |
| 日志 | `<data>/logs` | `appearance::resolve_log_dir` 候选链的首选；不可写时回退 `%LOCALAPPDATA%\com.edt.everydaytool\logs`，仍不可写则只留 stdout |
| 主窗口 WebView2 | `<data>/webview2` | 主界面浏览器数据（界面存储 / 着色器缓存）；`EDT_WEBVIEW_DATA_DIR` 可显式覆盖 |
| 子 Webview profiles | `<data>/webview-profiles/<profile>` | env-browser（`env-<id>`）/ treease（`treease`）/ telegram-cache / workbuddy2api-panel 各自的独立浏览数据与登录态 |
| chrome-sandbox | `<data>/chrome-sandbox/` | 沙箱列表、指纹、配置与各沙箱 profile |
| env-browser | `<data>/env-browser/` | 环境配置 |
| interceptor | `<data>/interceptor/` | 规则、处理名单与 CA 证书（系统信任库在外部） |
| offline-pack | `<data>/offline-pack/` | 下载历史与下载产物 |
| treease-editor | `<data>/treease-editor/`（预留） | 无独立业务数据，页面数据在 webview-profiles |
| wxp-enhancer | `<data>/wxp-enhancer/` | 注入设置与采集数据 |
| telegram-cache | `<data>/telegram-cache/` | 资源索引 / 内容对象 / 归档 / 诊断包 / 基准 / MTProto 会话（加密） |
| workbuddy2api-panel | `<data>/workbuddy2api-panel/` | manifest / 设置 / downloads / runtime 二进制 / run 工作目录；二进制不进安装包 |
| id-card-generator | 无持久化文件 | 纯前端生成，不落盘 |
| 根 CA 信任库 | Windows 用户 Root / macOS login keychain | 系统信任存储，硬限制 |
| 操作系统临时目录 | `std::env::temp_dir()` | 仅放瞬时文件；工具自己的临时文件都在 `<data>` 内 |

## 2. 子 Webview 数据目录（硬限制）

Tauri 的子 Webview 有独立的 WebView2 数据目录（`WebviewBuilder::data_directory`），
`src-tauri/src/webviews.rs::profile_dir` 统一解析为 `<data>/webview-profiles/<profile>`：

- 每个工具 / 每个环境一份 profile，登录态互不干扰；
- **不使用 junction / 软链**；
- 运行期无法迁移已打开的 profile 目录：换数据目录时随整目录迁移一起搬（见 §3）。

## 3. 切换数据目录（缓存必须继续有效）

`edt-app:data-directory:update` 只写入 `userData/data-root.pending.json`，**不立即切换**；
设置页显示「待切换 / 重启后生效」。下次启动时：

1. `run()` 的**第一件事**调用 `appearance::apply_pending_data_migration()`（早于任何 `resolve_data_dir()` 使用者：
   webview 数据目录 / 日志目录 / 应用级配置 / 建窗）；
2. `data_migration::migrate_data_directory()` 把旧 `<data>` 下所有条目复制到新目录（含 `webview2` / `webview-profiles` / 各工具目录 / `logs`）；
3. 全部复制成功后才删除旧条目、写入新的 `data-root.json`（目标是默认目录时直接删掉覆盖文件）；
4. 之后才解析 webview 数据目录 / 日志目录并建窗，各工具域读到的都是新目录。

约束与失败处理：

- 目标目录必须为空或不存在；非空直接拒绝，避免覆盖用户数据；
- 新旧目录不能互相嵌套（前缀校验）；
- 复制失败会回滚本次复制到目标的部分，旧目录保持原样，继续使用旧目录（pending 保留，下次重试）；
- 迁移是**用户主动切换目录**时发生，不是首次启动迁移；
- 迁移在启动阶段同步执行，目录很大时启动会变慢（一次性）。

## 4. 每个工具一个文件夹（现状）

| 工具 | 独立文件夹 | 备注 |
| --- | --- | --- |
| chrome-sandbox | ✅ `<data>/chrome-sandbox` | 沙箱 profile 在 profile 目录下 |
| env-browser | ✅ `<data>/env-browser` | 页面数据在 `webview-profiles/env-<id>` |
| interceptor | ✅ `<data>/interceptor` | 系统 CA 信任在外部 |
| offline-pack | ✅ `<data>/offline-pack` | 用户另存位置除外 |
| wxp-enhancer | ✅ `<data>/wxp-enhancer` | 目标微信数据在外部 |
| telegram-cache | ✅ `<data>/telegram-cache` | 页面数据在 `webview-profiles/telegram-cache` |
| workbuddy2api-panel | ✅ `<data>/workbuddy2api-panel` | 上游二进制与 run/ 配置；面板数据在 `webview-profiles/workbuddy2api-panel` |
| treease-editor | ✅ `<data>/treease-editor`（预留） | 页面数据在 `webview-profiles/treease` |
| id-card-generator | — | 无持久化 |

应用级配置（窗口外观 / 窗口几何）放在 `<data>` 根，与各工具目录并列；不另建 `app/` 子目录
（旧版 Electron 实现放在 `<data>/app/`，Rust 版已扁平化）。
