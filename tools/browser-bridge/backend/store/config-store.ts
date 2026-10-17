// browser-bridge 配置存储（data/browser-bridge/config.json）：配对 token + 处理名单。
// 与规则/脚本分文件，便于用户手动查看与迁移。
import type { BridgeConfigData } from '../types.ts'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJson } from '../../../../backend/utils/file-ops.ts'
import { getBridgeDataDirectory } from '../utils/paths.ts'

const EMPTY_CONFIG: BridgeConfigData = { token: '', targets: [] }

let cache: BridgeConfigData | null = null

function getConfigPath(): string {
  return path.join(getBridgeDataDirectory(), 'config.json')
}

function createToken(): string {
  return randomBytes(16).toString('hex')
}

/** 读取配置；首次访问生成配对 token 并落盘 */
export async function loadConfig(): Promise<BridgeConfigData> {
  if (cache) return cache

  const raw = await readJsonFile<Partial<BridgeConfigData>>(getConfigPath(), {})
  const config: BridgeConfigData = {
    token: typeof raw.token === 'string' && raw.token ? raw.token : createToken(),
    targets: Array.isArray(raw.targets) ? raw.targets : [],
  }
  cache = config
  if (!raw.token || !Array.isArray(raw.targets)) {
    await writeJson(getConfigPath(), config)
  }
  return config
}

export async function saveConfig(): Promise<void> {
  if (!cache) return
  await writeJson(getConfigPath(), cache)
}

export function getConfigSnapshot(): BridgeConfigData {
  return cache ?? EMPTY_CONFIG
}

export function setTargets(targets: BridgeConfigData['targets']): void {
  if (!cache) return
  cache.targets = targets
}

/** 数据目录切换后丢弃缓存，下次访问按新目录加载 */
export function resetConfigStore(): void {
  cache = null
}
