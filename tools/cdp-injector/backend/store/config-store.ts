import type { CdpDefaults, CdpProfile, CdpScript } from '../../../../shared/types.js'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJson } from '../../../chrome-sandbox/backend/utils/file-ops.js'
import { getDataDirectory } from '../../../chrome-sandbox/backend/utils/path-helper.js'

interface CdpConfig {
  profiles: CdpProfile[]
  scripts: CdpScript[]
  defaults: CdpDefaults
}

const DEFAULT_CONFIG: CdpConfig = {
  profiles: [],
  scripts: [],
  defaults: {
    startupDelayMs: 2000,
    pollIntervalMs: 2000,
    cdpTimeoutMs: 30000,
  },
}

function getConfigPath(): string {
  return path.join(getDataDirectory(), 'cdp-injector', 'config.json')
}

async function readConfig(): Promise<CdpConfig> {
  const configPath = getConfigPath()
  await ensureDir(path.dirname(configPath))
  if (!(await pathExists(configPath))) {
    await writeJson(configPath, DEFAULT_CONFIG)
    return structuredClone(DEFAULT_CONFIG)
  }
  const data = await readJson<Partial<CdpConfig>>(configPath)
  return {
    ...DEFAULT_CONFIG,
    ...data,
    profiles: data.profiles ?? [],
    scripts: data.scripts ?? [],
    defaults: { ...DEFAULT_CONFIG.defaults, ...data.defaults },
  }
}

async function writeConfig(config: CdpConfig): Promise<CdpConfig> {
  const configPath = getConfigPath()
  await writeJson(configPath, config)
  return config
}

export const cdpConfigStore = {
  async getAll(): Promise<CdpConfig> {
    return readConfig()
  },

  async getProfiles(): Promise<CdpProfile[]> {
    const config = await readConfig()
    return config.profiles
  },

  async getScripts(): Promise<CdpScript[]> {
    const config = await readConfig()
    return config.scripts
  },

  async saveProfile(profile: CdpProfile): Promise<CdpProfile | undefined> {
    const config = await readConfig()
    const payload: CdpProfile = { ...profile }
    if (!payload.id) {
      payload.id = randomUUID()
      config.profiles.push(payload)
    } else {
      const index = config.profiles.findIndex(p => p.id === payload.id)
      if (index === -1) {
        config.profiles.push(payload)
      } else {
        config.profiles[index] = { ...config.profiles[index], ...payload }
      }
    }
    await writeConfig(config)
    return payload.id ? config.profiles.find(p => p.id === payload.id) : config.profiles.at(-1)
  },

  async deleteProfile(id: string): Promise<CdpProfile[]> {
    const config = await readConfig()
    config.profiles = config.profiles.filter(p => p.id !== id)
    await writeConfig(config)
    return config.profiles
  },

  async saveScript(script: CdpScript): Promise<CdpScript | undefined> {
    const config = await readConfig()
    const payload: CdpScript = { ...script }
    if (!payload.id) {
      payload.id = randomUUID()
      config.scripts.push(payload)
    } else {
      const index = config.scripts.findIndex(s => s.id === payload.id)
      if (index === -1) {
        config.scripts.push(payload)
      } else {
        config.scripts[index] = { ...config.scripts[index], ...payload }
      }
    }
    await writeConfig(config)
    return payload.id ? config.scripts.find(s => s.id === payload.id) : config.scripts.at(-1)
  },

  async deleteScript(id: string): Promise<CdpScript[]> {
    const config = await readConfig()
    config.scripts = config.scripts.filter(s => s.id !== id)
    await writeConfig(config)
    return config.scripts
  },

  async getScriptById(id: string): Promise<CdpScript | null> {
    const config = await readConfig()
    return config.scripts.find(s => s.id === id) ?? null
  },

  async getProfileById(id: string): Promise<CdpProfile | null> {
    const config = await readConfig()
    return config.profiles.find(p => p.id === id) ?? null
  },

  async getDefaults(): Promise<CdpDefaults> {
    const config = await readConfig()
    return config.defaults
  },
}
