// 沙箱列表存储（data/chrome-sandbox/sandboxes.json）：一个 JSON 数组，字段即 shared/sandbox.ts
// 的 Sandbox 结构。进程内由 json-store 缓存，写入整体替换文件。
import type { Sandbox, SandboxMetadata, SandboxUpdatePayload } from '../../../../shared/sandbox.ts'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { SANDBOX_COLORS } from '../constants/sandbox.ts'
import { getChromeSandboxDataDirectory } from '../utils/path-helper.ts'

interface SandboxCreateData {
  id: string
  name: string
  category?: string
  color?: string
  userDataPath: string
  fingerprintId: string | null
  metadata?: SandboxMetadata | null
}

function getSandboxesPath(): string {
  return path.join(getChromeSandboxDataDirectory(), 'sandboxes.json')
}

/** 结构不符（手改坏 / 旧版本残留）时按空列表处理并告警，不让单个坏文件卡死整个工具 */
function readSandboxes(): Sandbox[] {
  const data = readJsonDocument<unknown>(getSandboxesPath(), () => [])
  if (!Array.isArray(data)) {
    logger.warn('Sandbox store file has unexpected shape, ignoring', { file: 'sandboxes.json' })
    return []
  }
  return data as Sandbox[]
}

function writeSandboxes(sandboxes: Sandbox[]): void {
  writeJsonDocument(getSandboxesPath(), sandboxes)
}

export const sandboxStore = {
  getAll(): Sandbox[] {
    return readSandboxes().map(sandbox => ({ ...sandbox }))
  },

  getById(id: string): Sandbox | null {
    const sandbox = readSandboxes().find(item => item.id === id)
    return sandbox ? { ...sandbox } : null
  },

  create(data: SandboxCreateData): Sandbox | null {
    const sandbox: Sandbox = {
      id: data.id,
      name: data.name,
      category: data.category || 'other',
      color: data.color || SANDBOX_COLORS.sandbox,
      userDataPath: data.userDataPath,
      chromePid: null,
      status: 'stopped',
      fingerprintId: data.fingerprintId,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      lastActiveAt: null,
      metadata: data.metadata ?? null,
    }
    writeSandboxes([...readSandboxes(), sandbox])
    return { ...sandbox }
  },

  /** 部分更新：只覆盖显式传入的字段（undefined 视为未提供，null 是有效值） */
  update(id: string, data: SandboxUpdatePayload): Sandbox | null {
    const sandboxes = readSandboxes()
    const index = sandboxes.findIndex(sandbox => sandbox.id === id)
    if (index === -1) return null

    const updated: Sandbox = {
      ...sandboxes[index],
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.chromePid !== undefined ? { chromePid: data.chromePid } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.fingerprintId !== undefined ? { fingerprintId: data.fingerprintId } : {}),
      ...(data.lastUsedAt !== undefined ? { lastUsedAt: data.lastUsedAt } : {}),
      ...(data.lastActiveAt !== undefined ? { lastActiveAt: data.lastActiveAt } : {}),
      ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
    }

    const next = [...sandboxes]
    next[index] = updated
    writeSandboxes(next)
    return { ...updated }
  },

  delete(id: string): void {
    const sandboxes = readSandboxes()
    const next = sandboxes.filter(sandbox => sandbox.id !== id)
    if (next.length !== sandboxes.length) writeSandboxes(next)
  },
}
