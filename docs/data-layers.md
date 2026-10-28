# 数据分层与备份设计（配置 / 资产 / 会话 / 缓存）

> 状态：**P0a / P0b / P1 / P2 / P3 全部落地**——分层布局、资产独立根、备份导出/恢复、
> 凭据静态加密与 LocalStorage 上台面均已完成。现状见 [data-directory.md](./data-directory.md)。
> 目标：把「数据目录里的东西」按**可不可再生**分成四层，让清理、迁移、备份三条链路各自只碰该碰的层，
> 并使「不可再生但体量大」的资产（归档资源）拥有**独立存储位置**。

## 0. 问题（改造前的 v1 平铺布局）

改造前所有落点都是 `<data>/<工具>/<文件>` 平铺，导致：

- 清理只能靠「目录名黑名单」猜（`Cache` / `Code Cache` …），工具自己的可再生数据（`objects/`、`downloads/`、`runtime/`）只能算「数据」，永远清不掉；
- 切换数据目录整树同步复制，其中 80% 是可再生的 Chromium 缓存；
- 配置、账号、规则、登录态、可再生缓存混在同一层，**没有可靠的「哪些必须备份」的答案**；
- 用户想归档的资源（telegram `archive/`）和数据目录绑死，无法放到另一块盘。

## 1. 分层模型

判定链只有一条，避免「这个文件放哪」反复讨论：

1. **这个文件是我们写的吗？**
   - 不是 → Chromium / 外部应用拥有 → **会话层（session）**（只使用，不解析）
2. **是我们写的，且可再生（网络/源可重新获取、丢失无副作用）？**
   - 是 → **缓存层（cache）**
3. **是我们写的、不可再生，且用户显式产生（归档 / 产出，非运行期副产物）？**
   - 是 → **资产层（assets）**
4. **否则 → 配置层（config）**（含密文凭据，标 `sensitive`）
5. 我们写的瞬时中间态（`.part` / `.tmp` / 下载中）→ **cache**，启动时清理

| 层 | 名称 | 物理根 | 备份 | 清理 | 随数据目录迁移 | 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| L0 | 引导 | `userData/`（`data-root.json`、`assets-root.json` …） | 否 | 否 | 否 | 必须先定位根目录 |
| L1 | 配置 / 权威数据 | `<data>/config/` | **必含** | **永不清理** | 必含 | 我们写、不可再生、非用户产出 |
| L2 | 资产 | `<assets>/`（**独立根，可设任意位置**） | 默认**仅清单**，内容可选 | 永不自动清 | 仅在默认位置时跟随 | 用户显式产出、不可再生、体量大 |
| L3 | 会话 / 登录态 | `<data>/session/` | 可选（默认不含） | 只清内部已知 Chromium 缓存子目录 | 必含 | Chromium 拥有、登录态不可再生 |
| L4 | 缓存 / 可再生 | `<data>/cache/` | **永不导出** | 一键全清 | 默认跳过 | 可再生、丢失无副作用 |
| L5 | 外部 | 系统信任库、Chrome 克隆源、用户另存位置 | 否 | 否 | 否 | 不属于我们 |

层代号在代码与 UI 中统一用字符串：`config` / `assets` / `session` / `cache`。

## 2. 目录布局

```text
<data>/
  config/                              # L1 权威：小而可读，可人工校验
    app/                window-appearance.json, window-bounds.json, ui-preferences.json
    chrome-sandbox/     sandboxes.json, fingerprints.json, config.json
    env-browser/        envs.json                     [sensitive]
    interceptor/        config.json, rules.json, certs/{ca.key,ca.crt}   [sensitive]
    offline-pack/       history.json
    wxp-enhancer/       config.json, data-cache.json  [sensitive]
    telegram-cache/     config.json, registry.json, archive-index.json,
                        benchmarks.json, telegram-session.bin(密文)
    treease-editor/     rules.json                    ← 新增，规则从 LocalStorage 上台面
    workbuddy2api-panel/ manifest.json, app-settings.json, run/{config.json,auths/,data/}
    quarantine/<ts>/    ← 旧布局孤儿白名单（config.db / cdp-injector / .DS_Store），不删、不备份
  session/                             # L3：Electron sessionData 就是这个目录（路径不变）
    Cookies/ Local Storage/ Partitions/{telegram-cache,treease-editor,workbuddy2api-panel,env-<id>}
    sandbox/<sandboxId>/               ← chrome-sandbox profile 迁入（Chrome --user-data-dir）
    Cache/ Code Cache/ GPUCache/ …     ← 内部可再生子目录，L3 里唯一允许被清的部分
  cache/                               # L4
    app/{logs,crash-dumps}
    chrome-sandbox/shared/fingerprint_ext        (可从 resources 重建)
    interceptor/extension                        (可从 resources 重建)
    offline-pack/downloads/
    telegram-cache/{objects,tmp,mtproto,diagnostics}
    workbuddy2api-panel/{downloads,runtime/{current,previous,staging}}
    import-rollback/<ts>/   ← 备份恢复前的配置层快照（回滚点，可随时清）

<assets>/                              # L2 独立根，默认 <data>/assets，可设到任意盘
  telegram-cache/archive/resources/…
```

