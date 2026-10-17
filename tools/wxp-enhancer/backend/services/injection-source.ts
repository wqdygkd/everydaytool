import type { WxpLinkFavorite } from '../../../../shared/types.ts'
import { buildInjectionScript } from './injection-script.ts'

export interface InjectionSourceOptions {
  /** 在顶栏页签之后、用户名之前显示「增强中」呼吸灯（默认开启） */
  showStatusBadge?: boolean
  /**
   * 缓存登录状态（默认开启）：应用把登录会话存 sessionStorage（重启即失），这里把
   * 整个 sessionStorage 快照到 localStorage，并在每次文档启动最早时刻整体还原（先于
   * 路由守卫）。登录信号以 sessionStorage 的用户信息键为准（路由守卫恢复 Vuex 用户
   * 的同一来源，与编码方式无关）；应用登出不清会话时快照保持，工具侧「清除登录缓存」
   * 才移除。还原后若仍停在登录/根页面，宽限 0.8s 供应用自行恢复（静默重连 /
   * 会话重建可能自己跳转），仍未进入才刷新进 #/home。随后补跑登录引导：真实登录
   * 时应用在登录响应里拉取黑名单/租户列表、启动代理 NameNode、建立 iframe SSO，
   * 缓存启动会跳过这段（链接中心数据与代理链路依赖它），脚本在应用挂载后按登录
   * 顺序补跑；NameNode 地址等仅存于内存的登录响应参数由 3s 镜像顺手备份到
   * localStorage（LOGIN_PARAMS_KEY），用户名从 Vuex 用户对象读取。
   */
  cacheLogin?: boolean
  /**
   * 一次性清除登录缓存（工具在 WXP 未运行时登记的标记）：脚本在文档最早时刻先于
   * 还原移除快照 / 镜像与会话内用户缓存。仅用于启动后的首轮注入，随后必须换回
   * 常规脚本重注入，否则用户重新登录写入的快照会被后续新文档再次清掉。
   */
  clearLoginCacheOnce?: boolean
  /**
   * 链接收藏的工具侧备份（来自 data-cache.json）：启动注入时把其中页面还没有的
   * 收藏补进 WXP localStorage。缓存为空不覆盖页面；页面多出来的收藏保留。
   */
  favoritesBackup?: { favs: WxpLinkFavorite[], updatedAt: number }
}

// —— 键名单一来源：注入脚本、清除脚本、采集脚本共用这些键，改动只动这里 ——
/** 应用存于 sessionStorage 的用户信息键（路由守卫恢复 Vuex 用户的同一来源） */
const USER_CACHE_KEY = 'user-info-cache'
/** 登录会话整体快照（localStorage，{v,at,data} 信封，兼容旧版裸 map） */
const SNAPSHOT_KEY = '__wxpEnhancerSessionSnapshot'
/** 旧版单键用户信息镜像（localStorage，兼容读取） */
const LEGACY_SNAPSHOT_KEY = '__wxpEnhancerUserCache'
/** 登录响应参数镜像（localStorage）：NameNode 地址 / 租户状态源，仅存于应用内存 */
const LOGIN_PARAMS_KEY = '__wxpEnhancerLoginParams'
/** 链接收藏（localStorage）：对象数组，字段 sceneformal / simpleName / accessPoint / targetPoint / hospital */
const LINK_FAVORITES_KEY = '__wxpEnhancerLinkFavorites'
/** 链接收藏变更时间戳（localStorage）：每次星标切换更新，与工具侧备份比新旧 */
const LINK_FAVORITES_TS_KEY = '__wxpEnhancerLinkFavoritesTs'

const BADGE_STYLE = [
  '#wxp-enhancer-badge{display:inline-flex;align-items:center;align-self:center;gap:6px;',
  'flex:none;height:24px;margin:0 8px;padding:0 10px;border-radius:999px;',
  'background:rgba(255,255,255,.18);color:#fff;',
  'font:12px/1 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:.02em;',
  'pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag}',
  '#wxp-enhancer-badge::before{content:"";width:7px;height:7px;border-radius:50%;background:#07c160;',
  'animation:wxpEnhancerBreathe 2.2s ease-in-out infinite}',
  '@keyframes wxpEnhancerBreathe{0%,100%{opacity:1;box-shadow:0 0 6px 1px rgba(7,193,96,.55)}',
  '50%{opacity:.35;box-shadow:0 0 1px 0 rgba(7,193,96,.15)}}',
].join('')

const HOME_HASH = '#/home'
/** 自动进入主页前的宽限时长：给应用自身从登录页恢复（静默重连等）留出机会 */
const ENTRY_DELAY_MS = 800
/** 会话快照的最长有效期：超出视为服务端会话已失效，不再还原（14 天） */
const SNAPSHOT_TTL_MS = 14 * 24 * 60 * 60 * 1000
/**
 * 注入脚本版本：写入 window.__wxpEnv.rev，供 CDP 存活探针判断页面里的脚本是否
 * 存活/过期（无 rev 的旧脚本一律视为过期）。改动注入行为时 bump 此值。
 */
export const WXP_INJECTION_REV = 15

/**
 * 装配注入脚本：脚本本体在 injection-script.ts（真实函数序列化），本文件只负责
 * 运行时参数收集与键名单一来源；行为说明（登录态缓存 / 引导补跑 / 链接收藏 / 角标）
 * 见 injection-main.ts 各节注释。
 */
export function buildInjectionSource(options: InjectionSourceOptions = {}): string {
  return buildInjectionScript({
    cacheLogin: options.cacheLogin !== false,
    clearPending: options.clearLoginCacheOnce === true,
    showBadge: options.showStatusBadge !== false,
    entryDelayMs: ENTRY_DELAY_MS,
    homeHash: HOME_HASH,
    snapshotTtlMs: SNAPSHOT_TTL_MS,
    rev: WXP_INJECTION_REV,
    favoritesBackup: options.favoritesBackup ?? { favs: [], updatedAt: 0 },
    badgeStyle: BADGE_STYLE,
    clearSnippet: buildClearLoginCacheSnippet(),
    keys: {
      userCache: USER_CACHE_KEY,
      snapshot: SNAPSHOT_KEY,
      legacySnapshot: LEGACY_SNAPSHOT_KEY,
      loginParams: LOGIN_PARAMS_KEY,
      favorites: LINK_FAVORITES_KEY,
      favoritesTs: LINK_FAVORITES_TS_KEY,
    },
  })
}

/** 清除登录缓存的页面端脚本：移除工具写入的快照 / 镜像 / 登录参数与会话内用户缓存（不动应用自身的凭据缓存） */
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
