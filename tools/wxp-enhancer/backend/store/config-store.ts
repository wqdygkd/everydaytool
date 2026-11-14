import type { WxpSettings } from '../../../../shared/wxp.ts'
import { existsSync } from 'node:fs'
import { resolveLayerPath, resolveLayerPathWithFallback } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/wxp.ts'

interface WxpConfigFile {
  settings: WxpSettings
  /** 待清除登录缓存：WXP 未运行时登记，下次启动注入时在文档最早时刻自动清除 */
  clearLoginCachePending?: boolean
}

function getConfigPath(): string {
  return resolveLayerPath('config', 'wxp-enhancer', 'config.json')
}

/** 读取：v2 优先，回查 v1 的 <data>/wxp-enhancer/config.json */
function getConfigReadPath(): string {
  return resolveLayerPathWithFallback('config', 'wxp-enhancer/config.json')
}

function readConfig(): WxpConfigFile {
  const configPath = getConfigReadPath()
  const data = readJsonDocument<Partial<WxpConfigFile>>(configPath, () => ({}))
  const raw = { ...DEFAULT_WXP_SETTINGS, ...data.settings }
  const config: WxpConfigFile = {
    // 只保留已知字段：旧版 cdp-injector 遗留的 autoLogin / homeUrl 等就地滤除，不再回写
    settings: {
      executablePath: String(raw.executablePath ?? ''),
      debugPort: Number.isFinite(Number(raw.debugPort)) ? Number(raw.debugPort) : DEFAULT_WXP_SETTINGS.debugPort,
      cacheLogin: raw.cacheLogin !== false,
      showStatusBadge: raw.showStatusBadge !== false,
      extraArgs: String(raw.extraArgs ?? ''),
    },
    clearLoginCachePending: data.clearLoginCachePending === true,
  }
  if (!existsSync(configPath)) writeJsonDocument(getConfigPath(), config)
  return config
}

function writeConfig(config: WxpConfigFile): void {
  writeJsonDocument(getConfigPath(), config)
}

export const wxpConfigStore = {
  async getAll(): Promise<WxpConfigFile> {
    return readConfig()
  },

  async getSettings(): Promise<WxpSettings> {
    return readConfig().settings
  },

  async getLoginCacheClearPending(): Promise<boolean> {
    return readConfig().clearLoginCachePending === true
  },

  async setLoginCacheClearPending(pending: boolean): Promise<void> {
    const config = readConfig()
    config.clearLoginCachePending = pending
    writeConfig(config)
  },

  async saveSettings(patch: Partial<WxpSettings>): Promise<WxpSettings> {
    const config = readConfig()
    config.settings = { ...config.settings, ...patch }
    writeConfig(config)
    return config.settings
  },
}
