import type { WxpLinkFavorite } from '../../../../shared/types.ts'
import { injectionMain } from './injection-main.ts'

/**
 * 注入脚本的运行时参数：injection-main.ts（脚本本体，真实函数）从这里拿运行时值，
 * 键名单一来源在 injection-source.ts。
 */
export interface WxpInjectionEnv {
  cacheLogin: boolean
  clearPending: boolean
  showBadge: boolean
  entryDelayMs: number
  homeHash: string
  /** 会话快照的最长有效期（ms）：超出则视为服务端会话已失效，不再还原 */
  snapshotTtlMs: number
  /** 注入脚本版本（WXP_INJECTION_REV）：CDP 存活探针用，无 rev 的旧脚本视为过期 */
  rev: number
  /** 链接收藏的工具侧备份：启动时把页面还没有的项补进 localStorage */
  favoritesBackup: { favs: WxpLinkFavorite[], updatedAt: number }
  /** 「增强中」角标样式 */
  badgeStyle: string
  /** 清除登录缓存的页面端片段（与 buildClearLoginCacheSnippet 同源） */
  clearSnippet: string
  keys: {
    userCache: string
    snapshot: string
    legacySnapshot: string
    loginParams: string
    favorites: string
    favoritesTs: string
  }
}

/**
 * 装配注入脚本：脚本本体是 injection-main.ts 里的真实函数（可 lint / 可单测），
 * 这里序列化函数源码并先写入运行时参数（页面全局 window.__wxpEnv，函数体内读取）。
 * 约束：injection-main 的函数必须自包含（不引用模块导入），否则序列化产物不完整。
 */
export function buildInjectionScript(env: WxpInjectionEnv): string {
  const envJson = JSON.stringify(env)
  const body = injectionMain.toString()
  return `window.__wxpEnv = ${envJson};\n(${body})();`
}
