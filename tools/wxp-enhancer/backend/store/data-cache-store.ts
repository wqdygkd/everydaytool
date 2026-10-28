import type { WxpDataCache } from '../../../../shared/wxp.ts'
import path from 'node:path'
import { resolveLayerPath, resolveLayerPathWithFallback } from '../../../../backend/utils/data-layers.ts'
import { ensureDir, pathExists, readJson, writeJson } from '../../../../backend/utils/file-ops.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { isSealedSecret, openSecret, sealSecret } from '../../../../backend/utils/secret-box.ts'

/** 落盘信封：整份缓存（token / 用户对象 / 收藏）作为一个密文块存 */
interface SealedCacheFile {
  schemaVersion: 2
  sealed: string
}

function getCachePath(): string {
  return resolveLayerPath('config', 'wxp-enhancer', 'data-cache.json')
}

/** 读取：v2 优先，回查 v1 的 <data>/wxp-enhancer/data-cache.json */
function getCacheReadPath(): string {
  return resolveLayerPathWithFallback('config', 'wxp-enhancer/data-cache.json')
}

/**
 * 从 WXP 页面采集回来的登录信息 / 收藏数据在工具侧的落盘缓存。
 *
 * **落盘加密**：这份文件在配置层（会进备份包），内含 accessToken / refreshToken 与用户对象，
 * 因此整份 JSON 用 safeStorage 封成密文（`{ schemaVersion: 2, sealed }`）。
 * 旧版本写的明文 JSON 仍能读（没有 sealed 字段就当明文），下一次 set() 自动升级成密文。
 */
export const dataCacheStore = {
  async get(): Promise<WxpDataCache | null> {
    const cachePath = getCacheReadPath()
    if (!(await pathExists(cachePath))) return null
    const raw = await readJson<WxpDataCache | SealedCacheFile | null>(cachePath)
    if (!raw) return null
    if (typeof (raw as SealedCacheFile).sealed === 'string' && isSealedSecret((raw as SealedCacheFile).sealed)) {
      const plain = openSecret((raw as SealedCacheFile).sealed, 'wxp:data-cache')
      if (!plain) return null
      try {
        return JSON.parse(plain) as WxpDataCache
      } catch (error) {
        logger.warn('WXP data cache is corrupted after decrypt', { error: (error as Error).message })
        return null
      }
    }
    return raw as WxpDataCache
  },

  async set(cache: WxpDataCache): Promise<void> {
    await ensureDir(path.dirname(getCachePath()))
    const sealed = sealSecret(JSON.stringify(cache), 'wxp:data-cache')
    // safeStorage 不可用时 sealSecret 返回明文：此时退回旧格式，功能不受影响
    const payload: WxpDataCache | SealedCacheFile = isSealedSecret(sealed)
      ? { schemaVersion: 2, sealed }
      : cache
    await writeJson(getCachePath(), payload)
  },
}
