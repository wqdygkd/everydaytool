import type { EnvConfig, EnvCreatePayload, EnvUpdatePayload } from '../../../../shared/env.ts'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getDataDirectory } from '../../../../server/utils/data-root.ts'
import { JsonCollection } from '../../../../server/utils/json-store.ts'
import { logger } from '../../../../server/utils/logger.ts'

const collection = new JsonCollection<EnvConfig>(
  () => path.join(getDataDirectory(), 'env-browser', 'configs.json'),
)

/** 数据根目录变更后丢弃内存缓存，下次访问按新目录重读 */
export function resetEnvStore(): void {
  collection.reset()
}

export const envStore = {
  getAll(): EnvConfig[] {
    // 新建的排前面，保持与原 ORDER BY created_at DESC 一致
    return [...collection.all()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
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
      autoLogin: payload.autoLogin !== false,
      createdAt: now,
      updatedAt: now,
    }
    collection.insert(env)
    logger.info('Env created', { id: env.id, name: payload.name })
    return env
  },

  update(id: string, payload: EnvUpdatePayload): EnvConfig | null {
    return collection.update(id, (item) => {
      if (payload.name !== undefined) item.name = payload.name
      if (payload.url !== undefined) item.url = payload.url
      if (payload.username !== undefined) item.username = payload.username
      if (payload.password !== undefined) item.password = payload.password
      if (payload.remark !== undefined) item.remark = payload.remark
      if (payload.autoLogin !== undefined) item.autoLogin = payload.autoLogin
      item.updatedAt = new Date().toISOString()
    })
  },

  delete(id: string): boolean {
    return collection.remove(id)
  },
}
