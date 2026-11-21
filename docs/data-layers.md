# 数据目录、分层与备份

数据按「可不可再生」分成四层，清理、备份、切换数据目录三条链路各自只碰该碰的层。归属清单的唯一代码事实来源是 [`shared/data-layers.ts`](../shared/data-layers.ts)，运行期路径解析在 [`backend/utils/data-layers.ts`](../backend/utils/data-layers.ts)。

## 1. 分层模型

判定链：

1. 不是我们写的 → Chromium / 外部应用拥有 → **会话层（session）**，只使用、不解析；
2. 我们写的且可再生（网络 / 源可重新获取，丢失无副作用）→ **缓存层（cache）**；
3. 我们写的、不可再生、且是用户显式产生的归档或产出 → **资产层（assets）**；
4. 其余不可再生数据 → **配置层（config）**，含密文凭据时标 `sensitive`；
5. 下载中 / `.part` / `.tmp` 等瞬时中间态 → 缓存层。

| 层 | 物理根 | 内容 | 备份 | 清理 |
| --- | --- | --- | --- | --- |
| 配置 config | `<data>/config/` | 账号、规则、证书、索引、应用壳配置、加密凭据 | 必含 | 永不清理 |
| 资产 assets | `<assets>/` | 用户显式归档的产出（tweb-cache 归档、skill-manager 禁用区与回收站） | 默认只出清单 | 永不自动清理 |
| 会话 session | `<data>/session/` | Chromium 的 Cookies / LocalStorage / IndexedDB / Partitions | 可选，默认不含 | 只清内部 Chromium 缓存目录 |
| 缓存 cache | `<data>/cache/` | 浏览器缓存、工具下载与运行产物、日志、诊断包、恢复快照 | 永不导出 | 一键全清 |

层代号统一为 `config` / `assets` / `session` / `cache`。数据根默认开发态 `仓库/data`、打包态 `userData/data`；资产根默认 `<data>/assets`。两者都可在设置页更改，重启后生效。

`<data>/session` 就是 Electron 的 `sessionData`（`app.setPath('sessionData')`，ready 之前设置），Chromium 会话数据天然落在会话层，不使用 junction / 软链。

**userData 按形态分开**：安装版 `<appData>/<应用名>`，未打包运行（`pnpm dev` / `pnpm start`）为 `<appData>/<应用名>-dev`（`backend/utils/app-instance.ts`）。Chromium 的目录级单实例锁以 userData 为命名空间，分开后安装版与开发版可同时运行，各自仍是单实例。两份 userData 的 `data-root.json` 彼此独立，不要手动把两者指向同一个 `<data>`。

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 数据目录引导 | `userData/data-root.json`、`setup-state.json`、`data-root.pending.json` | 必须先知道数据目录在哪 |
| 资产根引导 | `userData/assets-root.json`、`assets-root.pending.json` | 资产根可能在数据根之外，只能放 userData |
| 根 CA 信任库 | Windows 用户 Root / macOS login keychain | 系统信任存储，不属于应用数据 |
| 目标应用数据（微信等） | 外部应用自己的目录 | wxp-enhancer 只注入，不改它的目录 |
| 用户另存位置 | 用户选择 | interceptor 导出证书、workbuddy 本地 zip 源等 |

## 2. 目录布局

```text
<data>/
  config/                              # 配置层：小而可读，可人工校验
    app/                window-bounds.json, ui-preferences.json
    interceptor/        config.json, rules.json, certs/{ca.key,ca.crt}   [sensitive]
    offline-pack/       history.json
    wxp-enhancer/       config.json, data-cache.json  [sensitive]
    tweb-cache/         config.json, media-index.json, messages-index/,
                        archive-alias.json, peer-dirs.json
    treease-editor/     rules.json（规则从 LocalStorage 上台面）
    workbuddy2api-panel/ manifest.json, app-settings.json, run/{config.json,auths/,data/}
    outlook-register/   accounts.json, draft.json, settings.json          [accounts/draft sensitive]
    skill-manager/      settings.json, registry.json, history.json, projects.json,
                        favorites.json, presets.json, credentials.json [sensitive], lock-backups/
  session/                             # 会话层 == Electron sessionData
    Cookies/  Local Storage/  IndexedDB/  Preferences
    Partitions/{tweb-cache,treease-editor,workbuddy2api-panel,outlook-register-*}
    Cache/  Code Cache/  GPUCache/ …   # 内部可再生子目录，会话层里唯一允许清的部分
  cache/                               # 缓存层：删了自动重建
    app/{logs,crash-dumps}
    app/extension                      # 浏览器插件，可从 resources 重建
    offline-pack/downloads/
    tweb-cache/{objects,tmp,diagnostics}
    workbuddy2api-panel/{downloads,runtime/{current,previous,staging}}
    skill-manager/{repos,staging,tmp}
    import-rollback/<ts>/              # 备份恢复前的配置层快照，可随时清

<assets>/                              # 资产层，默认 <data>/assets，可设到任意盘
  tweb-cache/messages/…                # 消息级缓存（manifest + message.md + 媒体）
  tweb-cache/trash/…                   # 回收站
  skill-manager/disabled/…             # 已禁用技能（按 scopeId）
  skill-manager/trash/…                # 技能回收站（manifest + 技能目录）
```

