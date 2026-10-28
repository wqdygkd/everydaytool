# 数据目录与缓存位置（全局约定）

> 本文记录**现状**（v2 分层布局：`config` / `assets` / `session` / `cache`）。
> 分层判据、备份与迁移策略、资产独立根的设计见 [data-layers.md](./data-layers.md)；
> 归属清单的唯一代码事实来源是 [shared/data-layers.ts](../shared/data-layers.ts)。

目标：**所有可持久化数据都在数据根（或资产根）下按层归位**，且层与层之间的边界由
「能不能重新生成」决定——清理只碰可再生部分，备份只装不可再生部分。

## 1. 四层与位置总览

数据根记为 `<data>`（默认：开发态 `仓库/data`，打包态 `userData/data`，可在设置中修改）；
资产根记为 `<assets>`（默认 `<data>/assets`，**可独立设盘**：设置页「数据分层 → 资产 → 更改…」，
写入 `userData/assets-root.pending.json`，下次启动迁移后生效）。

| 层 | 位置 | 内容 | 备份 | 清缓存 |
| --- | --- | --- | --- | --- |
| **配置** config | `<data>/config/` | 账号 / 规则 / 资源索引 / 证书 / 加密凭据 / 应用壳配置 | 必含 | **永不清理** |
| **资产** assets | `<assets>/` | 用户显式归档的产出（当前仅 telegram 归档副本） | 只出清单（内容可选） | **永不清理** |
| **会话** session | `<data>/session/` | Chromium 全部会话：Cookies / LocalStorage / IndexedDB / Partitions / 沙箱 profile | 可选（默认不含） | 只清内部 Chromium 缓存目录 |
| **缓存** cache | `<data>/cache/` | 可再生：浏览器缓存、工具下载与运行产物、日志、诊断包、旧布局隔离区 | 永不导出 | 一键全清 |

`<data>/session` 就是 Electron 的 `sessionData`（`app.setPath('sessionData')`，ready 之前设置），
因此 Chromium 的会话数据天然落在会话层，**不使用任何 junction / 软链**。

**userData 本身也按形态分开**：安装版 `<appData>/<应用名>`，未打包运行（`pnpm dev` / `pnpm start`）为
`<appData>/<应用名>-dev`（见 `backend/utils/app-instance.ts`，在 ready 之前、任何 `userData` 读取之前设置）。
Chromium 的目录级单实例锁以 userData 为命名空间，共用同一份时安装版与开发版会互相顶掉；分开后两者可同时运行，
各自仍是单实例。两份 userData 里的 `data-root.json` 也彼此独立，但**不要手动把两者指向同一个 `<data>`**。

### 硬限制（不能进数据根）

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 数据目录引导 | `userData/data-root.json`、`setup-state.json`、`data-root.path`、`data-root.pending.json` | 必须先知道数据目录在哪 |
| 资产根引导 | `userData/assets-root.json`、`assets-root.pending.json` | 资产根可能在数据根之外，同样只能放 userData |
| 根 CA 信任库 | Windows 用户 Root / macOS login keychain | 系统信任存储 |
| 系统 Chrome 安装与默认 Profile | 系统路径 | 仅作沙箱克隆源（只读） |
| 目标应用数据（微信等） | 外部应用自己的目录 | wxp-enhancer 只注入，不改它的目录 |
| 用户另存位置 | 用户选择 | interceptor 导出证书、workbuddy 本地 zip 源等 |

## 2. 目录明细

```text
<data>/
  .edt-layout.json                 布局版本标记（缺失视为 v1，启动时自动升级并写入）
  config/                          # 配置层：小而可读，可人工校验
    app/                window-appearance.json, window-bounds.json, ui-preferences.json（收藏 / 首页排序）
    chrome-sandbox/     sandboxes.json, fingerprints.json, config.json
    env-browser/        envs.json                     [敏感：明文账号密码]
    interceptor/        config.json, rules.json, certs/{ca.key,ca.crt}   [敏感]
    offline-pack/       history.json
    wxp-enhancer/       config.json, data-cache.json  [敏感：token / 用户对象]
    telegram-cache/     config.json, registry.json, archive-index.json,
                        benchmarks.json, telegram-session.bin(密文)
    treease-editor/     rules.json（拦截规则 + 总开关；LocalStorage 只是镜像）
    workbuddy2api-panel/ manifest.json, app-settings.json, run/{config.json,auths/,data/}  [敏感]
    quarantine/         <ts>/  旧布局孤儿白名单（config.db / cdp-injector / .DS_Store），不删、不备份
  session/                         # 会话层 == Electron sessionData
    Cookies/  Local Storage/  IndexedDB/  Preferences
    Partitions/{telegram-cache,treease-editor,workbuddy2api-panel,env-<id>}
    sandbox/<sandboxId>/           # 沙箱 Chrome profile（Chrome --user-data-dir）
    Cache/  Code Cache/  GPUCache/  …   # 内部可再生缓存，唯一允许在会话层被清的部分
  cache/                           # 缓存层：删了自动重建
    app/{logs,crash-dumps}
    chrome-sandbox/shared/fingerprint_ext
    interceptor/extension
    offline-pack/downloads/
    telegram-cache/{objects,tmp,mtproto,diagnostics}
    workbuddy2api-panel/{downloads,runtime/{current,previous,staging}}
    import-rollback/<时间戳>/       # 备份恢复前的配置层快照（回滚点，可随时清）

<assets>/                           # 资产层：默认 <data>/assets
  telegram-cache/archive/resources/…
```