收益：`Cache` 类目录只可能出现在 `cache/` 与 `session/` 内部两处，清理逻辑不再需要猜；可再生数据与不可再生数据在磁盘上物理隔离。

## 3. 资产层（L2）细则

### 3.1 定位与生命周期（已落地）

- 实现：`backend/utils/assets-root.ts`（`getAssetsRoot` / `loadAssetsRootSync` / `requestAssetsRootChange` / `migrateAssetsDirectory`）；
  路径校验走 `path-guard.ts` 的 `isSafeAssetsDirectory`（与数据目录同一套系统目录规则）。
- 定位文件：`userData/assets-root.json`（与 `data-root.json` 同级、同 `app-instance` 形态区分，dev 与安装版各自独立）。
  放在 userData 而非数据根内，因为它指向数据根**之外**；数据目录切换不应改动它。
- 默认值：`<data>/assets`。设置页给出建议文案：资产体量大时可指到另一块盘。
- 切换流程与数据目录同构、**不立即生效**：`ASSETS_DIRECTORY_UPDATE` 只写 `userData/assets-root.pending.json`，下次启动在 `ready` 之前执行 `migrateAssetsDirectory()`（复制 → 逐文件 sha256 校验 → 删源；失败保留旧位置并保留 pending，下次重试）。
- 路径守卫（`isSafeAssetsDirectory`）：禁止盘根 / 用户主目录本身 / 与数据根完全相同；允许位于数据根内（默认即如此）；禁止数据根位于资产根内。

### 3.2 索引不写死绝对路径

`<data>/config/telegram-cache/archive-index.json` 内的资源路径一律存**相对 `<assets>` 根**的路径（沿用 `toTelegramRelativePath` 的做法）。资产根搬家后只需重算根前缀，索引零改动。

### 3.3 与数据目录迁移的关系

| 场景 | 行为 |
| --- | --- |
| 资产在默认位置（`<data>/assets`），用户切换数据目录 | 作为 `assets` 层随 `config`/`session` 一起复制（不可再生，不能丢）；仍跳过 `cache` |
| 资产已设到数据根之外 | 完全不参与数据目录迁移，指针不变 |
| 用户单独改资产位置 | 独立迁移流程（§3.1），与数据目录无关 |

判定用 `isWithin(assetsRoot, dataRoot)`，实现集中在 `data-layers.ts`，不要在迁移代码里各写一遍。

### 3.4 清理与统计

- 永不自动清理；删除只经工具 UI 显式执行（如 telegram 归档删除）。
- 用量统计：`measureLayers()` 独立统计资产根；`scanDataRoot()` 在资产根位于数据根内时**排除 `<data>/assets` 这一个条目**，避免与资产卡片重复计数。

### 3.5 备份语义：清单优先

`backup: 'manifest-only'`：
- 导出包内写资产清单（相对路径、size、所属工具），**内容不打包**——归档动辄 GB~TB 级，进包既打不出来也恢复不了；
- 导入时资产条目一律不写盘，只对账：本机缺失的资产在恢复报告里列成「需另行恢复的资产（N 个 / X GB）」。
  想让资产跟着走，用「更改位置」把资产根放到自己的盘 / 备份盘，不走备份包。

## 4. 落点映射与策略（旧 → 新）