可再生目录只可能出现在 `cache/` 与 `session/` 内部，清理逻辑不需要按工具猜目录名。

## 3. 资产层

- 实现：`backend/utils/assets-root.ts`（`getAssetsRoot` / `loadAssetsRootSync` / `requestAssetsRootChange` / `migrateAssetsDirectory`）；路径校验在 `path-guard.ts` 的 `isSafeAssetsDirectory`。
- 定位文件：`userData/assets-root.json`，与 `data-root.json` 同级，安装版与开发版各自独立。更改位置重启后生效：空目录接续使用，已有归档目录直接接管，认不出的非空目录拒绝。
- 路径守卫：禁止盘根、用户主目录本身、与数据根完全相同；允许位于数据根内（默认即如此）；禁止数据根位于资产根内。
- 索引不写死绝对路径：`tweb-cache` 的 `media-index.json` / 消息索引存相对所属层根的路径；消息目录内的附件路径相对消息目录（`media/<file>`）。资产根搬家后索引无需改写。
- 资产在默认位置 `<data>/assets` 时随数据根一起使用；设到数据根之外后指针保持不变，不随数据根变化。
- 永不自动清理；删除只经工具 UI 显式执行。`measureLayers()` 单独统计资产根，`scanDataRoot()` 在资产根位于数据根内时排除 `<data>/assets`，避免重复计数。
- 备份策略 `manifest-only`：导出包只写资产清单（相对路径、size、所属工具），不打包内容；导入时只对账，不写盘。资产跟随用户自己的盘 / 备份盘，不进备份包。

## 4. 工具落点

| 工具 | 配置层 | 会话层 | 缓存层 | 资产层 |
| --- | --- | --- | --- | --- |
| interceptor | `config/interceptor/{config,rules}.json`、`certs/` | —（系统 CA 信任在外部） | —（插件已归平台 `cache/app/extension/`） | — |
| offline-pack | `config/offline-pack/history.json` | — | `cache/offline-pack/downloads/` | 用户另存位置（外部） |
| tweb-cache | `config/tweb-cache/{config,media-index,archive-alias,peer-dirs}.json`、`messages-index/` | `session/Partitions/tweb-cache/` | `cache/tweb-cache/{objects,tmp,diagnostics}` | `<assets>/tweb-cache/{messages,trash}`，工具内可单独覆盖 |
| treease-editor | `config/treease-editor/rules.json` | `session/Partitions/treease-editor/` | — | — |
| workbuddy2api-panel | `config/workbuddy2api-panel/{manifest,app-settings}.json`、`run/` | `session/Partitions/workbuddy2api-panel/` | `cache/workbuddy2api-panel/{downloads,runtime}` | — |
| outlook-register | `config/outlook-register/{accounts,draft,settings}.json` | `session/Partitions/outlook-register-<id>/` | — | — |
| wxp-enhancer | `config/wxp-enhancer/{config,data-cache}.json` | 目标微信自己的 profile（外部） | — | — |
| skill-manager | `config/skill-manager/{settings,registry,history,projects,favorites,presets,credentials}.json`、`lock-backups/` | — | `cache/skill-manager/{repos,staging,tmp}` | `<assets>/skill-manager/{disabled,trash}` |
| id-card-generator | 无持久化 | — | — | — |
| 应用壳 | `config/app/{window-bounds,ui-preferences}.json` | `session/Local Storage`（页签、镜像） | `cache/app/`、`cache/import-rollback/` | — |

留在 Local Storage 的只有打开的页签（会话性）与 offline-pack 镜像地址（偏好）。首页工具排序、左轨三态等用户数据在 `config/app/ui-preferences.json`，LocalStorage 仅作镜像。

## 5. 基建 API

`shared/data-layers.ts`（纯类型 / 常量 / 纯函数）：

```ts
export type DataLayer = 'config' | 'assets' | 'session' | 'cache'

export interface DataLayerEntry {
  id: string
  toolId: string | 'app'
  layer: DataLayer
  relativePath: string        // 相对所属层根
  label: string
  backup: 'include' | 'optional' | 'manifest-only' | 'never'
  clean: 'never' | 'always' | 'internal-chromium-cache'
  sensitive?: boolean
  integrity?: 'index-prune' | 'reinstall-required' | 'missing-file-badge'
}

export const DATA_LAYER_ENTRIES: DataLayerEntry[]
export const CHROMIUM_SESSION_CACHE_DIRS: string[]
export function joinLayerPath(...segments: string[]): string
```

`backend/utils/data-layers.ts`（运行期能力）：

