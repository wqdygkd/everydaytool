import type { WxpEnhancement, WxpSettings } from '../../../../shared/types.js'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/types.js'
import { ensureDir, pathExists, readJson, writeJson } from '../../../chrome-sandbox/backend/utils/file-ops.js'
import { getDataDirectory } from '../../../chrome-sandbox/backend/utils/path-helper.js'

interface WxpConfigFile {
  settings: WxpSettings
  enhancements: WxpEnhancement[]
}

const DEFAULT_CONFIG: WxpConfigFile = {
  settings: { ...DEFAULT_WXP_SETTINGS },
  enhancements: [],
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
  return {
    settings: { ...DEFAULT_WXP_SETTINGS, ...data.settings },
    enhancements: data.enhancements ?? [],
  }
}

async function writeConfig(config: WxpConfigFile): Promise<WxpConfigFile> {
  await writeJson(getConfigPath(), config)
  return config
}

export const wxpConfigStore = {
  async getAll(): Promise<WxpConfigFile> {
    return readConfig()
  },

  async getSettings(): Promise<WxpSettings> {
    return (await readConfig()).settings
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