| 现有 | 新位置 | 层 | 备份 | 清理 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `app/window-*.json` | `config/app/` | config | include | never | 仅换根 |
| `app/logs`、`app/crash-dumps` | `cache/app/` | cache | never | always | 诊断用 |
| `chrome-sandbox/{sandboxes,fingerprints,config}.json` | `config/chrome-sandbox/` | config | include | never | — |
| `chrome-sandbox/sandboxes/<id>/` | `session/sandbox/<id>/` | session | optional | internal | 迁后改写 `sandboxes.json` 绝对 `userDataPath`（复用 `rewriteSandboxPaths`） |
| `chrome-sandbox/shared/fingerprint_ext` | `cache/chrome-sandbox/` | cache | never | always | 可从 resources 重建 |
| `env-browser/envs.json` | `config/env-browser/` | config | include | never | `sensitive`（明文密码，P2 加密） |
| `interceptor/{config,rules}.json` | `config/interceptor/` | config | include | never | — |
| `interceptor/certs/` | `config/interceptor/certs/` | config | include | never | `sensitive`（私钥必须进备份） |
| `interceptor/extension/` | `cache/interceptor/` | cache | never | always | 从 resources 重建 |
| `offline-pack/history.json` | `config/offline-pack/` | config | include | never | `savedPath` 指向 cache，清后显示「文件已缺失」 |
| `offline-pack/downloads/` | `cache/offline-pack/downloads` | cache | never | always | 可重下 |
| `wxp-enhancer/config.json` | `config/wxp-enhancer/` | config | include | never | — |
| `wxp-enhancer/data-cache.json` | `config/wxp-enhancer/` | config | include | never | `sensitive`（我们写的登录态 → 按判据归 config，不塞进 `session/`） |
| `telegram-cache/{config,registry,archive-index,benchmarks}.json`、`telegram-session.bin` | `config/telegram-cache/` | config | include | never | — |
| `telegram-cache/archive/` | `<assets>/telegram-cache/archive/` | **assets** | manifest-only | never | 源可能已被删，不可再生 |
| `telegram-cache/{objects,tmp,mtproto,diagnostics}` | `cache/telegram-cache/` | cache | never | always | 清后须 `pruneMissingObjects()` 修剪索引 |
| `workbuddy2api-panel/{manifest,app-settings}.json`、`run/` | `config/workbuddy2api-panel/` | config | include | never | `run/` 是上游 cwd，含 api_key 与上游数据 |
| `workbuddy2api-panel/{downloads,runtime}` | `cache/workbuddy2api-panel/` | cache | never | always | 清后须校验 `runtime/current/<bin>`，否则显示「需重新下载」 |
| `session/`（现状） | `session/` | session | optional | internal | 不搬家，只新增 `sandbox/` |
| `treease-editor/`（空） | `config/treease-editor/rules.json` | config | include | never | 规则从 LocalStorage 上台面 |
| `data/config.db`、`data/cdp-injector/`、`.DS_Store` | `config/quarantine/<ts>/` | config | never | never | **仅白名单内的已知孤儿**；不删、不备份、不随清缓存消失 |
| （运行时自动产生） | `cache/import-rollback/<ts>/` | cache | never | always | 备份恢复前的配置层快照：回滚点，可随时清 |
| `data/.env` | 原地不动（`DATA_ROOT_KEEP_NAMES`） | —（不属任何层） | — | — | 用户自备凭据：隔离它等于删凭据 |

**留在 Local Storage 的**：打开的页签（会话性）、offline-pack 镜像地址（偏好）、env-browser 网页预览回退。
**迁到 `config/app/ui-preferences.json` 的**：收藏工具（用户数据，要能带走）。

## 5. 基建 API

### 5.1 `shared/data-layers.ts`（纯类型 / 常量 / 纯函数）

```ts
export type DataLayer = 'config' | 'assets' | 'session' | 'cache'

export interface DataLayerEntry {
  id: string                  // 'telegram-cache.objects'
  toolId: string | 'app'
  layer: DataLayer
  relativePath: string        // **相对所属层根**：'telegram-cache/objects'、'telegram-cache/archive'
  label: string
  backup: 'include' | 'optional' | 'manifest-only' | 'never'
  clean: 'never' | 'always' | 'internal-chromium-cache'
  sensitive?: boolean
  integrity?: 'index-prune' | 'reinstall-required' | 'missing-file-badge'
}

export const DATA_LAYER_ENTRIES: DataLayerEntry[]        // 落点清单（§4 的表）
export const DATA_LAYOUT_V1_TO_V2: DataLayoutMigrationRule[]  // 逐条目搬迁表（幂等）
export function joinLayerPath(...segments: string[]): string  // 纯字符串拼接，拒绝 '..' 与绝对路径
```

