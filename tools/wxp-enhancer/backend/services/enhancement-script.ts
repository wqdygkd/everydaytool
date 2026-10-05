import type { WxpEnhancement } from '../../../../shared/types.js'
import { createHash } from 'node:crypto'

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
   * 缓存登录状态（默认开启）：应用把用户信息存 sessionStorage（重启即失），这里
   * 镜像到 localStorage，并在每次文档启动最早时刻还原（先于路由守卫），有用户时
   * 停在登录/根页面则整页刷新进 #/home。以 wxp_access_token 存在为前提，登出后不生效。
   */
  cacheLogin?: boolean
}

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

/**
 * 把增强规则（CSS / JS）合并成一段自举脚本：
 * - 登录态缓存：应用把用户存 sessionStorage（重启即失），这里镜像到 localStorage 并在
 *   文档启动最早时刻还原（先于路由守卫），随后整页刷新进 #/home（全新文档干净重建界面）
 * - 内置「增强中」呼吸灯角标（幂等创建，先于签名去重，宿主移除后可在下次注入时恢复）
 * - CSS 按规则 id 建 <style>（可原地更新，规则删除时清理残留）；JS 每次执行时以 Function 运行
 * - urlPattern 非空时按 location.href 子串匹配
 * 签名去重：内容未变化时跳过规则执行，避免重复运行 JS。
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

  const rulesJson = JSON.stringify(rules)
  const signature = createHash('sha1').update(rulesJson).digest('hex').slice(0, 12)
  const showBadge = options.showStatusBadge !== false
  const cacheLogin = options.cacheLogin !== false

  return `;(function () {
  // —— 登录态缓存：还原（文档启动最早时刻，先于路由守卫）——
  var CACHE_LOGIN = ${cacheLogin};
  var USER_CACHE_KEY = 'user-info-cache';
  var USER_CACHE_MIRROR = '__wxpEnhancerUserCache';
  var HOME_HASH = '${HOME_HASH}';
  try {
    if (CACHE_LOGIN && !sessionStorage.getItem(USER_CACHE_KEY) && localStorage.getItem('wxp_access_token')) {
      var savedUser = localStorage.getItem(USER_CACHE_MIRROR);
      if (savedUser) sessionStorage.setItem(USER_CACHE_KEY, savedUser);
    }
  } catch (e) {}
  // —— 镜像：登录后把 sessionStorage 用户缓存写回 localStorage（3 秒内完成备份）——
  // 登出守护：wxp_access_token 消失（用户主动登出）时同步清掉镜像，避免过期凭据被再次还原
  if (CACHE_LOGIN && !window.__wxpEnhancerUserMirror) {
    window.__wxpEnhancerUserMirror = setInterval(function () {
      try {
        var currentUser = sessionStorage.getItem(USER_CACHE_KEY);
        var hasToken = !!localStorage.getItem('wxp_access_token');
        if (!hasToken) {
          if (localStorage.getItem(USER_CACHE_MIRROR)) localStorage.removeItem(USER_CACHE_MIRROR);
          return;
        }
        if (currentUser && localStorage.getItem(USER_CACHE_MIRROR) !== currentUser) {
          localStorage.setItem(USER_CACHE_MIRROR, currentUser);
        }
      } catch (e) {}
    }, 3000);
  }
  // —— 自动进入主页：已还原用户且停在登录/根页面时，设 hash 后整页刷新 ——
  // （整页刷新保证界面与窗口拖拽区全新重建；不能只改 hash 绕过登录，主界面运行态由应用自行恢复）
  var isLoginHref = function () {
    var href = (location.href || '').toLowerCase();
    if (href.indexOf('login') !== -1 || href.indexOf('signin') !== -1 || href.indexOf('auth') !== -1) return true;
    var hash = location.hash || '';
    return hash === '' || hash === '#' || hash === '#/';
  };
  if (CACHE_LOGIN && sessionStorage.getItem(USER_CACHE_KEY) && isLoginHref() && !window.__wxpEnhancerEntry) {
    window.__wxpEnhancerEntry = true;
    setTimeout(function () {
      if (isLoginHref() && sessionStorage.getItem(USER_CACHE_KEY)) {
        if (location.hash !== HOME_HASH) location.hash = HOME_HASH;
        location.reload();
      }
    }, 300);
  }
  // —— 「增强中」角标：幂等，先于签名去重执行 ——
  var SHOW_BADGE = ${showBadge};
  if (!SHOW_BADGE) {
    var staleBadge = document.getElementById('wxp-enhancer-badge');
    staleBadge && staleBadge.parentNode && staleBadge.parentNode.removeChild(staleBadge);
    var staleBadgeStyle = document.getElementById('wxp-enhancer-badge-style');
    staleBadgeStyle && staleBadgeStyle.parentNode && staleBadgeStyle.parentNode.removeChild(staleBadgeStyle);
  } else {
    if (!document.getElementById('wxp-enhancer-badge-style')) {
      var badgeStyle = document.createElement('style');
      badgeStyle.id = 'wxp-enhancer-badge-style';
      badgeStyle.textContent = ${JSON.stringify(BADGE_STYLE)};
      (document.head || document.documentElement).appendChild(badgeStyle);
    }
    if (!document.getElementById('wxp-enhancer-badge')) {
      var badge = document.createElement('div');
      badge.id = 'wxp-enhancer-badge';
      badge.textContent = '增强中';
      (document.body || document.documentElement).appendChild(badge);
    }
  }
  // —— 增强规则 ——
  var SIGNATURE = '${signature}';
  if (window.__wxpEnhancer === SIGNATURE) return;
  window.__wxpEnhancer = SIGNATURE;
  var RULES = ${rulesJson};
  var mount = document.head || document.documentElement;
  if (!mount) return;
  var staleStyles = document.querySelectorAll('style[id^="wxp-enhancer-css-"]');
  for (var s = 0; s < staleStyles.length; s++) {
    staleStyles[s].parentNode && staleStyles[s].parentNode.removeChild(staleStyles[s]);
  }
  for (var i = 0; i < RULES.length; i++) {
    var rule = RULES[i];
    try {
      if (rule.urlPattern && location.href.indexOf(rule.urlPattern) === -1) continue;
      if (rule.type === 'css') {
        var style = document.createElement('style');
        style.id = 'wxp-enhancer-css-' + rule.id;
        style.textContent = rule.code;
        mount.appendChild(style);
      } else {
        (new Function(rule.code))();
      }
    } catch (error) {
      console.error('[wxp-enhancer] 规则「' + rule.name + '」执行失败', error);
    }
  }
})();`
}
