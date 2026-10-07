import type { WxpEnhancement, WxpSettings } from '../../../../shared/types.js'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getDataDirectory } from '../../../../backend/utils/data-root.js'
import { ensureDir, pathExists, readJson, writeJson } from '../../../../backend/utils/file-ops.js'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/types.js'

interface WxpConfigFile {
  settings: WxpSettings
  enhancements: WxpEnhancement[]
  /** 待清除登录缓存：WXP 未运行时登记，下次启动注入时在文档最早时刻自动清除 */
  clearLoginCachePending?: boolean
}

const DEFAULT_CONFIG: WxpConfigFile = {
  settings: { ...DEFAULT_WXP_SETTINGS },
  enhancements: [],
  clearLoginCachePending: false,
}

function getConfigPath(): string {
  return path.join(getDataDirectory(), 'wxp-enhancer', 'config.json')
}

async function readConfig(): Promise<WxpConfigFile> {
  const configPath = getConfigPath()
  await ensureDir(path.dirname(configPath))
  if (!(await pathExists(configPath))) {
    await writeJson(configPath, DEFAULT_CONFIG)
    return structuredClone(DEFAULT_CONFIG)
  }
  const data = await readJson<Partial<WxpConfigFile>>(configPath)
  const raw = { ...DEFAULT_WXP_SETTINGS, ...data.settings }
  return {
    // 只保留已知字段：旧版 cdp-injector 遗留的 autoLogin / homeUrl 等就地滤除，不再回写
    settings: {
      executablePath: String(raw.executablePath ?? ''),
      debugPort: Number.isFinite(Number(raw.debugPort)) ? Number(raw.debugPort) : DEFAULT_WXP_SETTINGS.debugPort,
      cacheLogin: raw.cacheLogin !== false,
      showStatusBadge: raw.showStatusBadge !== false,
      extraArgs: String(raw.extraArgs ?? ''),
    },
    enhancements: data.enhancements ?? [],
    clearLoginCachePending: data.clearLoginCachePending === true,
  }
}

async function writeConfig(config: WxpConfigFile): Promise<void> {
  await writeJson(getConfigPath(), config)
}

export const wxpConfigStore = {
  async getAll(): Promise<WxpConfigFile> {
    return readConfig()
  },

  async getSettings(): Promise<WxpSettings> {
    return (await readConfig()).settings
  },

  async getLoginCacheClearPending(): Promise<boolean> {
    return (await readConfig()).clearLoginCachePending === true
  },

  async setLoginCacheClearPending(pending: boolean): Promise<void> {
    const config = await readConfig()
    config.clearLoginCachePending = pending
    await writeConfig(config)
  },

  async saveSettings(patch: Partial<WxpSettings>): Promise<WxpSettings> {
    const config = await readConfig()
    config.settings = { ...config.settings, ...patch }
    await writeConfig(config)
    return config.settings
  },

  async getEnhancements(): Promise<WxpEnhancement[]> {
    return (await readConfig()).enhancements
  },

  async saveEnhancement(enhancement: WxpEnhancement): Promise<WxpEnhancement> {
    const config = await readConfig()
    const payload: WxpEnhancement = { ...enhancement }
    if (!payload.id) {
      payload.id = randomUUID()
      config.enhancements.push(payload)
    } else {
      const index = config.enhancements.findIndex(item => item.id === payload.id)
      if (index === -1) {
        config.enhancements.push(payload)
      } else {
        config.enhancements[index] = { ...config.enhancements[index], ...payload }
      }
    }
    await writeConfig(config)
    return payload
  },

  async deleteEnhancement(id: string): Promise<WxpEnhancement[]> {
    const config = await readConfig()
    config.enhancements = config.enhancements.filter(item => item.id !== id)
    await writeConfig(config)
    return config.enhancements
  },
}
