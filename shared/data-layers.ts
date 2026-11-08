// 数据分层（配置 config / 资产 assets / 会话 session / 缓存 cache）的**单一清单**：
// 只放纯类型、常量与纯函数（不依赖 Electron / Node / 文件系统），
// 因此「哪个文件属于哪一层、能不能备份、能不能清」可以在一处 review。
//
// 判定链（docs/data-layers.md §1）：
//   1. 不是我们写的 → session（Chromium 拥有，只使用不解析）
//   2. 我们写、可再生（网络可重新获取、丢失无副作用）→ cache
//   3. 我们写、不可再生、用户显式产出（归档/产出，非运行期副产物）→ assets
//   4. 其余 → config（含密文凭据时标 sensitive）
//
// 执行侧：路径与统计见 backend/utils/data-layers.ts，v1→v2 布局升级见
// backend/utils/data-layout-upgrade.ts。**归属判断只写在这里，不要在执行侧另立一份。**

export type DataLayer = 'config' | 'assets' | 'session' | 'cache'

export const DATA_LAYERS: readonly DataLayer[] = ['config', 'assets', 'session', 'cache']

export interface DataLayerMeta {
  label: string
  /** 一行为什么这一层是这一层，直接用于设置页说明文案 */
  summary: string
  /** 物理根落在哪个根目录下 */
  root: 'data' | 'assets'
  /** 是否进入备份包（层级默认值，条目可再细化） */
  backup: 'include' | 'optional' | 'never'
  /** 是否可被「清缓存」触碰 */
  cleanable: boolean
}

export const DATA_LAYER_META: Record<DataLayer, DataLayerMeta> = {
  config: {
    label: '配置',
    summary: '账号 / 规则 / 索引 / 证书 / 加密凭据：不可再生，永不自动清理',
    root: 'data',
    backup: 'include',
    cleanable: false,
  },
  assets: {
    label: '资产',
    summary: '用户显式归档的产出：不可再生、体量大，可单独设置存储位置',
    root: 'assets',
    backup: 'optional',
    cleanable: false,
  },
  session: {
    label: '会话',
    summary: 'Chromium 拥有的登录态与页面数据：内部已知缓存子目录可清',
    root: 'data',
    backup: 'optional',
    cleanable: true,
  },
  cache: {
    label: '缓存',
    summary: '可再生数据与临时文件：可一键清理，任意时刻丢失都能重建',
    root: 'data',
    backup: 'never',
    cleanable: true,
  },
}

/** 备份策略：include 必含 / optional 默认含可排除 / manifest-only 只出清单 / never 永不导出 */
export type DataBackupPolicy = 'include' | 'optional' | 'manifest-only' | 'never'

/** 清理策略：never 不动 / always 整块可清 / internal-chromium-cache 只清内部缓存子目录 */
export type DataCleanPolicy = 'never' | 'always' | 'internal-chromium-cache'

/**
 * Chromium 系浏览器在用户数据目录内固定的缓存目录名（会话层内部的沙箱 profile 同样适用）。
 * 全仓**只此一份**：清缓存（`data-root-scan`）与备份跳过会话层缓存（`backup-service`）都引用它。
 */
export const CHROMIUM_SESSION_CACHE_DIRS: readonly string[] = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GraphicsCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Media Cache',
]

/**
 * 清理后必须执行的自愈动作（缺了会让 UI 与实际磁盘状态脱节）：
 * - index-prune：剔除索引里已不存在的对象
 * - reinstall-required：重算「已安装」= 二进制真的存在
 * - missing-file-badge：历史记录里标「文件已缺失」
 */
export type DataIntegrityAction = 'index-prune' | 'reinstall-required' | 'missing-file-badge'

export interface DataLayerEntry {
  /** 稳定 id（用于 IPC 与审计日志，不要随手改） */
  id: string
  toolId: string
  layer: DataLayer
  /** **相对所属层根**的路径（如 config 层的 'tweb-cache/config.json'） */
  relativePath: string
  label: string
  backup: DataBackupPolicy
  clean: DataCleanPolicy
  /** 含凭据（密码 / token / 私钥）：导出前必须逐项提示 */
  sensitive?: boolean
  integrity?: DataIntegrityAction
}

