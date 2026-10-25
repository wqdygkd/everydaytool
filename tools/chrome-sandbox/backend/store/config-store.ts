// chrome-sandbox 工具配置（data/chrome-sandbox/config.json）：Chrome 路径 / 默认 Profile / 启动行为。
// dataDirectory 不落本文件——数据根目录由平台层 data-root 统一管理，这里只回读当前值。
import type { AppConfig, AppConfigUpdate } from '../../../../shared/sandbox.ts'
import path from 'node:path'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { getChromeSandboxDataDirectory } from '../utils/path-helper.ts'

type StoredConfig = Omit<AppConfig, 'dataDirectory'>

const DEFAULTS: StoredConfig = {
  chromePath: '',
  defaultProfile: '',
  autoRestoreOnStartup: false,
  preserveDataOnClose: true,
}

function getConfigPath(): string {
  return path.join(getChromeSandboxDataDirectory(), 'config.json')
}

function readStoredConfig(): Partial<StoredConfig> {
  const data = readJsonDocument<unknown>(getConfigPath(), () => ({}))
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Partial<StoredConfig> : {}
}

function writeStoredConfig(config: Partial<StoredConfig>): void {
  writeJsonDocument(getConfigPath(), config)
}

/** 逐字段取值 + 默认兜底：手改坏 / 类型不对的配置不至于把工具带崩 */
function resolveConfig(stored: Partial<StoredConfig>): AppConfig {
  return {
    chromePath: typeof stored.chromePath === 'string' ? stored.chromePath : DEFAULTS.chromePath,
    defaultProfile: typeof stored.defaultProfile === 'string' ? stored.defaultProfile : DEFAULTS.defaultProfile,
    dataDirectory: getDataDirectory(),
    autoRestoreOnStartup: stored.autoRestoreOnStartup === true,
    preserveDataOnClose: stored.preserveDataOnClose !== false,
  }
}

export const configStore = {
  getAll(): AppConfig {
    return resolveConfig(readStoredConfig())
  },

  get<T = unknown>(key: string): T {
    return this.getAll()[key as keyof AppConfig] as T
  },

  update(data: AppConfigUpdate): AppConfig {
    // 数据目录变更只走平台级 IPC（会通知所有工具域重载），工具配置里不保留第二份
    const { dataDirectory: _ignored, ...patch } = data
    writeStoredConfig({ ...readStoredConfig(), ...patch })
    return this.getAll()
  },
}