`relativePath` 为 `'.'` 的条目表示「层根本身」（`session.chromium`），统计层总量时已包含，条目明细不再重复计入。

### 5.2 `backend/utils/data-layers.ts`（运行期能力）

```ts
measureLayers(): Promise<Record<DataLayer, { bytes: number, entries: DataLayerEntryUsage[] }>>
getLayerRoot(layer): string                       // assets → <assets>，其余 → <data>/<layer>
resolveLayerPath(layer, ...segments): string      // 层内路径唯一入口
resolveLegacyPath(relToDataRoot): string          // v1 旧位置，迁移失败时容错回查
clearCacheLayer({ skipPaths }): Promise<CacheLayerCleanResult>   // 只动 cache 层
```

**硬约束**：工具不再自己 `path.join(getDataDirectory(), '工具', …)`，一律走 `resolveLayerPath`；
`scripts/` 加一条 grep/CI 断言收口（否则半年后又长歪）。

### 5.3 `backend/utils/data-layout-upgrade.ts`（v1→v2 一次性升级）

```ts
readDataLayoutVersion(dataDirectory): number
planDataLayoutUpgrade(roots): DataLayoutUpgradePlan     // 只读，供预览与验证
upgradeDataLayout(roots, { dryRun }): DataLayoutUpgradeResult
```

不依赖 Electron（根目录由调用方传入），因此可以用脚本对真实或临时目录做 dry-run。

## 6. 清理

- 「清缓存」= `cache/` 全部 + `session/` 内 Chromium 缓存名单（`CHROMIUM_SESSION_CACHE_DIRS`，10 个目录名），其余一概不动。
- 隔离区（`config/quarantine/`）**不在清理路径里**：它的内容是「不知归属的遗留物」，自动清一次可能就再也见不到了；
  用户看清体积后自行删除。不做自动淘汰（本期）。
- 清理后按 `integrity` 自愈：
  - `telegram-cache`：`pruneMissingObjects()` 剔除索引中已不存在的对象；
  - `workbuddy2api-panel`：重算「已安装 = 二进制存在」；
  - `offline-pack`：历史项标「文件已缺失」。
- 资产层与配置层**不进入任何自动清理路径**。

## 7. 迁移策略

`<userData>/data-root.pending.json`（保持「只写 pending、下次启动执行」）只描述**目录在哪**：

```json
{ "dataDirectory": "/target" }
```

- 迁移走 `migrateDataDirectory(from, to, { skipCache: true })`：**跳过顶层 `cache/`**（可再生，通常是整棵树里最大的一块），
  其余（`config` / `session` / `assets` / `.edt-layout.json`）逐条目复制 → 全部成功才删已复制的条目。
- 跳过就意味着「没搬全」，因此**不删旧目录、不删除旧目录里剩下的 `cache/`**：日志点名残留项并提示
  「旧目录里只剩可再生缓存，确认新目录可用后可手动删除」。
- 不做「按层勾选 / `layers` 配置 / `migration.json` 迁移台账」：那套要为「只删已复制条目、源目录常驻、两套布局并存」
  付长期维护成本，换来的只是少复制几分钟的可再生缓存——单用户本地工具的收益对不上复杂度。

## 8. 导出 / 导入（备份包）

格式：单文件 `edt-backup-<appVersion>-<yyyyMMdd-HHmmss>.edtbackup`（已落地，`shared/backup.ts` + `backend/utils/backup-format.ts`）

```text
[0..4) 'EDTB' | [4] 格式版本 | [5] flags(bit0=已加密) | [6..10) header 长度
header(JSON)   仅放加密参数：{ kdf:'scrypt', n, r, p, salt, iv }；未加密时为空对象
payload        gzip(条目表)；条目表 = u32 条目数 + 重复(u16 名长 | 名字 | u32 数据长 | 数据)
  首条目固定 manifest.json：
    { schemaVersion, appVersion, platform, createdAt, encrypted,
      strategy: { config: true, session: false, assets: 'manifest', cache: false },
      entries: [{ id, layer, relativePath, size, sha256 }],
      assets:  [{ relativePath, size, toolId }]   // 资产只出清单，不逐文件哈希
      omittedSensitive: [], totals: { files, bytes, assetFiles, assetBytes } }
  其余条目名 = `${layer}/${relativePath}`（如 config/interceptor/rules.json）
```

