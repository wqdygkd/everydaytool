import { injectionMain } from './injection-main.js'

/**
 * 注入脚本的运行时参数：injection-main.ts（脚本本体，真实函数）从这里拿运行时值，
 * 键名单一来源在 enhancement-script.ts。
 */
export interface WxpInjectionEnv {
  cacheLogin: boolean
  clearPending: boolean
  showBadge: boolean
  entryDelayMs: number
  homeHash: string
  /** 增强规则签名（内容哈希，用于跳过重复执行） */
  signature: string
  /** 增强规则 JSON */
  rulesJson: string
  /** 「增强中」角标样式 */
  badgeStyle: string
  /** 清除登录缓存的页面端片段（与 buildClearLoginCacheSnippet 同源） */
  clearSnippet: string
  keys: {
    token: string
    userCache: string
    snapshot: string
    legacySnapshot: string
    loginParams: string
    loginInfo: string
    favorites: string
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
