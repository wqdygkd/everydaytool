import type { Sandbox, SandboxMetadata, SandboxUpdatePayload } from '../../../../shared/sandbox.ts'
import path from 'node:path'
import { getDataDirectory } from '../../../../server/utils/data-root.ts'
import { JsonCollection } from '../../../../server/utils/json-store.ts'
import { SANDBOX_COLORS } from '../constants/sandbox.ts'

const collection = new JsonCollection<Sandbox>(
  () => path.join(getDataDirectory(), 'chrome-sandbox', 'sandboxes.json'),
)

/** 数据根目录变更后丢弃内存缓存，下次访问按新目录重读 */
export function resetSandboxStore(): void {
  collection.reset()
}

interface SandboxCreateData {
  id: string
  name: string
  category?: string
  color?: string
  userDataPath: string
  fingerprintId: string | null
  metadata?: SandboxMetadata | null
}

export const sandboxStore = {
  getAll(): Sandbox[] {
    return collection.all()
  },

  getById(id: string): Sandbox | null {
    return collection.find(id)
  },

  create(data: SandboxCreateData): Sandbox {
    return collection.insert({
      id: data.id,
      name: data.name,
      category: data.category ?? 'other',
      color: data.color ?? SANDBOX_COLORS.sandbox,
      userDataPath: data.userDataPath,
      chromePid: null,
      status: 'stopped',
      fingerprintId: data.fingerprintId,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      lastActiveAt: null,
      metadata: data.metadata ?? null,
    })
  },

  update(id: string, data: SandboxUpdatePayload): Sandbox | null {
    return collection.update(id, (item) => {
      if (data.name !== undefined) item.name = data.name
      if (data.category !== undefined) item.category = data.category
      if (data.color !== undefined) item.color = data.color
      if (data.chromePid !== undefined) item.chromePid = data.chromePid
      if (data.status !== undefined) item.status = data.status
      if (data.fingerprintId !== undefined) item.fingerprintId = data.fingerprintId
      if (data.lastUsedAt !== undefined) item.lastUsedAt = data.lastUsedAt
      if (data.lastActiveAt !== undefined) item.lastActiveAt = data.lastActiveAt
      if (data.metadata !== undefined) item.metadata = data.metadata
    })
  },

  delete(id: string): void {
    collection.remove(id)
  },
}