加密：`scrypt(口令, salt, 32)` → `AES-256-GCM(payload, iv)`，tag 附在密文尾部；
口令错误或包被篡改都会在 GCM 校验处失败（统一报「口令不正确或备份包已损坏」，不泄露细节）。

- 用 `node:crypto` + `node:zlib` 自研容器，不引入原生依赖（连 zip 加密库都不用）。
- 实现分工：`shared/backup.ts`（格式与类型声明，渲染层可用）/ `backend/utils/backup-format.ts`（容器编解码）/
  `backend/utils/backup-service.ts`（收集、导出、预检、恢复）。
- 默认只含 `config`；`sensitive` 条目（`envs.json`、`certs/ca.key`、`wxp data-cache.json`、workbuddy `run/config.json`）导出前**逐项列给用户**，可选「跳过」或「口令加密整包」。
- 导入：校验 magic/schema → 逐文件 sha256 → **预演**（将写入 / 冲突项）→ 把现有 `config/` 快照到
  `cache/import-rollback/<ts>/`（天然可清）→ 写入 → 失效内存缓存 → 若含 `session/` 提示「登录态需重启生效」。
  写入中途失败**自动回滚**：先删掉本次新增的文件，再用快照逐个覆盖回来，并把快照路径写进报告与错误信息
  （「不留半截配置」是可断言的：报告里必须有 `rollbackSnapshot`）。
- 恢复报告的「已恢复 N 项」只统计**真的写进磁盘**的条目（被跳过的会话层 / 非法路径不计入）。
- 实现要点：`json-store` **刻意没有缓存失效接口**（注释明确「运行期不需要」）。导入会打破该假设 → 新增 `invalidateJsonDocument(path?)`，仅备份导入流程可调。

## 9. 一次性布局升级 v1 → v2

- 布局版本标记：`<data>/.edt-layout.json` 的 `layoutVersion`（**放在数据根内**，随数据目录迁移一起走；缺失视为 v1）。
  不写进 `userData/data-root.json`：版本描述的是「这棵数据树长什么样」，而 `data-root.json` 描述的是「树在哪」，
  两者生命周期不同（把旧备份目录指过来时，版本应跟目录走而不是跟机器走）。
- 启动顺序：`configureInstanceIdentity()` → `loadDataDirectoryOverrideSync()` → **`upgradeDataLayout()`** → `configureSessionDataDirectory()`。
- 逐条按 §4 映射搬迁，优先 `rename`（同卷秒级），跨卷回落 `cp + rm`；单条失败不中断整体，记入 errors，该条留在旧位置且读取方用 `resolveLegacyPath` 容错回查一次。
- 孤儿只认**白名单**（`QUARANTINE_ORPHAN_NAMES`：`config.db` / `cdp-injector` / `.DS_Store`），进 `config/quarantine/<ts>/`，不删。
  未登记又不在白名单里的顶层项**原地不动**（只 warn）——「先把不认识的东西全隔离」会静默吃掉用户自己的文件。
- `.env`（`DATA_ROOT_KEEP_NAMES`）属于用户自备凭据，永远原地保留：tool 的 `.env` 读取是合法来源，隔离它等于删凭据。
- 隔离区在**配置层**而不是缓存层：放 `cache/` 下就意味着「清缓存顺手销毁不可再生数据」。它不备份、不自动清理。
- `session/` 不搬迁（sessionData 路径不变），只新增 `sandbox/`；`chrome-sandbox/sandboxes` → `session/sandbox` 搬完必须改写 `sandboxes.json` 里的绝对 `userDataPath`。
- 幂等：目标在、源不在 → 已完成；两边都在 → 冲突并跳过（绝不覆盖）；只有零错误零冲突才写版本标记，否则保持 v1 下次重试。
- 不支持降级：老版本读不到 v2 布局；`layoutVersion` 大于本版支持值时 `upgradeDataLayout()` **一个字节都不动**
  （`blockedByNewerLayout`），`electron/main.ts` 弹错误框后 `app.exit(1)`，避免新版数据被老版按自己的理解覆盖。
  逃生开关 `EDT_ALLOW_FUTURE_LAYOUT=1`（明知风险、只想打开看一眼时用，日志会 warn）。

