import type { WxpDataCache, WxpLinkFavorite } from '../../../../shared/types.ts'
import { normalizeWxpLinkFavorites, sameWxpLinkFavorite } from '../../../../shared/wxp-favorite.ts'
import { evaluateOnMainPage } from '../services/cdp-client.ts'
import { dataCacheStore } from '../store/data-cache-store.ts'

/**
 * 采集脚本（在 WXP 主页面执行）：读取登录令牌残留 / 参数镜像 / 收藏，
 * 以及 Vuex 里已解码的用户对象。
 * 应用凭据缓存（login-info-cache）现为 RSA 加密，工具不解密；
 * 登录账号从 Vuex 用户对象读取，密码不再采集。
 * 注意：本表达式会以字符串形式注入页面，内部禁止使用反斜杠转义。
 */
export function buildCollectExpression(): string {
  return `(function () {
  var out = {}
  var ls = function (k) { try { return localStorage.getItem(k) || '' } catch (e) { return '' } }
  out.accessToken = ls('wxp_access_token')
  out.refreshToken = ls('wxp_refresh_token')
  out.accessExpiresAt = Number(ls('wxp_access_expires_at')) || 0
  out.refreshExpiresAt = Number(ls('wxp_refresh_expires_at')) || 0
  out.snapshotExists = !!ls('__wxpEnhancerSessionSnapshot')
  try { out.loginParams = JSON.parse(ls('__wxpEnhancerLoginParams') || '{}') } catch (e) { out.loginParams = {} }
  try { out.favorites = JSON.parse(ls('__wxpEnhancerLinkFavorites') || '[]') } catch (e) { out.favorites = [] }
  out.favUpdatedAt = Number(ls('__wxpEnhancerLinkFavoritesTs')) || 0
  out.user = null
  try {
    var vm = (document.getElementById('app') || {}).__vue__
    out.user = (vm && vm.$store && vm.$store.getters.user) || null
  } catch (e) {}
  out.username = ''
  try {
    var u = out.user || {}
    out.username = u.code || u.userCode || u.username || u.name || ''
  } catch (e) {}
  return out
})()`
}

/**
 * 登录态轻量探针（在 WXP 主页面执行）：只返回登录信号与收藏变更时间，供自动采集
 * 判断是否已登录、收藏是否改过。注意：内部禁止使用反斜杠转义。
 */
export function buildLoginStateExpression(): string {
  return `(function () {
  var out = { userCode: '', favUpdatedAt: 0 }
  try {
    var vm = (document.getElementById('app') || {}).__vue__
    var user = vm && vm.$store && vm.$store.getters && vm.$store.getters.user
    if (user) out.userCode = user.code || user.userCode || ''
  } catch (e) {}
  try { out.favUpdatedAt = Number(localStorage.getItem('__wxpEnhancerLinkFavoritesTs')) || 0 } catch (e) {}
  return out
})()`
}

function keepKnownHospitals(page: WxpLinkFavorite[], prev: WxpLinkFavorite[]): WxpLinkFavorite[] {
  return page.map((fav) => {
    if (fav.hospital) return fav
    const old = prev.find(item => sameWxpLinkFavorite(item, fav))
    return old?.hospital ? { ...fav, hospital: old.hospital } : fav
  })
}

/** 从运行中的 WXP 采集登录信息与收藏数据，缓存到工具数据目录并返回 */
export async function collectWxpData(port: number): Promise<WxpDataCache> {
  const raw = (await evaluateOnMainPage(port, buildCollectExpression())) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') {
    throw new Error('采集脚本未返回数据，请确认 WXP 已完全启动')
  }
  const params = (raw.loginParams ?? {}) as Record<string, unknown>
  const prev = await dataCacheStore.get().catch(() => null)
  const favorites = keepKnownHospitals(
    normalizeWxpLinkFavorites(raw.favorites),
    normalizeWxpLinkFavorites(prev?.favorites),
  )
  const cache: WxpDataCache = {
    collectedAt: Date.now(),
    login: {
      accessToken: String(raw.accessToken ?? ''),
      refreshToken: String(raw.refreshToken ?? ''),
      accessExpiresAt: Number(raw.accessExpiresAt ?? 0),
      refreshExpiresAt: Number(raw.refreshExpiresAt ?? 0),
      username: String(raw.username ?? ''),
      password: '',
      user: (raw.user as Record<string, unknown> | null) ?? null,
      nameNodeAddrs: String(params.nameNodeAddrs ?? ''),
      statusQueryServers: String(params.statusQueryServers ?? ''),
      snapshotExists: raw.snapshotExists === true,
    },
    favorites,
    favoritesUpdatedAt: Number(raw.favUpdatedAt ?? 0) || 0,
  }
  await dataCacheStore.set(cache)
  return cache
}