```ts
measureLayers(): Promise<Record<DataLayer, { bytes: number, entries: DataLayerEntryUsage[] }>>
getLayerRoot(layer): string                       // assets → <assets>，其余 → <data>/<layer>
resolveLayerPath(layer, ...segments): string      // 层内路径唯一入口
clearCacheLayer({ skipPaths }): Promise<CacheLayerCleanResult>
```

**硬约束**：工具不得自己 `path.join(getDataDirectory(), '工具', …)`，一律走 `resolveLayerPath`；`pnpm data-layers:check` 会拦截直接拼接（包括 `const root = getDataDirectory()` 这类别名）。新增落点先往 `DATA_LAYER_ENTRIES` 加一条；确实不能走层的（如用户自备 `<data>/.env`）写 `// data-layers:allow <原因>`，原因必填、逐行生效。

## 6. 清理

- 「清缓存」= `cache/` 全部 + `session/` 内 `CHROMIUM_SESSION_CACHE_DIRS` 名单，其余不动。
- 配置层与资产层不进入任何自动清理路径。
- 清理后按 `integrity` 自愈：
  - `tweb-cache`：媒体状态按对象文件是否存在现算，索引中不存在的对象剔除；
  - `workbuddy2api-panel`：按二进制是否存在重算「已安装」；
  - `offline-pack`：下载记录按磁盘实况现算「文件已缺失」。

## 7. 备份

格式：单文件 `edt-backup-<appVersion>-<yyyyMMdd-HHmmss>.edtbackup`，实现为 `shared/backup.ts` + `backend/utils/backup-format.ts` + `backend/utils/backup-service.ts`。

```text
[0..4) 'EDTB' | [4] 格式版本 | [5] flags(bit0=已加密) | [6..10) header 长度
header(JSON)   仅放加密参数：{ kdf:'scrypt', n, r, p, salt, iv }；未加密时为空对象
payload        gzip(条目表)；条目表 = u32 条目数 + 重复(u16 名长 | 名字 | u32 数据长 | 数据)
  首条目固定 manifest.json：
    { schemaVersion, appVersion, platform, createdAt, encrypted,
      strategy: { config: true, session: false, assets: 'manifest', cache: false },
      entries: [{ id, layer, relativePath, size, sha256 }],
      assets:  [{ relativePath, size, toolId }],
      omittedSensitive: [], totals: { files, bytes, assetFiles, assetBytes } }
  其余条目名 = `${layer}/${relativePath}`
```

加密：`scrypt(口令, salt, 32)` → `AES-256-GCM(payload, iv)`，tag 附在密文尾部；口令错误或包被篡改统一报「口令不正确或备份包已损坏」。容器只用 `node:crypto` + `node:zlib`，不引入原生依赖。

- 默认只含 `config`；`sensitive` 条目（`certs/ca.key`、`wxp data-cache.json`、workbuddy `run/config.json`、skill-manager `credentials.json`）导出前逐项列出，可选跳过或口令加密整包。
- 导入：校验 magic / schema → 逐文件 sha256 → 预演冲突 → 把现有 `config/` 快照到 `cache/import-rollback/<ts>/` → 写入 → 失效内存缓存。写入中途失败自动回滚，报告里带回滚快照路径。
- 恢复只写 `config`（可选 `session`）；`assets` 与 `cache` 条目不写盘。恢复报告只统计真正写入磁盘的条目。

## 8. 不变量

1. 清空 `cache/` 后应用正常启动：账号、规则、登录态、证书、归档全在；tweb-cache 显示未缓存，workbuddy 显示需重新下载，offline-pack 已下载成品保留。
2. 导出包内零 `cache` 条目；`sensitive` 按开关处理；`assets` 只出清单；包内 sha256 全通过。
3. 导入失败自动回滚，并在报告与错误信息中给出 `rollbackSnapshot`。
4. 资产根搬家后，索引无需改写即可命中。
5. `pnpm data-layers:check` 通过：不存在绕过 `resolveLayerPath` 的直接拼接，豁免只能逐行写 `data-layers:allow <原因>`。
6. 设置页四层体积之和 = 数据根 + 资产根实际占用，无重复计数。
7. `pnpm typecheck` 通过。

## 9. 设置页

```text
配置 · 必须备份        3.2 MB   32 项            [导出备份…]
资产 · 独立位置        412 GB   <assets> 路径    [更改位置…] [打开]
会话 · 登录态          87 MB    Chromium 管      [仅清内部缓存…]
缓存 · 可再生          1.4 GB                    [清理缓存…]
```

- 四层各占「数据与存储」分组内的一行，可展开工具明细；`sensitive` 打徽标。
- 「清理缓存」下方固定说明不删范围。
- 资产层展示位置、体积，提供「更改位置」「打开」；不做剩余空间探测。

## 10. 非目标

- 不做容量上限 / LRU 自动淘汰。
- 不做云同步 / 增量备份。
- 不把 Chromium Cookies 拆成单独可导出文件。
- 不引入数据库或原生依赖。