## 10. P0 交付物与验证（已落地）

### 10.1 平台层

| 文件 | 作用 |
| --- | --- |
| `shared/data-layers.ts` | 四层元信息、落点清单 `DATA_LAYER_ENTRIES`、v1→v2 搬迁表 `DATA_LAYOUT_V1_TO_V2`、`CHROMIUM_SESSION_CACHE_DIRS`、`QUARANTINE_ORPHAN_NAMES`、`joinLayerPath`（条数以 `pnpm data-layers:check` 的输出为准，本文不抄数字） |
| `backend/utils/data-layers.ts` | `getLayerRoot` / `resolveLayerPath` / `resolveLegacyPath` / `resolveLayerPathWithFallback(layer, relativePath)`（旧位置由搬迁表推导）/ `measureLayers` / `clearCacheLayer` |
| `backend/utils/data-layout-upgrade.ts` | `readDataLayoutVersion` / `planDataLayoutUpgrade` / `upgradeDataLayout`（无 Electron 依赖，可脚本化） |
| `backend/utils/data-root-scan.ts` | 按层统计 `scanDataLayers` + 只清可再生部分 `clearDataLayerCaches` |
| `backend/utils/assets-root.ts` | 资产独立根：`assets-root.json` / pending 迁移 / 与数据根的关系守卫（P1） |
| `shared/backup.ts`、`backend/utils/backup-format.ts`、`backend/utils/backup-service.ts` | 备份包格式 / 容器编解码（gzip + 可选 AES-256-GCM）/ 导出·预检·恢复（P2） |
| `backend/utils/json-store.ts` | 新增 `invalidateJsonDocuments()`：**只允许备份恢复调用**（运行期替换了盘上文件） |
| `backend/utils/session-data.ts` | sessionData 指向会话层；Electron 日志 / 崩溃转储指向缓存层 |
| `backend/utils/appearance-store.ts`、`window-bounds-store.ts` | 应用壳配置落 `config/app/`（读取带回查 v1 与 userData 旧位置） |
| `electron/main.ts` | 启动串 `upgradeDataLayout()`（在 sessionData 重定向之前、幂等、失败不阻断启动） |
| `backend/ipc/handlers.ts`、`shared/app.ts`、`renderer/pages/SettingsPage.vue` | IPC 载荷改为 `DataUsage`（四层 + 条目明细），设置页改为「数据分层」卡片 |

### 10.2 工具层（全部改走 `resolveLayerPath`）

chrome-sandbox（配置 / `session/sandbox` profile / 共享扩展缓存）、env-browser、interceptor（配置+证书 / 扩展缓存）、
offline-pack（历史 / 下载）、wxp-enhancer、telegram-cache（索引+密文 / 资产归档 / 对象缓存）、
workbuddy2api-panel（manifest+run / 二进制缓存）。

telegram 的索引兼容做法：`registry.json` / `archive-index.json` 里的 `relativePath` 保持相对「工具命名空间」
（`objects/ab/hash`、`archive/resources/…`），由 `resolveTelegramRelativePath()` 按首段路由到 config / assets / cache，
**v1 旧索引无需改写**。

### 10.3 工具与门禁

```bash
pnpm data-layout plan                     # 预览当前数据根的 v1→v2 搬迁计划（只读）
pnpm data-layout apply --data <dir> --yes # 手工搬迁（必须先关闭应用）
pnpm data-layers:check                    # 分层断言：清单/搬迁表一致性 + 禁止绕过 resolveLayerPath 拼数据根
```

### 10.4 验证记录

- `pnpm typecheck`（前端 + 后端两套 tsconfig）通过；`pnpm lint` 通过；`pnpm check:ui` 通过；
- `pnpm build:electron` 产出 `data-layers.js` / `data-layout-upgrade.js` / `data-root-scan.js` / `shared/data-layers.js`
  （新增主进程模块必须确认产物存在，否则启动即 `ERR_MODULE_NOT_FOUND`）；
