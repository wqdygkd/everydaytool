// 备份包（`.edtbackup`）的**共享声明**：纯类型 / 常量 / 纯函数，主进程与渲染层都能引用。
//
// 设计（docs/data-layers.md §8）：
// - 只装**不可再生**的数据：配置层默认必含，会话层可选（默认不含），资产层只出**清单**（内容不打包：
//   GB~TB 级、且恢复流程按设计不写 assets），缓存层永不进入备份；
// - 容器是自研的「magic + 头 + 压缩体」，不引入原生依赖（zip 加密库都不引）；口令加密走
//   scrypt + AES-256-GCM，实现见 backend/utils/backup-format.ts；
// - 敏感条目（账号密码 / CA 私钥 / token / api_key）导出前逐项列给用户，可「跳过敏感项」或加口令。
import type { DataLayer } from './data-layers.ts'

export const BACKUP_FILE_EXTENSION = '.edtbackup'
export const BACKUP_MAGIC = 'EDTB'
export const BACKUP_FORMAT_VERSION = 1

export interface BackupEntryRecord {
  /** 对应 shared/data-layers.ts 的条目 id（恢复时据此校验层与路径） */
  id: string
  layer: DataLayer
  /** 相对层根的路径 */
  relativePath: string
  size: number
  /** 资产清单（manifest-only）不逐文件哈希时为空：体量大，哈希会拖到分钟级 */
  sha256: string | null
}

/** 包内单个文件（name = `${layer}/${relativePath}`，manifest.json 除外）；Uint8Array 以便 shared 层不依赖 Node */
export interface BackupFileRecord {
  name: string
  data: Uint8Array
}

export interface BackupAssetRecord {
  /** 相对资产根的路径（如 telegram-cache/archive/resources/res-xxx/resource.bin） */
  relativePath: string
  size: number
  toolId: string
}

export interface BackupStrategy {
  config: boolean
  session: boolean
  /** 资产层只出清单（路径 / size / 所属工具），内容永不进包 */
  assets: 'manifest' | 'none'
  cache: false
}

export interface BackupManifest {
  schemaVersion: 1
  appVersion: string
  platform: string
  createdAt: string
  encrypted: boolean
  strategy: BackupStrategy
  entries: BackupEntryRecord[]
  /** 资产清单：默认只记录路径与体积，内容不在包里 */
  assets: BackupAssetRecord[]
  /** 因含凭据而被跳过的条目 id */
  omittedSensitive: string[]
  totals: {
    files: number
    bytes: number
    assetFiles: number
    assetBytes: number
  }
}

export interface BackupExportOptions {
  /** 口令（空 = 不加密）。加密只保护包内容，不替代「妥善保管」这件事 */
  password?: string
  includeSession?: boolean
  /** 跳过敏感条目（账号 / 私钥 / token） */
  skipSensitive?: boolean
}

export interface BackupExportResult {
  savedPath: string
  bytes: number
  encrypted: boolean
  includedEntries: string[]
  omittedSensitive: string[]
  assetFiles: number
}

export interface BackupInspectResult {
  filePath: string
  encrypted: boolean
  /** 每个文件的 sha256 校验结果（true = 全部通过） */
  checksumOk: boolean
  manifest: BackupManifest | null
  /** 加密且未提供口令时为 true：调用方需要再调一次并带上口令 */
  needsPassword: boolean
}

export interface BackupRestoreReport {
  filePath: string
  restoredEntries: string[]
  skippedEntries: string[]
  /** 恢复前的配置层快照位置（位于缓存层，可随时清掉） */
  rollbackSnapshot: string | null
  /** 资产清单对账：包里记录、本机缺失的资产 */
  missingAssets: string[]
  /** 是否写入过会话层（需要重启才能让 Chromium 用上） */
  touchedSession: boolean
  warnings: string[]
}

/** 备份文件名：`edt-backup-<版本>-<yyyyMMdd-HHmmss>.edtbackup` */
export function formatBackupFileName(appVersion: string, createdAt: Date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  const stamp = [
    createdAt.getFullYear(),
    pad(createdAt.getMonth() + 1),
    pad(createdAt.getDate()),
    '-',
    pad(createdAt.getHours()),
    pad(createdAt.getMinutes()),
    pad(createdAt.getSeconds()),
  ].join('')
  const version = String(appVersion || '0.0.0').replace(/[^\w.-]/g, '')
  return `edt-backup-${version}-${stamp}${BACKUP_FILE_EXTENSION}`
}
