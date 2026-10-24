import type {
  Fingerprint,
  FingerprintCreatePayload,
  FingerprintUpdatePayload,
} from '../../../../shared/sandbox.ts'
import path from 'node:path'
import { getDataDirectory } from '../../../../server/utils/data-root.ts'
import { JsonCollection } from '../../../../server/utils/json-store.ts'

const collection = new JsonCollection<Fingerprint>(
  () => path.join(getDataDirectory(), 'chrome-sandbox', 'fingerprints.json'),
)

/** 数据根目录变更后丢弃内存缓存，下次访问按新目录重读 */
export function resetFingerprintStore(): void {
  collection.reset()
}

/** 分组浅合并：只覆盖 payload 里显式出现的叶子字段，未提供的不动 */
function mergeSections(item: Fingerprint, payload: FingerprintUpdatePayload): void {
  for (const key of ['navigator', 'canvas', 'webgl', 'screen', 'audio', 'timezone'] as const) {
    const patch = payload[key]
    if (patch) Object.assign(item[key], patch)
  }
}

export const fingerprintStore = {
  getById(id: string): Fingerprint | null {
    return collection.find(id)
  },

  create(data: FingerprintCreatePayload): Fingerprint {
    return collection.insert({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    })
  },

  /** 部分更新：按分组浅合并，只改传入的字段，并刷新 updatedAt */
  update(id: string, payload: FingerprintUpdatePayload): Fingerprint | null {
    return collection.update(id, (item) => {
      mergeSections(item, payload)
      item.updatedAt = new Date().toISOString()
    })
  },

  delete(id: string | null | undefined): void {
    if (id) collection.remove(id)
  },
}
