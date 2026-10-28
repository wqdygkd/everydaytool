// 环境账号存储（配置层 env-browser/envs.json）：一个 JSON 数组，结构即 shared/env.ts 的 EnvConfig。
// 整份文档读写 + 进程内缓存，不再需要数据库连接与建表/关闭流程。
//
// **密码落盘必须加密**：这份文件属于配置层，会进备份包，明文密码等于把账号密码写进备份。
// 落盘用 `secret-box.ts` 的 safeStorage 信封；读盘时自动解开，遇到旧明文（不是信封）就地升级写回。
// 渲染层拿到的仍是明文（账号管理 UI 需要显示 / 复制），加密只解决"磁盘上不留明文"。
import type { EnvConfig, EnvCreatePayload, EnvUpdatePayload } from '../../../../shared/env.ts'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { isSealedSecret, isSecretStorageAvailable, openSecretDetailed, sealSecret } from '../../../../backend/utils/secret-box.ts'
import { getEnvBrowserDataDirectory } from './paths.ts'

function getEnvsPath(): string {
  return path.join(getEnvBrowserDataDirectory(), 'envs.json')
}

/**
 * 解不开的密文（换机器 / 系统密钥变化）按 id 记下来，写盘时原样写回。
 * 少了这一步，一轮「读 → 升级写回」就会把用户的密码变成空串。
 */
const undecryptableSecrets = new Map<string, string>()

function readEnvs(): EnvConfig[] {
  const data = readJsonDocument<unknown>(getEnvsPath(), () => [])
  if (!Array.isArray(data)) {
    logger.warn('Env store file has unexpected shape, ignoring', { file: 'envs.json' })
    return []
  }

  const raw = data as EnvConfig[]
  let needsUpgrade = false
  const envs = raw.map((env) => {
    if (!env.password) {
      undecryptableSecrets.delete(env.id)
      return { ...env, password: '' }
    }
    if (!isSealedSecret(env.password) && isSecretStorageAvailable()) needsUpgrade = true
    const opened = openSecretDetailed(env.password, `env:${env.id}`)
    if (opened.failed) {
      // 解不开就保留密文：写回空串等于静默删掉账号密码
      undecryptableSecrets.set(env.id, env.password)
      return { ...env, password: '' }
    }
    undecryptableSecrets.delete(env.id)
    return { ...env, password: opened.value }
  })

  // 旧明文文件：顺手升级成密文（只做一次；safeStorage 不可用时保持原样，避免无意义重写）
  if (needsUpgrade) {
    try {
      writeEnvs(envs)
      logger.info('Env passwords upgraded to sealed storage', { count: envs.filter(env => env.password).length })
    } catch (error) {
      logger.warn('Failed to upgrade env passwords to sealed storage', { error: (error as Error).message })
    }
  }
  return envs
}

/**
 * 落盘前把密码封成信封（内存里始终是明文，磁盘上永远是密文或旧明文）。
 * 内存里没有明文但磁盘上有解不开的密文时，原样写回密文——**不要用空串覆盖**。
 */
function writeEnvs(envs: EnvConfig[]): void {
  const sealed = envs.map((env) => {
    const kept = undecryptableSecrets.get(env.id)
    if (!env.password && kept) return { ...env, password: kept }
    return { ...env, password: env.password ? sealSecret(env.password, `env:${env.id}`) : '' }
  })
  writeJsonDocument(getEnvsPath(), sealed)
}

export const envStore = {
  getAll(): EnvConfig[] {
    // 与旧 SQL 的 ORDER BY created_at DESC 保持一致：最新创建的在最前
    return [...readEnvs()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  },

  create(payload: EnvCreatePayload): EnvConfig {
    const now = new Date().toISOString()
    const env: EnvConfig = {
      id: `env_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      name: payload.name,
      url: payload.url,
      username: payload.username,
      password: payload.password,
      remark: payload.remark || null,
      autoLogin: payload.autoLogin === false ? 0 : 1,
      createdAt: now,
      updatedAt: now,
    }
    writeEnvs([...readEnvs(), env])
    logger.info('Env created', { id: env.id, name: env.name })
    return env
  },

  update(id: string, payload: EnvUpdatePayload): EnvConfig | null {
    const envs = readEnvs()
    const index = envs.findIndex(env => env.id === id)
    if (index === -1) return null

    const existing = envs[index]
    const updated: EnvConfig = {
      ...existing,
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.url !== undefined ? { url: payload.url } : {}),
      ...(payload.username !== undefined ? { username: payload.username } : {}),
      ...(payload.password !== undefined ? { password: payload.password } : {}),
      ...(payload.remark !== undefined ? { remark: payload.remark } : {}),
      ...(payload.autoLogin !== undefined ? { autoLogin: payload.autoLogin ? 1 : 0 } : {}),
      updatedAt: new Date().toISOString(),
    }

    const next = [...envs]
    next[index] = updated
    // 用户填了新密码（或清空）时，磁盘上那份解不开的旧密文不再需要保留
    if (payload.password !== undefined) undecryptableSecrets.delete(id)
    writeEnvs(next)
    return updated
  },

  delete(id: string): boolean {
    const envs = readEnvs()
    const next = envs.filter(env => env.id !== id)
    undecryptableSecrets.delete(id)
    if (next.length === envs.length) return false
    writeEnvs(next)
    return true
  },
}
