import { randomBytes } from 'node:crypto'
import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  forceLocalListen,
  parseListenPort,
  WB2API_DEFAULT_PORT,
} from '../../../../shared/workbuddy2api-panel.ts'
import { readAppSettings, writeAppSettings } from '../store/settings-store.ts'
import { getWb2apiConfigPath, getWb2apiCurrentDir, getWb2apiRunDir } from '../utils/paths.ts'

/** example 里的占位密钥；空字符串在「已有 config」语义下是「不鉴权」，不能当首启自生成 */
const PLACEHOLDER_API_KEYS = new Set(['', 'test_key', 'your-api-key', 'changeme', 'api_key'])

function generateApiKey(): string {
  return randomBytes(24).toString('base64url')
}

/** 占位 / 空密钥 → 随机密钥；已是真实值则不动 */
function ensureRealApiKey(config: Record<string, unknown>): void {
  const current = typeof config.api_key === 'string' ? config.api_key.trim() : ''
  if (!PLACEHOLDER_API_KEYS.has(current)) return
  config.api_key = generateApiKey()
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function findExampleConfig(currentDir: string): Promise<string | null> {
  const candidates = [
    path.join(currentDir, 'config.example.json'),
    path.join(currentDir, 'config.example'),
  ]
  for (const c of candidates) {
    if (await pathExists(c)) return c
  }
  try {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const nested = path.join(currentDir, e.name, 'config.example.json')
      if (await pathExists(nested)) return nested
    }
  } catch {
    // ignore
  }
  return null
}

export async function readConfigJson(): Promise<Record<string, unknown> | null> {
  const configPath = getWb2apiConfigPath()
  if (!(await pathExists(configPath))) return null
  try {
    const raw = await readFile(configPath, 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export function resolveConfiguredPort(config: Record<string, unknown> | null): number {
  const settings = readAppSettings()
  if (config) return parseListenPort(config.listen, settings.port)
  return settings.port || WB2API_DEFAULT_PORT
}

/**
 * START 前强制：listen=127.0.0.1:<port>，update.auto_enabled=false。
 * 端口优先用 settings，否则从现有 config 解析。
 */
export async function enforceStartConfig(preferredPort?: number): Promise<{ port: number, configPath: string }> {
  await mkdir(getWb2apiRunDir(), { recursive: true })
  const configPath = getWb2apiConfigPath()
  let config = await readConfigJson()
  if (!config) {
    await ensureRunConfigInitialized()
    config = await readConfigJson()
  }
  if (!config) throw new Error('缺少 config.json，请先安装')

  const port = preferredPort ?? resolveConfiguredPort(config)
  config.listen = forceLocalListen(port)

  const update = (config.update && typeof config.update === 'object')
    ? { ...(config.update as Record<string, unknown>) }
    : {}
  update.auto_enabled = false
  config.update = update

  // 早期安装可能已写入 example 的 test_key：下次 START 时换成随机密钥
  ensureRealApiKey(config)

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  writeAppSettings({ port })
  return { port, configPath }
}

/** 无 run/config.json 时从 example 初始化，并改 listen / 关自更新 / 随机 api_key */
export async function ensureRunConfigInitialized(): Promise<boolean> {
  const configPath = getWb2apiConfigPath()
  if (await pathExists(configPath)) return false

  await mkdir(path.join(getWb2apiRunDir(), 'auths'), { recursive: true })
  await mkdir(path.join(getWb2apiRunDir(), 'data'), { recursive: true })

  const example = await findExampleConfig(getWb2apiCurrentDir())
  let config: Record<string, unknown>
  if (example) {
    await copyFile(example, configPath)
    const raw = await readFile(configPath, 'utf8')
    config = JSON.parse(raw) as Record<string, unknown>
  } else {
    config = {
      listen: forceLocalListen(WB2API_DEFAULT_PORT),
      api_key: '',
      auth_dir: './auths',
      state_file: './data/state.json',
      update: { auto_enabled: false },
    }
  }

  const port = parseListenPort(config.listen, WB2API_DEFAULT_PORT)
  config.listen = forceLocalListen(port)
  const update = (config.update && typeof config.update === 'object')
    ? { ...(config.update as Record<string, unknown>) }
    : {}
  update.auto_enabled = false
  config.update = update
  // example 是占位 test_key；空 = 不鉴权。首启一律写入随机密钥（对齐上游「无 config 时 crypto/rand」）
  ensureRealApiKey(config)

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  writeAppSettings({ port })
  return true
}
