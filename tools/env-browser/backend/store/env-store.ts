// 环境账号存储（data/env-browser/envs.json）：一个 JSON 数组，结构即 shared/env.ts 的 EnvConfig。
// 整份文档读写 + 进程内缓存，不再需要数据库连接与建表/关闭流程。
import type { EnvConfig, EnvCreatePayload, EnvUpdatePayload } from '../../../../shared/env.ts'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { getEnvBrowserDataDirectory } from './paths.ts'

function getEnvsPath(): string {
  return path.join(getEnvBrowserDataDirectory(), 'envs.json')
}

function readEnvs(): EnvConfig[] {
  const data = readJsonDocument<unknown>(getEnvsPath(), () => [])
  if (!Array.isArray(data)) {
    logger.warn('Env store file has unexpected shape, ignoring', { file: 'envs.json' })
    return []
  }
  return data as EnvConfig[]
}

function writeEnvs(envs: EnvConfig[]): void {
  writeJsonDocument(getEnvsPath(), envs)
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
    writeEnvs(next)
    return updated
  },

  delete(id: string): boolean {
    const envs = readEnvs()
    const next = envs.filter(env => env.id !== id)
    if (next.length === envs.length) return false
    writeEnvs(next)
    return true
  },
}