各工具的落点与清理策略逐条登记在 `shared/data-layers.ts` 的 `DATA_LAYER_ENTRIES`；
`pnpm data-layers:check` 会断言「搬迁目标都有层归属」并禁止业务代码绕过 `resolveLayerPath` 直接拼数据根。

## 3. 布局升级与数据目录切换

**布局升级（v1 → v2）**：`electron/main.ts` 在 `loadDataDirectoryOverrideSync()` 之后、
`configureSessionDataDirectory()` 之前调用 `upgradeDataLayout()`：

- 逐条目搬迁（`shared/data-layers.ts` 的 `DATA_LAYOUT_V1_TO_V2`），优先 `rename`，跨卷回落 `cp + rm`；
- 单条失败不中断：文件留在旧位置，读取方用 `resolveLayerPathWithFallback` 回查，日志记录错误；
- 冲突（两边同名）不覆盖、不写版本标记，下次启动重试；
- 白名单内的已知孤儿（`config.db` / `cdp-injector` / `.DS_Store`）进 `config/quarantine/<时间戳>/`，不删；
  其余未登记的顶层项原地保留（只 warn），`.env` 等用户自备文件永不隔离；
- 零错误零冲突才写 `.edt-layout.json` 的 `layoutVersion: 2`；
- 升级幂等，可在任意次启动重复执行。

沙箱 profile 从 `chrome-sandbox/sandboxes` 搬到 `session/sandbox` 后会改写 `sandboxes.json` 里的绝对
`userDataPath`；pre-v1 的 `<data>/sandboxes`、`<data>/shared` 仍由 `ensureChromeSandboxLayout()` 在运行期收编。

**切换数据目录**：`DATA_DIRECTORY_UPDATE` 只写 `userData/data-root.pending.json`，下次启动时：

1. `loadDataDirectoryOverrideSync()` 读旧目录 + pending；
2. `migrateDataDirectory(..., { skipCache: true })` 把旧 `<data>` 下的条目复制到新目录（含 `session`，
   **跳过可再生的 `cache/`**）；
3. 全部成功后才删除**已复制**的条目、写入新的 `data-root.json`；跳过 `cache` 意味着没搬全，因此旧目录保留，
   日志点名残留项并提示「旧目录里只剩可再生缓存，确认新目录可用后可手动删除」；
4. 之后才 `upgradeDataLayout()` 与 `configureSessionDataDirectory()`，Chromium 使用新目录；
5. 各工具 `initialize` 读取新目录，缓存/登录态保持有效。

约束与失败处理：

- 目标目录必须为空或不存在；非空直接拒绝，避免覆盖用户数据；
- 新旧目录不能互相嵌套；
- 复制失败会回滚本次复制到目标的部分，旧目录保持原样，继续使用旧目录（pending 保留，下次重试）；
- 迁移是**用户主动切换目录**时发生，不是首次启动迁移；
- 迁移在启动阶段同步执行，目录很大时启动会变慢（一次性）；
- 资产根默认在数据根内，因此**默认位置下会随数据目录一起迁移**；一旦被设到数据根之外就不再参与数据目录的迁移（指针保留）。
- 资产根有自己的切换流程（`assets-root.pending.json`），在启动时先于布局升级执行，与数据目录切换互不依赖。

## 4. 工具落点一览

| 工具 | 配置层 | 会话层 | 缓存层 | 资产层 |
| --- | --- | --- | --- | --- |
| chrome-sandbox | `config/chrome-sandbox/` | `session/sandbox/<id>/` | `cache/chrome-sandbox/shared/` | — |
| env-browser | `config/env-browser/envs.json`（密码经 safeStorage 加密） | `session/Partitions/env-<id>/` | — | — |
| interceptor | `config/interceptor/{config,rules}.json`、`certs/` | —（系统 CA 信任在外部） | `cache/interceptor/extension/` | — |
| offline-pack | `config/offline-pack/history.json` | — | `cache/offline-pack/downloads/` | 用户另存位置（外部） |
| telegram-cache | `config/telegram-cache/*.json`、`telegram-session.bin` | `session/Partitions/telegram-cache/` | `cache/telegram-cache/{objects,tmp,mtproto,diagnostics}` | `<assets>/telegram-cache/archive/` |
| treease-editor | `config/treease-editor/rules.json` | `session/Partitions/treease-editor/` | — | — |
| workbuddy2api-panel | `config/workbuddy2api-panel/{manifest,app-settings}.json`、`run/` | `session/Partitions/workbuddy2api-panel/` | `cache/workbuddy2api-panel/{downloads,runtime}` | — |
| wxp-enhancer | `config/wxp-enhancer/{config,data-cache}.json` | 目标微信自己的 profile（外部） | — | — |
| id-card-generator | 无持久化 | — | — | — |
| 应用壳 | `config/app/`（外观 / 窗口几何 / **收藏与首页排序**） | `session/Local Storage`（页签、镜像） | `cache/app/`、`cache/import-rollback/`、`config/quarantine/` | — |

渲染层的 Local Storage 里仍有（物理位于 `session/Local Storage`，属会话层）：打开的页签（会话性）、
offline-pack 镜像地址、env-browser 网页预览回退，以及 treease 规则 / 收藏与首页排序的**镜像副本**
（事实来源已迁到配置层，镜像只给网页预览与首屏兜底）。