- 合成 v1 目录实测升级：条目搬迁、`sandboxes.json` 绝对路径改写为 `session/sandbox/…`、白名单孤儿进 `config/quarantine/<ts>/`、
  未登记项原地保留、旧顶层目录回收；重复执行返回「已是 v2」；同名冲突跳过且不覆盖、版本不写入；
- `data-layers:check` 在真实仓库上通过（条目数 / 后端文件数以脚本输出为准，本仓库当前 1 处显式 `data-layers:allow` 豁免）；
- 别名绕过实测：临时文件里 `const root = getDataDirectory(); path.join(root, 'x')` 与
  `path.join(getDataDirectory(), 'x')` 两种写法均被断言拦下，带 `data-layers:allow <原因>` 的行放行。

P1（资产独立根）追加验证：

- 设置页「数据分层 → 资产」可打开 / 更改位置，更改只写 `userData/assets-root.pending.json` 并提示重启；
- 启动顺序 `loadDataDirectoryOverrideSync()` → **`loadAssetsRootSync()`** → `upgradeDataLayout()` → `configureSessionDataDirectory()`：
  归档随布局升级直接落到生效的资产根（自定义根时不会写进数据目录）；
- 迁移复用 `migrateDataDirectory()`（复制全部成功才删源）；失败保留旧位置 + pending，下次重试；
- 关系守卫拒绝对话：资产根 = 数据根、数据根在资产根内、资产根落在 `config`/`session`/`cache` 层内、目标目录非空。

P2（备份导出/恢复）追加验证：

- 容器往返（node 直跑 `dist-electron/backend/utils/backup-format.js`）：未加密 / 加口令两条路径均往返一致，
  含中文路径、空文件、200 KB 文件；缺口令报「需要口令」、错口令与被篡改包报「口令不正确或备份包已损坏」、
  非备份包报 magic 不符、格式版本过高明确拒绝；
- 设置页「备份与恢复」：导出前逐项列出敏感条目，可「包含敏感项 / 跳过敏感项」+ 可选口令；资产层只出清单（无「含资产内容」选项）；
  恢复先预检（sha256 全量校验）→ 展示摘要 → 覆盖恢复 → 报告回滚快照位置与缺失资产；
- 恢复只写 `config`（与可选 `session`）层，遇到 `assets/`、`cache/` 条目一律跳过并写进 warnings；
- 恢复前把现有配置层快照到 `cache/import-rollback/<时间戳>/`，恢复后调用 `invalidateJsonDocuments()`。
- 恢复中途抛错 → 新增文件被删、快照覆盖回来，报错信息与报告里都带 `rollbackSnapshot` 路径
  （恢复前配置层为空时改为删掉本次写过的文件）；恢复成功时 `restoredEntries` 只含真的写进磁盘的条目 id。

### 10.5 P3：凭据加密 / 状态文件化 / 清理自愈

- **凭据静态加密**（`backend/utils/secret-box.ts`）：统一信封 `edt-secret:<base64(safeStorage)>`；
  `openSecret()` 对非信封值原样返回，因此旧明文文件照旧可读、第一次写入自动升级。
  - `env-browser/envs.json` 的 `password` 逐条加密；读盘时解密进内存（渲染层仍是明文，属既有行为），
    检测到旧明文即就地写回密文；
  - `wxp-enhancer/data-cache.json` 整份封为 `{ schemaVersion: 2, sealed }`（token / 用户对象 / 收藏备份）；
  - safeStorage 不可用时两者都退化为明文并 warn——**加密是增强，不是功能前提**。
  - 解不开的密文（换机器 / 系统密钥变化）**原样保留**：`openSecretDetailed()` 报 `failed`，store 写盘时把
    原密文写回，不把空串当新密码落盘（否则一轮「读 → 升级写回」就静默删掉用户密码）。
- **LocalStorage 上台面**：
  - treease 拦截规则与开关 → `config/treease-editor/rules.json`（`rules-store.ts`，白名单字段校验），
    LocalStorage 降级为镜像；首次挂载时若配置层为空则把镜像迁上去；
  - 收藏的工具 → `config/app/ui-preferences.json`（`ui-preferences-store.ts`，去重限量），同样镜像兜底网页预览。
