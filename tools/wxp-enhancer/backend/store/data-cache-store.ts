import type { WxpDataCache } from '../../../../shared/wxp.ts'
import { resolveLayerPath, resolveLayerPathWithFallback } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { openSecretDetailed, sealSecret } from '../../../../backend/utils/secret-box.ts'
import { parseWxpCacheFile, serializeWxpCacheFile } from '../../../../shared/wxp-cache.ts'

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
 * **落盘分层（v3）**：文件名不变，但内部拆成两段——
 * - `favorites` / `favoritesUpdatedAt`：**明文**。这是一份「医院 + 转发链接」清单，用户要看、
 *   要备份、要能在换机后恢复，本身不含凭据；加密只会让 keychain 一变就整份解不开；
 * - `sealed`：仅登录态（accessToken / refreshToken / 用户对象 / NameNode 参数）用 safeStorage
 *   封成密文。
 *
 * 旧格式仍能读：v2（整份密文）解出来即完整缓存，v1（整份明文）直接当缓存；下一次 `set()`
 * 自动升级成 v3。登录态解不开时仍返回明文收藏（凭据留空），链接清单不会跟着丢。
 */
export const dataCacheStore = {
  async get(): Promise<WxpDataCache | null> {
    const raw = readJsonDocument<unknown>(getCacheReadPath(), () => null)
    if (!raw) return null
    return parseWxpCacheFile(raw, sealed => openSecretDetailed(sealed, 'wxp:data-cache'))
  },

  async set(cache: WxpDataCache): Promise<void> {
    // safeStorage 不可用时 sealSecret 返回明文：serialize 会把登录态按明文同层写出，功能不受影响
    writeJsonDocument(getCachePath(), serializeWxpCacheFile(cache, plain => sealSecret(plain, 'wxp:data-cache')))
  },
}
