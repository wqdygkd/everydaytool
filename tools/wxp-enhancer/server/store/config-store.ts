import type { WxpSettings } from '../../../../shared/wxp.ts'
import path from 'node:path'
import { getDataDirectory } from '../../../../server/utils/data-root.ts'
import { JsonFileStore } from '../../../../server/utils/json-store.ts'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/wxp.ts'

interface WxpConfigFile {
  settings: WxpSettings
  /** 待清除登录缓存：WXP 未运行时登记，下次启动注入时在文档最早时刻自动清除 */
  clearLoginCachePending?: boolean
}

const DEFAULT_CONFIG: WxpConfigFile = {
  settings: { ...DEFAULT_WXP_SETTINGS },
  clearLoginCachePending: false,
}

/** 读取后归一化：只保留已知字段，旧版 cdp-injector 遗留的 autoLogin / homeUrl 等就地滤除 */
function parseConfig(raw: unknown): WxpConfigFile {
  const data = (raw ?? {}) as Partial<WxpConfigFile>
  const merged = { ...DEFAULT_WXP_SETTINGS, ...data.settings }
  return {
    settings: {
      executablePath: String(merged.executablePath ?? ''),
      debugPort: Number.isFinite(Number(merged.debugPort)) ? Number(merged.debugPort) : DEFAULT_WXP_SETTINGS.debugPort,
      cacheLogin: merged.cacheLogin !== false,
      showStatusBadge: merged.showStatusBadge !== false,
      extraArgs: String(merged.extraArgs ?? ''),
    },
    clearLoginCachePending: data.clearLoginCachePending === true,
  }
}

const store = new JsonFileStore<WxpConfigFile>(
  () => path.join(getDataDirectory(), 'wxp-enhancer', 'config.json'),
  structuredClone(DEFAULT_CONFIG),
  parseConfig,
)

/** 数据根目录变更后丢弃内存缓存，下次访问按新目录重读 */
export function resetWxpConfigStore(): void {
  store.reset()
}

export const wxpConfigStore = {
  async getAll(): Promise<WxpConfigFile> {
    return store.get()
  },

  async getSettings(): Promise<WxpSettings> {
    return store.get().settings
  },

  async getLoginCacheClearPending(): Promise<boolean> {
    return store.get().clearLoginCachePending === true
  },

  async setLoginCacheClearPending(pending: boolean): Promise<void> {
    store.update((config) => {
      config.clearLoginCachePending = pending
    })
  },

  async saveSettings(patch: Partial<WxpSettings>): Promise<WxpSettings> {
    store.update((config) => {
      Object.assign(config.settings, patch)
    })
    return store.get().settings
  },
}