/**
 * 落点清单：与 docs/data-layers.md §4 的映射表逐行对应。
 * 新增工具落盘时先在这里加一条，再让工具用 resolveLayerPath 取路径。
 */
export const DATA_LAYER_ENTRIES: readonly DataLayerEntry[] = [
  // ── 配置层 ──
  { id: 'app.window-appearance', toolId: 'app', layer: 'config', relativePath: 'app/window-appearance.json', label: '窗口外观', backup: 'include', clean: 'never' },
  { id: 'app.window-bounds', toolId: 'app', layer: 'config', relativePath: 'app/window-bounds.json', label: '窗口大小与位置', backup: 'include', clean: 'never' },
  { id: 'app.ui-preferences', toolId: 'app', layer: 'config', relativePath: 'app/ui-preferences.json', label: '收藏的工具与首页排序', backup: 'include', clean: 'never' },
  { id: 'interceptor.config', toolId: 'interceptor', layer: 'config', relativePath: 'interceptor/config.json', label: '拦截配置', backup: 'include', clean: 'never' },
  { id: 'interceptor.rules', toolId: 'interceptor', layer: 'config', relativePath: 'interceptor/rules.json', label: '拦截规则', backup: 'include', clean: 'never' },
  { id: 'interceptor.certs', toolId: 'interceptor', layer: 'config', relativePath: 'interceptor/certs', label: '根 CA 证书与私钥', backup: 'include', clean: 'never', sensitive: true },
  { id: 'offline-pack.history', toolId: 'offline-pack', layer: 'config', relativePath: 'offline-pack/history.json', label: '下载历史', backup: 'include', clean: 'never', integrity: 'missing-file-badge' },
  { id: 'skill-manager.registry', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/registry.json', label: '技能安装记录、基线与仓库快照', backup: 'include', clean: 'never' },
  { id: 'skill-manager.projects', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/projects.json', label: '项目登记表', backup: 'include', clean: 'never' },
  { id: 'skill-manager.favorites', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/favorites.json', label: '技能收藏与分类', backup: 'include', clean: 'never' },
  { id: 'skill-manager.presets', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/presets.json', label: '技能预设（来源清单）', backup: 'include', clean: 'never' },
  { id: 'skill-manager.settings', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/settings.json', label: '技能管理设置', backup: 'include', clean: 'never' },
  { id: 'skill-manager.credentials', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/credentials.json', label: '按 host 保存的 PAT（safeStorage 信封）', backup: 'include', clean: 'never', sensitive: true },
  { id: 'skill-manager.history', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/history.json', label: '技能操作历史', backup: 'optional', clean: 'never' },
  { id: 'skill-manager.lock-backups', toolId: 'skill-manager', layer: 'config', relativePath: 'skill-manager/lock-backups', label: '写锁前快照', backup: 'include', clean: 'never' },
  { id: 'wxp-enhancer.config', toolId: 'wxp-enhancer', layer: 'config', relativePath: 'wxp-enhancer/config.json', label: '注入设置', backup: 'include', clean: 'never' },
  { id: 'wxp-enhancer.data-cache', toolId: 'wxp-enhancer', layer: 'config', relativePath: 'wxp-enhancer/data-cache.json', label: '采集的登录态与收藏备份', backup: 'include', clean: 'never', sensitive: true },
  { id: 'tweb-cache.config', toolId: 'tweb-cache', layer: 'config', relativePath: 'tweb-cache/config.json', label: '站点端口（tweb 前端）', backup: 'include', clean: 'never' },
  { id: 'tweb-cache.aliases', toolId: 'tweb-cache', layer: 'config', relativePath: 'tweb-cache/archive-alias.json', label: '等价缓存索引（转发 / 同媒体副本，可由 manifest 重建）', backup: 'optional', clean: 'never' },
  { id: 'tweb-cache.peer-dirs', toolId: 'tweb-cache', layer: 'config', relativePath: 'tweb-cache/peer-dirs.json', label: '群目录名登记（username + peer id，可由 manifest 重建）', backup: 'include', clean: 'never' },
  { id: 'workbuddy2api-panel.manifest', toolId: 'workbuddy2api-panel', layer: 'config', relativePath: 'workbuddy2api-panel/manifest.json', label: '托管二进制清单', backup: 'include', clean: 'never', integrity: 'reinstall-required' },
  { id: 'workbuddy2api-panel.settings', toolId: 'workbuddy2api-panel', layer: 'config', relativePath: 'workbuddy2api-panel/app-settings.json', label: '面板设置', backup: 'include', clean: 'never' },
  { id: 'workbuddy2api-panel.run', toolId: 'workbuddy2api-panel', layer: 'config', relativePath: 'workbuddy2api-panel/run', label: '上游运行目录（api_key / auths / data）', backup: 'include', clean: 'never', sensitive: true },
  { id: 'treease-editor.rules', toolId: 'treease-editor', layer: 'config', relativePath: 'treease-editor/rules.json', label: '页面拦截规则与开关', backup: 'include', clean: 'never' },
  // 隔离区在**配置层**而不是缓存层：进缓存层等于「清缓存顺手销毁不可再生数据」（docs/data-layers.md §9）。
  // 它不备份（不知归属的遗留物进包只会污染备份）、也不自动清理（避免二次误删），由用户看过体积后自行处理。
  { id: 'app.quarantine', toolId: 'app', layer: 'config', relativePath: 'quarantine', label: '旧布局隔离区（未登记遗留项）', backup: 'never', clean: 'never' },

  // ── 资产层（独立根 <assets>）──
  { id: 'tweb-cache.messages', toolId: 'tweb-cache', layer: 'assets', relativePath: 'tweb-cache/messages', label: '消息级缓存（tweb 前端，manifest + message.md + 媒体）', backup: 'manifest-only', clean: 'never' },
  { id: 'tweb-cache.trash', toolId: 'tweb-cache', layer: 'assets', relativePath: 'tweb-cache/trash', label: '回收站（tweb 前端，默认保留 30 天）', backup: 'manifest-only', clean: 'never' },
  { id: 'skill-manager.trash', toolId: 'skill-manager', layer: 'assets', relativePath: 'skill-manager/trash', label: '技能回收站（manifest + 被移除目录）', backup: 'manifest-only', clean: 'never' },
  { id: 'skill-manager.disabled', toolId: 'skill-manager', layer: 'assets', relativePath: 'skill-manager/disabled', label: '已禁用技能目录（可恢复）', backup: 'include', clean: 'never' },

  // ── 会话层（Chromium 拥有；relativePath '.' 表示层根本身）──
  { id: 'session.chromium', toolId: 'app', layer: 'session', relativePath: '.', label: 'Cookies / LocalStorage / 页面缓存', backup: 'optional', clean: 'internal-chromium-cache' },
  // 各工具的 webview 分区（tweb-cache / treease-editor / workbuddy2api-panel / env-<id>）
  // 由 Chromium 动态创建在 session/Partitions 下，不能静态列举，统计时随 session 层整体计入。

  // ── 缓存层 ──
  { id: 'app.logs', toolId: 'app', layer: 'cache', relativePath: 'app/logs', label: '主进程日志', backup: 'never', clean: 'always' },
  { id: 'app.crash-dumps', toolId: 'app', layer: 'cache', relativePath: 'app/crash-dumps', label: '崩溃转储', backup: 'never', clean: 'always' },
  // 备份恢复前自动生成的配置层快照：回滚点。可再生（清缓存即可丢），但**不随清缓存删除**自动快照以外的东西
  { id: 'app.import-rollback', toolId: 'app', layer: 'cache', relativePath: 'import-rollback', label: '备份恢复回滚快照', backup: 'never', clean: 'always' },
  { id: 'interceptor.extension', toolId: 'interceptor', layer: 'cache', relativePath: 'interceptor/extension', label: '运行时扩展（可重建）', backup: 'never', clean: 'always' },
  { id: 'offline-pack.downloads', toolId: 'offline-pack', layer: 'cache', relativePath: 'offline-pack/downloads', label: '下载的离线包', backup: 'never', clean: 'always' },
  { id: 'skill-manager.repos', toolId: 'skill-manager', layer: 'cache', relativePath: 'skill-manager/repos', label: '远端仓库快照与 tarball 缓存', backup: 'never', clean: 'always' },
  { id: 'skill-manager.staging', toolId: 'skill-manager', layer: 'cache', relativePath: 'skill-manager/staging', label: '安装暂存区', backup: 'never', clean: 'always' },
  { id: 'skill-manager.tmp', toolId: 'skill-manager', layer: 'cache', relativePath: 'skill-manager/tmp', label: '安装临时目录', backup: 'never', clean: 'always' },
  { id: 'tweb-cache.objects', toolId: 'tweb-cache', layer: 'cache', relativePath: 'tweb-cache/objects', label: '资源对象（tweb 前端，按哈希去重）', backup: 'never', clean: 'always', integrity: 'index-prune' },
  { id: 'tweb-cache.tmp', toolId: 'tweb-cache', layer: 'cache', relativePath: 'tweb-cache/tmp', label: '下载临时文件（tweb 前端）', backup: 'never', clean: 'always' },
  { id: 'tweb-cache.diagnostics', toolId: 'tweb-cache', layer: 'cache', relativePath: 'tweb-cache/diagnostics', label: '诊断包（tweb 前端）', backup: 'never', clean: 'always' },
  { id: 'workbuddy2api-panel.downloads', toolId: 'workbuddy2api-panel', layer: 'cache', relativePath: 'workbuddy2api-panel/downloads', label: '上游二进制下载', backup: 'never', clean: 'always' },
  { id: 'workbuddy2api-panel.runtime', toolId: 'workbuddy2api-panel', layer: 'cache', relativePath: 'workbuddy2api-panel/runtime', label: '上游二进制（current/previous/staging）', backup: 'never', clean: 'always', integrity: 'reinstall-required' },
]

// ── 布局版本与 v1 → v2 映射 ──

/** 当前布局版本；1 = 平铺 `<data>/<工具>/…`，2 = 分层 `<data>/{config,session,cache}` + `<assets>` */
export const DATA_LAYOUT_VERSION = 2

/** 布局版本标记文件（位于数据根内，随数据目录迁移一起走；缺失视为 v1） */
export const DATA_LAYOUT_VERSION_FILE = '.edt-layout.json'

/**
 * 旧布局里无法归类的遗留项搬进这里（**配置层下**：不删、不备份、不随「清缓存」消失）。
 * 放在 `cache/` 下曾经等于「清缓存顺手销毁不可再生数据」——隔离区的意义是留证据，不是丢垃圾。
 */
export const QUARANTINE_RELATIVE_DIR = 'config/quarantine'

/**
 * 允许被隔离的**已知孤儿白名单**：只有这些名字会被搬进隔离区。
 * 其余未登记的顶层项一律**原地不动**（只 warn）——「宁可错杀」的代价是静默吃掉用户凭据。
 */
export const QUARANTINE_ORPHAN_NAMES: readonly string[] = [
  'config.db',
  'cdp-injector',
  '.DS_Store',
]

/**
 * 数据根里必须原地保留的文件（不隔离、不进任何层）：用户自备的东西，我们不拥有也不理解。
 * `.env` 是用户自备的凭据文件，隔离它等于删凭据。
 */
export const DATA_ROOT_KEEP_NAMES: readonly string[] = [
  '.env',
  '.env.local',
]

export type DataLayoutEntryKind = 'file' | 'dir'

export interface DataLayoutMigrationRule {
  id: string
  layer: DataLayer
  /** 旧位置：相对数据根 */
  from: string
  /** 新位置：**相对所属层根 */
  to: string
  kind: DataLayoutEntryKind
  note?: string
}

/**
 * v1 → v2 的搬迁表（**逐条目显式列出**，不做整目录粗搬——同一个工具目录里同时有配置、
 * 资产与缓存，整搬会把可再生数据塞进备份范围）。
 *
 * 执行器逐条处理，天然幂等：
 * 目标不存在 + 源存在 → 搬；两边都在 → 记为冲突并跳过（绝不覆盖）；源不存在 → 已完成或本来没有。
 * 失败条目原地保留，v2 的路径 helper 会容错回查旧位置。
 */
export const DATA_LAYOUT_V1_TO_V2: readonly DataLayoutMigrationRule[] = [
  // 应用壳
  { id: 'app.window-appearance', layer: 'config', from: 'app/window-appearance.json', to: 'app/window-appearance.json', kind: 'file' },
  { id: 'app.window-bounds', layer: 'config', from: 'app/window-bounds.json', to: 'app/window-bounds.json', kind: 'file' },
  { id: 'app.logs', layer: 'cache', from: 'app/logs', to: 'app/logs', kind: 'dir' },
  { id: 'app.crash-dumps', layer: 'cache', from: 'app/crash-dumps', to: 'app/crash-dumps', kind: 'dir' },

  // interceptor
  { id: 'interceptor.config-json', layer: 'config', from: 'interceptor/config.json', to: 'interceptor/config.json', kind: 'file' },
  { id: 'interceptor.rules-json', layer: 'config', from: 'interceptor/rules.json', to: 'interceptor/rules.json', kind: 'file' },
  { id: 'interceptor.certs', layer: 'config', from: 'interceptor/certs', to: 'interceptor/certs', kind: 'dir', note: '敏感：根 CA 私钥' },
  { id: 'interceptor.extension', layer: 'cache', from: 'interceptor/extension', to: 'interceptor/extension', kind: 'dir', note: '可从 resources 重建' },

  // offline-pack
  { id: 'offline-pack.history-json', layer: 'config', from: 'offline-pack/history.json', to: 'offline-pack/history.json', kind: 'file' },
  { id: 'offline-pack.downloads', layer: 'cache', from: 'offline-pack/downloads', to: 'offline-pack/downloads', kind: 'dir', note: '可重新下载' },

  // wxp-enhancer
  { id: 'wxp-enhancer.config-json', layer: 'config', from: 'wxp-enhancer/config.json', to: 'wxp-enhancer/config.json', kind: 'file' },
  { id: 'wxp-enhancer.data-cache-json', layer: 'config', from: 'wxp-enhancer/data-cache.json', to: 'wxp-enhancer/data-cache.json', kind: 'file', note: '敏感：采集到的 token / 用户对象' },

  // workbuddy2api-panel：运行时配置归配置，二进制归缓存
  { id: 'workbuddy2api-panel.manifest-json', layer: 'config', from: 'workbuddy2api-panel/manifest.json', to: 'workbuddy2api-panel/manifest.json', kind: 'file' },
  { id: 'workbuddy2api-panel.settings-json', layer: 'config', from: 'workbuddy2api-panel/app-settings.json', to: 'workbuddy2api-panel/app-settings.json', kind: 'file' },
  { id: 'workbuddy2api-panel.run', layer: 'config', from: 'workbuddy2api-panel/run', to: 'workbuddy2api-panel/run', kind: 'dir', note: '上游 cwd：api_key / auths / data' },
  { id: 'workbuddy2api-panel.downloads', layer: 'cache', from: 'workbuddy2api-panel/downloads', to: 'workbuddy2api-panel/downloads', kind: 'dir' },
  { id: 'workbuddy2api-panel.runtime', layer: 'cache', from: 'workbuddy2api-panel/runtime', to: 'workbuddy2api-panel/runtime', kind: 'dir', note: '上游二进制，可重新下载' },

  // 预留目录（旧版通常为空或不存在）
  { id: 'treease-editor.data', layer: 'config', from: 'treease-editor', to: 'treease-editor', kind: 'dir' },
]

/** 需要在导出前逐项提示的凭据条目 */
export function getSensitiveEntries(): DataLayerEntry[] {
  return DATA_LAYER_ENTRIES.filter(entry => entry.sensitive === true)
}

/**
 * 纯字符串相对路径拼接（不引入 node:path，shared 层必须保持无 Node 依赖）。
 * 拒绝绝对路径与 `..`：分层路径一旦越界，清理与备份就会碰到别的层。
 */
export function joinLayerPath(...segments: string[]): string {
  const parts: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment.startsWith('/') || /^[a-z]:/i.test(segment)) {
      throw new Error(`分层路径不允许绝对路径片段：${segment}`)
    }
    for (const piece of segment.split('/')) {
      if (!piece || piece === '.') continue
      if (piece === '..') throw new Error(`分层路径不允许 '..'：${segment}`)
      parts.push(piece)
    }
  }
  return parts.join('/')
}
