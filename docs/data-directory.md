# 数据目录与缓存位置（全局约定）

目标：**所有可持久化数据都放在用户选择的数据目录**，每个工具尽量独立一个子目录；
切换数据目录后，各工具缓存与登录态仍然有效。

## 1. 位置总览

数据根目录记为 `<data>`（默认：开发态 `仓库/data`，打包态 `userData/data`，可在设置中修改）。

**userData 本身也按形态分开**：安装版 `<appData>/<应用名>`，未打包运行（`pnpm dev` / `pnpm start`）为 `<appData>/<应用名>-dev`（见 `backend/utils/app-instance.ts`，在 ready 之前、任何 `userData` 读取之前设置）。Chromium 的目录级单实例锁以 userData 为命名空间，共用同一份时安装版与开发版会互相顶掉（后启动方直接 `app.quit()` 秒退）；分开后两者可同时运行，各自仍是单实例。两份 userData 里的 `data-root.json` 也彼此独立，但**不要手动把两者指向同一个 `<data>`**。

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 数据目录引导（硬限制） | `userData/data-root.json`、`setup-state.json`、`data-root.path`、`data-root.pending.json` | 必须先知道数据目录在哪，不能放进数据目录；随 userData 按安装版 / 开发版分开 |
| 应用壳配置 | `<data>/app/window-appearance.json`、`<data>/app/window-bounds.json` | 窗口外观 + 记住的窗口大小 / 位置；外观早期在 userData，首次读取自动搬入 |
| Electron 崩溃/日志 | `<data>/app/crash-dumps`、`<data>/app/logs` | `app.setPath('crashDumps' / 'logs')` |
| Chromium 会话（全部 webview） | `<data>/session` | Cookies / LocalStorage / IndexedDB / Cache / Partitions；见 §2 |
| chrome-sandbox | `<data>/chrome-sandbox/` | `sandboxes.json` / `fingerprints.json` / `config.json`；profile 见下 |
| chrome-sandbox profiles | `<data>/chrome-sandbox/sandboxes/<id>/` | 旧布局 `<data>/sandboxes` 会自动收编；Chrome 占用时回退旧布局 |
| chrome-sandbox 共享指纹扩展 | `<data>/chrome-sandbox/shared/fingerprint_ext` | 旧布局 `<data>/shared` 同上 |
| env-browser | `<data>/env-browser/envs.json` | 账号/环境 JSON；页面会话在 Chromium session 分区 |
| interceptor | `<data>/interceptor/` | `config.json` / `rules.json` / `certs/` |
| interceptor 运行时扩展 | `<data>/interceptor/extension` | 早期在 `userData/interceptor-extension`，首次准备自动搬入 |
| offline-pack | `<data>/offline-pack/` | `history.json` + `downloads/`；用户另存的产物在用户选择位置 |
| treease-editor | `<data>/treease-editor/`（预留） | 无独立业务数据；页面缓存/登录在 Chromium 分区 |
| wxp-enhancer | `<data>/wxp-enhancer/config.json` | 注入设置；目标微信的聊天文件属于外部应用 |
| telegram-cache | `<data>/telegram-cache/` | 资源索引 / 对象 / 归档 / 断点 / 基准 / MTProto 会话密文 |
| workbuddy2api-panel | `<data>/workbuddy2api-panel/` | manifest / 设置 / downloads / runtime 二进制 / run 工作目录；二进制不进安装包 |
| id-card-generator | 无持久化文件 | 纯前端生成，不落盘 |
| 系统 Chrome 安装/默认 Profile | 系统路径 | 仅作为沙箱克隆源（只读） |
| 根 CA 信任库 | Windows 用户 Root / macOS login keychain | 系统信任存储，硬限制 |
| 操作系统临时目录 | `app.getPath('temp')` | 仅放瞬时文件；工具自己的临时文件都在 `<data>` 内 |

## 2. Chromium 会话目录（硬限制）

`electron/main.ts` 在 `app ready` **之前**执行：

```ts
loadDataDirectoryOverrideSync()
configureSessionDataDirectory()   // app.setPath('sessionData', <data>/session)
```

Chromium 没有“每个 persist 分区自定义磁盘路径”的 API；`sessionData` 是全局的，因此：

- 所有 webview 的 Cookies / LocalStorage / IndexedDB / HTTP Cache 都在 `<data>/session` 下；
- 每个工具仍有独立分区：`<data>/session/Partitions/<partition>`（如 `telegram-cache`、`treease-editor`）；
- 应用自身的收藏 / 打开的页签也在 `<data>/session/Local Storage`；
- **不使用 junction / 软链**；
- 运行期不能修改 `sessionData`，只能重启后生效。

## 3. 切换数据目录（缓存必须继续有效）

`DATA_DIRECTORY_UPDATE` 只写入 `userData/data-root.pending.json`，**不立即切换**；
设置页显示「待切换 / 重启后生效」。下次启动时：

1. `loadDataDirectoryOverrideSync()` 读取旧目录 + pending；
2. `migrateDataDirectory()` 把旧 `<data>` 下所有条目复制到新目录（含 `session`）；
3. 全部复制成功后才删除旧条目、写入新的 `data-root.json`；
4. 之后才 `configureSessionDataDirectory()`，Chromium 使用新目录；
5. 各工具 `initialize` 读取新目录，缓存/登录态保持有效。

约束与失败处理：

- 目标目录必须为空或不存在；非空直接拒绝，避免覆盖用户数据；
- 新旧目录不能互相嵌套；
- 复制失败会回滚本次复制到目标的部分，旧目录保持原样，继续使用旧目录（pending 保留，下次重试）；
- 迁移是**用户主动切换目录**时发生，不是首次启动迁移；
- 迁移在启动阶段同步执行，目录很大时启动会变慢（一次性）。

## 4. 每个工具一个文件夹（现状）

| 工具 | 独立文件夹 | 备注 |
| --- | --- | --- |
| chrome-sandbox | ✅ `<data>/chrome-sandbox` | profiles / shared 已收编；Chrome 占用时临时回退旧布局 |
| env-browser | ✅ `<data>/env-browser` | — |
| interceptor | ✅ `<data>/interceptor` | 系统 CA 信任在外部 |
| offline-pack | ✅ `<data>/offline-pack` | 用户另存位置除外 |
| wxp-enhancer | ✅ `<data>/wxp-enhancer` | 目标微信数据在外部 |
| telegram-cache | ✅ `<data>/telegram-cache` | Chromium 分区在 `session/Partitions` |
| workbuddy2api-panel | ✅ `<data>/workbuddy2api-panel` | 上游二进制与 run/ 配置；面板 session 在 `session/Partitions` |
| treease-editor | ✅ `<data>/treease-editor`（预留） | 页面数据在 Chromium 分区 |
| id-card-generator | — | 无持久化 |

应用级数据放 `<data>/app`，Chromium 放 `<data>/session`，不与工具目录混用。
