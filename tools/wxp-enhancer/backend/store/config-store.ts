import type { WxpSettings } from '../../../../shared/wxp.ts'
import path from 'node:path'
import { resolveLayerPath, resolveLayerPathWithFallback } from '../../../../backend/utils/data-layers.ts'
import { ensureDir, pathExists, readJson, writeJson } from '../../../../backend/utils/file-ops.ts'
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

function getConfigPath(): string {
  return resolveLayerPath('config', 'wxp-enhancer', 'config.json')
}

/** 读取：v2 优先，回查 v1 的 <data>/wxp-enhancer/config.json */
function getConfigReadPath(): string {
  return resolveLayerPathWithFallback('config', 'wxp-enhancer/config.json')
}

async function readConfig(): Promise<WxpConfigFile> {
  const configPath = getConfigReadPath()
  await ensureDir(path.dirname(getConfigPath()))
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
}
