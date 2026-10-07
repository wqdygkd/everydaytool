import type { WxpDataCache } from '../../../../shared/types.ts'
import path from 'node:path'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'
import { ensureDir, pathExists, readJson, writeJson } from '../../../../backend/utils/file-ops.ts'

function getCachePath(): string {
  return path.join(getDataDirectory(), 'wxp-enhancer', 'data-cache.json')
}

/** 从 WXP 页面采集回来的登录信息 / 收藏数据在工具侧的落盘缓存 */
export const dataCacheStore = {
  async get(): Promise<WxpDataCache | null> {
    if (!(await pathExists(getCachePath()))) return null
    return readJson<WxpDataCache>(getCachePath())
  },

  async set(cache: WxpDataCache): Promise<void> {
    await ensureDir(path.dirname(getCachePath()))
    await writeJson(getCachePath(), cache)
  },
}