- **清理自愈钩子**（`data-root-scan.ts` 的 `registerCacheIntegrityHandler`，对应条目上的 `integrity` 字段）：
  - telegram：清掉 `objects/` 后立即 `pruneTelegramRegistry()`（不必等重启）；
  - workbuddy：清掉 `runtime/` 后立即 `publishStateNow()`，「已安装」按二进制是否真的存在重算
    （manifest 只提供版本号，因此清缓存后 UI 立刻变成"需重新下载"）；
  - offline-pack：`listHistory()` 现算 `exists` / `size`，历史里显示「文件已缺失」徽标。

**剩余可选项**（不在本期范围）：自动淘汰 / 容量上限、云同步、资产内容进备份包。

## 11. 不变量（验收断言）

1. 清空 `cache/` 后：应用正常启动；账号 / 规则 / 登录态 / 证书 / 归档全在；telegram 索引已修剪；workbuddy 显示「需重新下载」；offline-pack 历史标缺失；隔离区（`config/quarantine/`）不受影响。
2. 导出包内零 `cache` 条目；`sensitive` 按开关处理；`assets` 默认只有清单；包内 sha256 全通过。
3. 导入只写 `config`（+可选 `session`），失败**自动回滚**并返回 `rollbackSnapshot`（报告里必须能拿到快照路径，可据此人工复核）。
4. 迁移跳过 `cache` 时：新目录可用、旧目录保留且只剩 `cache/`、迁移结果里 `skipped` 列出了它。
5. 资产根搬家后，`archive-index.json` 无需改写即可命中（路径相对化）。
6. 代码中不存在绕过 `resolveLayerPath` 的直接拼接（CI 断言）：`data-layers:check` 会解析
   `const root = getDataDirectory()` 这类别名，豁免**只能**写 `data-layers:allow <原因>`（原因必填、逐行生效），
   不存在「行内出现某个词就放过」的通道。
7. 设置页四层卡片体积之和 = 数据根 + 资产根实际占用（无重复计数）。
8. `pnpm typecheck` + `pnpm check:ui` 通过。

## 12. UI（设置页 → 数据与备份）

```text
配置 · 必须备份        3.2 MB   32 项            [导出备份…]
资产 · 独立位置        412 GB   <assets> 路径    [更改位置…] [打开]
会话 · 登录态          87 MB    Chromium 管      [仅清内部缓存…]
缓存 · 可再生          1.4 GB                    [清理缓存…]  ← 副标题：不会删除账号、规则、登录态、证书、归档
```

- 每层可展开工具明细；`sensitive` 打徽标。
- 「清理缓存」按钮下方固定说明不删范围。
- 资产卡片展示位置、体积，并提供「更改位置」「打开」（更改写 pending + 提示重启）。**不做剩余空间探测**：
  跨平台取空闲空间要额外依赖 / 原生调用，卡片上给位置与体积已经够判断。

## 13. 分期

| 期 | 内容 | 状态 / 风险 |
| --- | --- | --- |
| **P0a** | `shared/data-layers.ts` 清单、`backend/utils/data-layers.ts`、v1→v2 升级器 + quarantine、`scripts/data-layout.mjs` 预览/执行 | ✅ 已交付（§10） |
| **P0b** | `main.ts` 串 `upgradeDataLayout()`、各工具改走 `resolveLayerPath`（含旧位置容错）、`data-root-scan` 按层统计、设置页四层展示、`data-layers:check` 断言 | ✅ 已交付（§10） |
| **P1** | 资产根：`assets-root.json` / pending / `migrateAssetsDirectory` / 归档相对路径 / 设置页「更改位置」 | ✅ 已交付（§3） |
| **P2** | 备份包格式 + 导出/导入 + `invalidateJsonDocuments` + 敏感项提示 + 导入回滚 | ✅ 已交付（§8） |
| **P3** | `envs.json` / wxp tokens 走 `safeStorage`（明文自动升级）、treease 规则落 `config/`、收藏迁 `config/app/ui-preferences.json`、workbuddy 二进制缺失态、telegram 索引修剪 | ✅ 已交付（§10.5） |

## 14. 明确不做

- 不做容量上限 / LRU 自动淘汰（本期只做分层 + 手动清理）。
- 不做云同步 / 增量备份。
- 不把 Chromium 的 Cookies 拆成单独可导出文件（跨机常失效，`session` 默认不进备份）。
- 不引入数据库或原生依赖。
