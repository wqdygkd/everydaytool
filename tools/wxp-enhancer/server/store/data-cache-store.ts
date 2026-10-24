import type { WxpDataCache } from '../../../../shared/wxp.ts'
import path from 'node:path'
import { getDataDirectory } from '../../../../server/utils/data-root.ts'
import { JsonFileStore } from '../../../../server/utils/json-store.ts'

const store = new JsonFileStore<WxpDataCache | null>(
  () => path.join(getDataDirectory(), 'wxp-enhancer', 'data-cache.json'),
  null,
)

/** 数据根目录变更后丢弃内存缓存，下次访问按新目录重读 */
export function resetDataCacheStore(): void {
  store.reset()
}

/** 从 WXP 页面采集回来的登录信息 / 收藏数据在工具侧的落盘缓存 */
export const dataCacheStore = {
  async get(): Promise<WxpDataCache | null> {
    return store.get()
  },

  async set(cache: WxpDataCache): Promise<void> {
    store.set(cache)
  },
}
