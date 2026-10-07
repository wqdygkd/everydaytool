import type { WxpDataCache } from '../../../../shared/types.ts'
import { evaluateOnMainPage } from '../services/cdp-client.ts'
import { dataCacheStore } from '../store/data-cache-store.ts'

/**
 * 采集脚本（在 WXP 主页面执行）：读取 localStorage 的令牌 / 参数镜像 / 收藏，
 * Vuex 里已解码的用户对象，以及应用凭据缓存（XOR+base64 的 {username,password}）。
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
  out.user = null
  try {
    var vm = (document.getElementById('app') || {}).__vue__
    out.user = (vm && vm.$store && vm.$store.getters.user) || null
  } catch (e) {}
  out.username = ''
  out.password = ''
  try {
    var raw = ls('login-info-cache')
    if (raw) {
      var bin = atob(raw)
      var json = decodeURIComponent(escape(bin))
      var secret = 'WXpLocalCache2024Secret'
      var s = ''
      for (var i = 0; i < json.length; i++) s += String.fromCharCode(json.charCodeAt(i) ^ secret.charCodeAt(i % secret.length))
      var info = JSON.parse(s)
      out.username = (info && info.username) || ''
      out.password = (info && info.password) || ''
    }
  } catch (e) {}
  return out
})()`
}

/** 从运行中的 WXP 采集登录信息与收藏数据，缓存到工具数据目录并返回 */
export async function collectWxpData(port: number): Promise<WxpDataCache> {
  const raw = (await evaluateOnMainPage(port, buildCollectExpression())) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') {
    throw new Error('采集脚本未返回数据，请确认 WXP 已完全启动')
  }
  const params = (raw.loginParams ?? {}) as Record<string, unknown>
  const cache: WxpDataCache = {
    collectedAt: Date.now(),
    login: {
      accessToken: String(raw.accessToken ?? ''),
      refreshToken: String(raw.refreshToken ?? ''),
      accessExpiresAt: Number(raw.accessExpiresAt ?? 0),
      refreshExpiresAt: Number(raw.refreshExpiresAt ?? 0),
      username: String(raw.username ?? ''),
      password: String(raw.password ?? ''),
      user: (raw.user as Record<string, unknown> | null) ?? null,
      nameNodeAddrs: String(params.nameNodeAddrs ?? ''),
      statusQueryServers: String(params.statusQueryServers ?? ''),
      snapshotExists: raw.snapshotExists === true,
    },
    favorites: Array.isArray(raw.favorites) ? raw.favorites.map(String) : [],
  }
  await dataCacheStore.set(cache)
  return cache
}
