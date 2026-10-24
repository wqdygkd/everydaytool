import type { AppConfig, AppConfigUpdate } from '../../../../shared/sandbox.ts'
import path from 'node:path'
import { getDataDirectory, getDefaultDataDirectory, normalizeDataDirectory } from '../../../../server/utils/data-root.ts'
import { JsonFileStore } from '../../../../server/utils/json-store.ts'

const DEFAULTS: AppConfig = {
  chromePath: '',
  defaultProfile: '',
  dataDirectory: getDefaultDataDirectory(),
  autoRestoreOnStartup: false,
  preserveDataOnClose: true,
}

// 只保存用户改过的键；dataDirectory 始终以 data-root 的实时值为准
const store = new JsonFileStore<Partial<AppConfig>>(
  () => path.join(getDataDirectory(), 'chrome-sandbox', 'config.json'),
  {},
)

/** 数据根目录变更后丢弃内存缓存，下次访问按新目录重读 */
export function resetConfigStore(): void {
  store.reset()
}

function readMerged(): AppConfig {
  return { ...DEFAULTS, ...store.get(), dataDirectory: getDataDirectory() }
}

export const configStore = {
  getAll(): AppConfig {
    return readMerged()
  },

  get<T = unknown>(key: string): T {
    return readMerged()[key as keyof AppConfig] as unknown as T
  },

  update(data: AppConfigUpdate): AppConfig {
    const payload: Partial<AppConfig> = { ...data }
    if ('dataDirectory' in payload) {
      payload.dataDirectory = normalizeDataDirectory(payload.dataDirectory as string) || getDefaultDataDirectory()
    }
    store.update((config) => {
      Object.assign(config, payload)
    })
    return this.getAll()
  },
}
