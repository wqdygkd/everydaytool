import type { WxpEnhancement } from '../../../../shared/types.ts'
import { createHash } from 'node:crypto'
import { buildInjectionScript } from './injection-script.ts'

interface WxpRuntimeRule {
  id: string
  name: string
  type: WxpEnhancement['type']
  urlPattern: string
  code: string
}

export interface EnhancementSourceOptions {
  /** 在页面左下角显示「增强中」呼吸灯角标（默认开启） */
  showStatusBadge?: boolean
  /**
   * 缓存登录状态（默认开启）：应用把登录会话存 sessionStorage（重启即失），这里把
   * 整个 sessionStorage 快照到 localStorage，并在每次文档启动最早时刻整体还原（先于
   * 路由守卫）。以 wxp_access_token 存在且未过期（JWT exp，非 JWT 不校验）为前提，
   * 登出后失效；还原后若仍停在登录/根页面，宽限 0.8s 供应用自行恢复（静默重连 /
   * 会话重建可能自己跳转），仍未进入才刷新进 #/home。随后补跑登录引导：真实登录
   * 时应用在登录响应里拉取黑名单/租户列表、启动代理 NameNode、建立 iframe SSO，
   * 缓存启动会跳过这段（链接中心数据与代理链路依赖它），脚本在应用挂载后按登录
   * 顺序补跑；NameNode 地址等仅存于内存的登录响应参数由 3s 镜像顺手备份到
   * localStorage（LOGIN_PARAMS_KEY），用户名从应用凭据缓存（login-info-cache）解出。
   */
  cacheLogin?: boolean
  /**
   * 一次性清除登录缓存（工具在 WXP 未运行时登记的标记）：脚本在文档最早时刻先于
   * 还原移除快照 / 镜像与会话内用户缓存。仅用于启动后的首轮注入，随后必须换回
   * 常规脚本重注入，否则用户重新登录写入的快照会被后续新文档再次清掉。
   */
  clearLoginCacheOnce?: boolean
}

// —— 键名单一来源：注入脚本、清除脚本、采集脚本共用这些键，改动只动这里 ——
const TOKEN_KEY = 'wxp_access_token'
/** 应用存于 sessionStorage 的用户信息键 */
const USER_CACHE_KEY = 'user-info-cache'
/** 登录会话整体快照（localStorage） */
const SNAPSHOT_KEY = '__wxpEnhancerSessionSnapshot'
/** 旧版单键用户信息镜像（localStorage，兼容读取） */
const LEGACY_SNAPSHOT_KEY = '__wxpEnhancerUserCache'
/** 登录响应参数镜像（localStorage）：NameNode 地址 / 租户状态源，仅存于应用内存 */
const LOGIN_PARAMS_KEY = '__wxpEnhancerLoginParams'
/** 应用凭据缓存（localStorage，XOR("WXpLocalCache2024Secret")+base64 的 {username,password}） */
const LOGIN_INFO_KEY = 'login-info-cache'
/** 链接收藏（localStorage）：链接中心转发的内容键列表（环境|名称|接入点|原地址） */
const LINK_FAVORITES_KEY = '__wxpEnhancerLinkFavorites'

const BADGE_STYLE = [
  '#wxp-enhancer-badge{position:fixed;left:12px;bottom:12px;z-index:2147483647;',
  'display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;',
  'background:rgba(17,24,21,.72);color:#fff;',
  'font:12px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:.02em;',
  'pointer-events:none;user-select:none;-webkit-user-select:none;backdrop-filter:blur(4px)}',
  '#wxp-enhancer-badge::before{content:"";width:7px;height:7px;border-radius:50%;background:#07c160;',
  'animation:wxpEnhancerBreathe 2.2s ease-in-out infinite}',
  '@keyframes wxpEnhancerBreathe{0%,100%{opacity:1;box-shadow:0 0 6px 1px rgba(7,193,96,.55)}',
  '50%{opacity:.35;box-shadow:0 0 1px 0 rgba(7,193,96,.15)}}',
].join('')

const HOME_HASH = '#/home'
/** 自动进入主页前的宽限时长：给应用自身从登录页恢复（静默重连等）留出机会 */
const ENTRY_DELAY_MS = 800

/**
 * 把增强规则（CSS / JS）合并成一段自举脚本。脚本本体在 injection-script.ts（String.raw
 * 承载，正则可自然书写），本文件只负责运行时参数收集与键名单一来源；行为说明
 * （登录态缓存 / 引导补跑 / 链接收藏 / 角标）见 injection-script.ts 各节注释。
 */
export function buildEnhancementSource(enhancements: WxpEnhancement[], options: EnhancementSourceOptions = {}): string {
  const rules: WxpRuntimeRule[] = enhancements
    .filter(item => item.enabled && item.code.trim())
    .map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      urlPattern: (item.urlPattern ?? '').trim(),
      code: item.code,
    }))

  return buildInjectionScript({
    cacheLogin: options.cacheLogin !== false,
    clearPending: options.clearLoginCacheOnce === true,
    showBadge: options.showStatusBadge !== false,
    entryDelayMs: ENTRY_DELAY_MS,
    homeHash: HOME_HASH,
    signature: createHash('sha1').update(JSON.stringify(rules)).digest('hex').slice(0, 12),
    rulesJson: JSON.stringify(rules),
    badgeStyle: BADGE_STYLE,
    clearSnippet: buildClearLoginCacheSnippet(),
    keys: {
      token: TOKEN_KEY,
      userCache: USER_CACHE_KEY,
      snapshot: SNAPSHOT_KEY,
      legacySnapshot: LEGACY_SNAPSHOT_KEY,
      loginParams: LOGIN_PARAMS_KEY,
      loginInfo: LOGIN_INFO_KEY,
      favorites: LINK_FAVORITES_KEY,
    },
  })
}

/** 清除登录缓存的页面端脚本：移除工具写入的快照 / 镜像 / 登录参数与会话内用户缓存（不动应用自身的 token） */
export function buildClearLoginCacheSnippet(): string {
  return `;(function () {
  try {
    localStorage.removeItem(${JSON.stringify(SNAPSHOT_KEY)});
    localStorage.removeItem(${JSON.stringify(LEGACY_SNAPSHOT_KEY)});
    localStorage.removeItem(${JSON.stringify(LOGIN_PARAMS_KEY)});
    sessionStorage.removeItem(${JSON.stringify(USER_CACHE_KEY)});
  } catch (e) {}
})();`
}
