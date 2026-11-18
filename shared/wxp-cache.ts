// WXP 采集缓存的落盘信封（data-cache.json）：**收藏明文、登录态密文**。
//
// 为什么拆开：收藏是一份「医院 + 转发链接」清单，用户要看、要备份、要能在换机后恢复，
// 本身不含凭据；而登录态（accessToken / refreshToken / 用户对象 / NameNode 参数）必须加密。
// 早先整份缓存共用一个 safeStorage 信封，结果是系统密钥变化（换机、重装、keychain 重置）
// 后连收藏也一起解不开，链接中心恢复备份直接失效。
//
// 这里只放纯逻辑（序列化 / 解析），safeStorage 由调用方注入：
// - store 传 `sealSecret` / `openSecretDetailed`（Electron）
// - 测试传桩函数（Node 里没有 safeStorage）
import type { WxpDataCache } from './wxp.ts'

/** 当前落盘格式版本：3 = 收藏明文 + 登录态密文（2 = 整份密文，1 = 整份明文） */
export const WXP_DATA_CACHE_SCHEMA_VERSION = 3

/** safeStorage 不可用时写回的明文登录态（collectedAt + login） */
export interface WxpCacheLoginPart {
  collectedAt: number
  login: WxpDataCache['login']
}

/** v3 落盘结构 */
export interface WxpCacheFileV3 {
  schemaVersion: typeof WXP_DATA_CACHE_SCHEMA_VERSION
  /** 收藏清单：明文，可读可编辑 */
  favorites: WxpDataCache['favorites']
  favoritesUpdatedAt: number
  /** 登录态密文（`edt-secret:` 信封）；safeStorage 不可用时退化为下面的明文字段 */
  sealed?: string
  collectedAt?: number
  login?: WxpDataCache['login']
}

/** 解不开 / 缺失登录态时的空壳，收藏照旧返回 */
export const EMPTY_WXP_LOGIN: WxpDataCache['login'] = {
  accessToken: '',
  refreshToken: '',
  accessExpiresAt: 0,
  refreshExpiresAt: 0,
  username: '',
  password: '',
  user: null,
  nameNodeAddrs: '',
  statusQueryServers: '',
  snapshotExists: false,
}

export function emptyWxpDataCache(): WxpDataCache {
  return { collectedAt: 0, login: { ...EMPTY_WXP_LOGIN }, favorites: [], favoritesUpdatedAt: 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asLogin(value: unknown): WxpDataCache['login'] | null {
  if (!isRecord(value)) return null
  return { ...EMPTY_WXP_LOGIN, ...(value as Partial<WxpDataCache['login']>) }
}

/**
 * 组装落盘结构：收藏原样明文写出，登录态交给 `seal` 加密。
 * `seal` 返回非信封值（safeStorage 不可用）时，登录态按明文同层写出，功能不受影响。
 */
export function serializeWxpCacheFile(
  cache: WxpDataCache,
  seal: (plain: string) => string,
): WxpCacheFileV3 {
  const favorites = Array.isArray(cache.favorites) ? cache.favorites : []
  const favoritesUpdatedAt = Number(cache.favoritesUpdatedAt) || 0
  const loginPart: WxpCacheLoginPart = { collectedAt: Number(cache.collectedAt) || 0, login: cache.login }
  const sealed = seal(JSON.stringify(loginPart))
  if (sealed.startsWith('edt-secret:')) {
    return { schemaVersion: WXP_DATA_CACHE_SCHEMA_VERSION, favorites, favoritesUpdatedAt, sealed }
  }
  return { schemaVersion: WXP_DATA_CACHE_SCHEMA_VERSION, favorites, favoritesUpdatedAt, ...loginPart }
}

/**
 * 解析落盘结构。兼容三种历史格式：
 * - v3：收藏明文 + 登录态（密文或明文）；
 * - v2：整份密文（解出来就是完整缓存，下次写入自动迁到 v3）；
 * - v1：整份明文缓存。
 *
 * 登录态解不开时**仍然返回收藏**（凭据留空），避免换机后连链接清单一起丢。
 */
export function parseWxpCacheFile(
  raw: unknown,
  open: (sealed: string) => { value: string, failed: boolean },
): WxpDataCache | null {
  if (!isRecord(raw)) return null

  // v3：收藏在外层明文，登录态在内层
  if (raw.schemaVersion === WXP_DATA_CACHE_SCHEMA_VERSION) {
    const favorites = Array.isArray(raw.favorites) ? raw.favorites as WxpDataCache['favorites'] : []
    const favoritesUpdatedAt = Number(raw.favoritesUpdatedAt) || 0
    if (typeof raw.sealed === 'string' && raw.sealed) {
      const opened = open(raw.sealed)
      if (!opened.failed && opened.value) {
        try {
          const loginPart = JSON.parse(opened.value) as Partial<WxpCacheLoginPart>
          return {
            collectedAt: Number(loginPart.collectedAt) || 0,
            login: asLogin(loginPart.login) ?? { ...EMPTY_WXP_LOGIN },
            favorites,
            favoritesUpdatedAt,
          }
        } catch {
          // 解出来的不是 JSON：按「登录态解不开」处理，收藏照旧保留
        }
      }
      return { collectedAt: 0, login: { ...EMPTY_WXP_LOGIN }, favorites, favoritesUpdatedAt }
    }
    return {
      collectedAt: Number(raw.collectedAt) || 0,
      login: asLogin(raw.login) ?? { ...EMPTY_WXP_LOGIN },
      favorites,
      favoritesUpdatedAt,
    }
  }

  // v2：整份密文
  if (typeof raw.sealed === 'string' && raw.sealed) {
    const opened = open(raw.sealed)
    if (opened.failed || !opened.value) return null
    try {
      const parsed = JSON.parse(opened.value) as unknown
      return isRecord(parsed) ? normalizeLegacyCache(parsed) : null
    } catch {
      return null
    }
  }

  // v1：整份明文
  return normalizeLegacyCache(raw)
}

function normalizeLegacyCache(raw: Record<string, unknown>): WxpDataCache {
  return {
    collectedAt: Number(raw.collectedAt) || 0,
    login: asLogin(raw.login) ?? { ...EMPTY_WXP_LOGIN },
    favorites: Array.isArray(raw.favorites) ? raw.favorites as WxpDataCache['favorites'] : [],
    favoritesUpdatedAt: Number(raw.favoritesUpdatedAt) || 0,
  }
}
