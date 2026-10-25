// 指纹存储（data/chrome-sandbox/fingerprints.json）：结构即 shared/sandbox.ts 的 Fingerprint。
// 指纹只由本工具写入，整份文档按数组读写，进程内由 json-store 缓存。
import type { Fingerprint, FingerprintCreatePayload, FingerprintUpdatePayload } from '../../../../shared/sandbox.ts'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { getChromeSandboxDataDirectory } from '../utils/path-helper.ts'

function getFingerprintsPath(): string {
  return path.join(getChromeSandboxDataDirectory(), 'fingerprints.json')
}

function readFingerprints(): Fingerprint[] {
  const data = readJsonDocument<unknown>(getFingerprintsPath(), () => [])
  if (!Array.isArray(data)) {
    logger.warn('Fingerprint store file has unexpected shape, ignoring', { file: 'fingerprints.json' })
    return []
  }
  return data as Fingerprint[]
}

function writeFingerprints(fingerprints: Fingerprint[]): void {
  writeJsonDocument(getFingerprintsPath(), fingerprints)
}

/** 部分更新：各分组内部也做合并，允许只提交某个分组的部分字段 */
function mergeFingerprint(existing: Fingerprint, patch: FingerprintUpdatePayload): Fingerprint {
  return {
    ...existing,
    ...patch,
    id: existing.id,
    navigator: { ...existing.navigator, ...patch.navigator },
    canvas: { ...existing.canvas, ...patch.canvas },
    webgl: { ...existing.webgl, ...patch.webgl },
    screen: { ...existing.screen, ...patch.screen },
    audio: { ...existing.audio, ...patch.audio },
    timezone: { ...existing.timezone, ...patch.timezone },
    createdAt: patch.createdAt ?? existing.createdAt ?? null,
    updatedAt: new Date().toISOString(),
  }
}

export const fingerprintStore = {
  getById(id: string): Fingerprint | null {
    return readFingerprints().find(fingerprint => fingerprint.id === id) ?? null
  },

  create(data: FingerprintCreatePayload): Fingerprint | null {
    const fingerprint: Fingerprint = {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }
    writeFingerprints([...readFingerprints(), fingerprint])
    return fingerprint
  },

  /**
   * 部分更新：只覆盖传入的字段。
   * 早期实现会把 Partial 强转成完整对象写满所有列，缺失字段会覆盖成 undefined —— 这里保持只合并传入值。
   */
  update(id: string, data: FingerprintUpdatePayload): Fingerprint | null {
    const fingerprints = readFingerprints()
    const index = fingerprints.findIndex(fingerprint => fingerprint.id === id)
    if (index === -1) return null

    const updated = mergeFingerprint(fingerprints[index], data)
    const next = [...fingerprints]
    next[index] = updated
    writeFingerprints(next)
    return updated
  },

  delete(id: string | null | undefined): void {
    if (!id) return
    const fingerprints = readFingerprints()
    const next = fingerprints.filter(fingerprint => fingerprint.id !== id)
    if (next.length !== fingerprints.length) writeFingerprints(next)
  },
}
