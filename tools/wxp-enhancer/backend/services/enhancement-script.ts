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
 * 把增强规则（CSS / JS）合并成一段自举脚本：
 * - 登录态缓存：整体快照 sessionStorage ↔ localStorage（token 过期不还原），宽限后自动进 #/home，
 *   并补跑登录后初始化（黑名单 / 租户列表 / 代理 NameNode / iframe SSO，链接中心与代理链路依赖）
 * - 内置「链接收藏」：链接中心每条转发名称旁星标收藏（localStorage，行内容作键），
 *   接口响应数据层标记 isFav 并收藏置顶排序，收藏行高亮；另有「医院域名打开」按钮
 *   （复用应用打开通路，127.0.0.1 → 医院名.localhost，默认浏览器打开）
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
  const clearPending = options.clearLoginCacheOnce === true

  return `;(function () {
  // —— 登录态缓存：token 工具 ——
  var CACHE_LOGIN = ${cacheLogin};
  var TOKEN_KEY = ${JSON.stringify(TOKEN_KEY)};
  var USER_CACHE_KEY = ${JSON.stringify(USER_CACHE_KEY)};
  var SNAPSHOT_KEY = ${JSON.stringify(SNAPSHOT_KEY)};
  var LEGACY_SNAPSHOT_KEY = ${JSON.stringify(LEGACY_SNAPSHOT_KEY)};
  var LOGIN_PARAMS_KEY = ${JSON.stringify(LOGIN_PARAMS_KEY)};
  var LOGIN_INFO_KEY = ${JSON.stringify(LOGIN_INFO_KEY)};
  var FAVS_KEY = ${JSON.stringify(LINK_FAVORITES_KEY)};
  var HOME_HASH = '${HOME_HASH}';
  var ENTRY_DELAY_MS = ${ENTRY_DELAY_MS};
  var CLEAR_PENDING = ${clearPending};
  // —— 待清除登录缓存（WXP 未运行时登记的标记）：先于还原执行，本轮注入完成后换回常规脚本；
  // 清除键列表与 buildClearLoginCacheSnippet 同源，避免两处漂移 ——
  if (CLEAR_PENDING) {
    ${buildClearLoginCacheSnippet()}
  }
  // token 是 JWT 且带 exp 时校验有效期；无 token 视为不可用，非 JWT / 解析失败视为可用（交由应用自行处理）
  var isTokenUsable = function () {
    try {
      var token = localStorage.getItem(TOKEN_KEY);
      if (!token) return false;
      var parts = token.split('.');
      if (parts.length !== 3) return true;
      var base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var payload = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      if (payload && typeof payload.exp === 'number') return payload.exp * 1000 > Date.now();
      return true;
    } catch (e) { return true; }
  };
  // 从应用凭据缓存解出登录用户名（XOR("WXpLocalCache2024Secret")+base64 的 {username,password}），
  // NameNode 注册要求与登录时一致的用户名
  var decodeLoginUsername = function () {
    try {
      var raw = localStorage.getItem(LOGIN_INFO_KEY);
      if (!raw) return '';
      var bin = atob(raw);
      var json = decodeURIComponent(escape(bin));
      var secret = 'WXpLocalCache2024Secret';
      var out = '';
      for (var i = 0; i < json.length; i++) out += String.fromCharCode(json.charCodeAt(i) ^ secret.charCodeAt(i % secret.length));
      var info = JSON.parse(out);
      return (info && info.username) || '';
    } catch (e) { return ''; }
  };
  // 读取 Vue2 根实例（挂载于 #app）与其 Vuex store，供参数镜像 / 引导补跑 / 收藏数据层使用
  var readRootVm = function () {
    try {
      var appEl = document.getElementById('app');
      return (appEl && appEl.__vue__) || null;
    } catch (e) { return null; }
  };
  var readStore = function () {
    try {
      var vm = readRootVm();
      return (vm && vm.$store) || null;
    } catch (e) { return null; }
  };
  // —— 还原（文档启动最早时刻，先于路由守卫）：整体还原上次会话的 sessionStorage ——
  // 链接中心等页面的数据依赖登录后写入 sessionStorage 的会话态，只还原用户信息会进得去主页但拿不到数据
  try {
    if (CACHE_LOGIN && !sessionStorage.getItem(USER_CACHE_KEY) && isTokenUsable()) {
      var snapshot = localStorage.getItem(SNAPSHOT_KEY);
      if (snapshot) {
        var data = JSON.parse(snapshot);
        for (var key in data) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            try { sessionStorage.setItem(key, data[key]); } catch (e) {}
          }
        }
      } else {
        // 旧版单键镜像兼容：无整体快照时至少还原用户信息
        var legacyUser = localStorage.getItem(LEGACY_SNAPSHOT_KEY);
        if (legacyUser) sessionStorage.setItem(USER_CACHE_KEY, legacyUser);
      }
    }
  } catch (e) {}
  // —— 快照：登录态完整时（有 token 且 sessionStorage 有用户信息）把全部 sessionStorage 备份到 localStorage ——
  // 登出守护：wxp_access_token 消失（用户主动登出）时清掉快照，避免过期凭据被再次还原
  if (CACHE_LOGIN && !window.__wxpEnhancerSessionMirror) {
    window.__wxpEnhancerSessionMirror = setInterval(function () {
      try {
        if (!localStorage.getItem(TOKEN_KEY)) {
          if (localStorage.getItem(SNAPSHOT_KEY)) localStorage.removeItem(SNAPSHOT_KEY);
          if (localStorage.getItem(LEGACY_SNAPSHOT_KEY)) localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
          return;
        }
        // —— 登录响应参数镜像：NameNode 地址 / 租户状态源只在应用内存（登录响应带入，
        // 不落存储），缓存启动无法还原导致「代理异常 / 无可用的NameNode服务」，这里顺手备份 ——
        var store = readStore();
        if (store && store.getters) {
          var params = {};
          try { params = JSON.parse(localStorage.getItem(LOGIN_PARAMS_KEY) || '{}'); } catch (e) { params = {}; }
          var paramsChanged = false;
          if (store.getters.systemNameNodeAddrs && params.nameNodeAddrs !== store.getters.systemNameNodeAddrs) {
            params.nameNodeAddrs = store.getters.systemNameNodeAddrs;
            paramsChanged = true;
          }
          if (store.getters.tenantStatusQueryServers && params.statusQueryServers !== store.getters.tenantStatusQueryServers) {
            params.statusQueryServers = store.getters.tenantStatusQueryServers;
            paramsChanged = true;
          }
          if (paramsChanged) localStorage.setItem(LOGIN_PARAMS_KEY, JSON.stringify(params));
        }
        if (!sessionStorage.getItem(USER_CACHE_KEY)) return;
        var snapshot = {};
        for (var i = 0; i < sessionStorage.length; i++) {
          var key = sessionStorage.key(i);
          snapshot[key] = sessionStorage.getItem(key);
        }
        var serialized = JSON.stringify(snapshot);
        try {
          if (localStorage.getItem(SNAPSHOT_KEY) !== serialized) localStorage.setItem(SNAPSHOT_KEY, serialized);
          if (localStorage.getItem(LEGACY_SNAPSHOT_KEY)) localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
        } catch (quotaError) {
          // 超出 localStorage 配额：整体快照不可靠，清掉退化为只镜像用户信息
          if (localStorage.getItem(SNAPSHOT_KEY)) localStorage.removeItem(SNAPSHOT_KEY);
          var userJson = sessionStorage.getItem(USER_CACHE_KEY);
          if (userJson && localStorage.getItem(LEGACY_SNAPSHOT_KEY) !== userJson) {
            localStorage.setItem(LEGACY_SNAPSHOT_KEY, userJson);
          }
        }
      } catch (e) {}
    }, 3000);
  }
  // —— 自动进入主页：已还原用户且停在登录/根页面时，先宽限 ENTRY_DELAY_MS 给应用
  // 自行恢复（静默重连可能自己跳转），仍未进入才设 hash 后整页刷新 ——
  // （整页刷新保证界面全新重建；不能只改 hash 绕过登录，主界面运行态由应用自行恢复）
  var isLoginHref = function () {
    var href = (location.href || '').toLowerCase();
    if (href.indexOf('login') !== -1 || href.indexOf('signin') !== -1 || href.indexOf('auth') !== -1) return true;
    var hash = location.hash || '';
    return hash === '' || hash === '#' || hash === '#/';
  };
  if (CACHE_LOGIN && sessionStorage.getItem(USER_CACHE_KEY) && localStorage.getItem(TOKEN_KEY) && isLoginHref() && !window.__wxpEnhancerEntry) {
    window.__wxpEnhancerEntry = true;
    setTimeout(function () {
      if (isLoginHref() && sessionStorage.getItem(USER_CACHE_KEY)) {
        if (location.hash !== HOME_HASH) location.hash = HOME_HASH;
        location.reload();
      }
    }, ENTRY_DELAY_MS);
  }
  // —— 登录引导补跑：真实登录时应用在登录响应处理里做三件事——拉取黑名单与租户
  // 列表（链接中心的数据源）、启动代理 NameNode（不启动就是「代理异常 / 无可用的
  // NameNode服务」）、建立 iframe SSO；缓存登录启动时这些全部没跑。等 Vue 应用挂载、
  // 路由守卫恢复用户后按登录顺序补跑：参数用镜像（LOGIN_PARAMS_KEY）还原，用户名从
  // 应用凭据缓存解出。幂等：store 里已有对应值则跳过该项 ——
  if (CACHE_LOGIN && sessionStorage.getItem(USER_CACHE_KEY) && !window.__wxpEnhancerBootstrap) {
    var bootstrapTries = 0;
    window.__wxpEnhancerBootstrap = setInterval(function () {
      bootstrapTries++;
      try {
        if (bootstrapTries > 40) return clearInterval(window.__wxpEnhancerBootstrap);
        var store = readStore();
        if (!store || !store.getters || !store.getters.user || !store.getters.baseURL) return;
        clearInterval(window.__wxpEnhancerBootstrap);
        var baseUrl = store.getters.baseURL;
        var params = {};
        try { params = JSON.parse(localStorage.getItem(LOGIN_PARAMS_KEY) || '{}'); } catch (e) { params = {}; }
        // 1) 代理 NameNode：主进程 TCP 注册要求与登录一致的用户名
        if (!store.getters.systemNameNodeAddrs && params.nameNodeAddrs) {
          store.commit('user/SET_SYSTEMNAME_NODE_ADDRS', params.nameNodeAddrs);
          store.dispatch('app/StartNameServer', { username: decodeLoginUsername(), namenode: params.nameNodeAddrs })
            .catch(function (e) {});
        }
        // 2) 租户状态源：还原后才能把租户在线/离线标记刷出来
        var statusRestored = false;
        if (!store.getters.tenantStatusQueryServers && params.statusQueryServers) {
          store.commit('user/SET_TENANTSTATUS_QUERY_SERVERS', params.statusQueryServers);
          statusRestored = true;
        }
        // 3) 黑名单 → 租户列表 → 在线状态（链接中心数据链，按登录时的顺序）
        var tenantsEmpty = !store.getters.tenants || !store.getters.tenants.length;
        if (tenantsEmpty) {
          store.dispatch('blacklist/LoadBlacklists', { baseUrl: baseUrl, userCode: store.getters.user.code })
            .then(function () { return store.dispatch('tenant/GetAllTenants', { baseUrl: baseUrl }); })
            .then(function () {
              var servers = store.getters.tenantStatusQueryServers;
              if (servers) store.dispatch('tenant/UpdateTenantsState', servers).catch(function (e) {});
            })
            .catch(function (e) {});
        } else if (statusRestored) {
          store.dispatch('tenant/UpdateTenantsState', params.statusQueryServers).catch(function (e) {});
        }
        // 4) iframe SSO（研发/交付/运维中心）
        store.dispatch('WxpLogin', { domain: baseUrl }).catch(function (e) {});
      } catch (e) {
        clearInterval(window.__wxpEnhancerBootstrap);
      }
    }, 500);
  }
  // —— 链接收藏（内置增强）：链接中心表格每行「转发名称」旁注入星标与「医院域名
  // 打开」按钮，点击收藏/取消（localStorage，行内容作键）；并在数据层处理接口响应
  // ——getCurrentHospitalLinks 落库后给每条转发标记 isFav 并收藏置顶（稳定排序），
  // 收藏行加高亮 class。名称单元格选择器不能依赖 type class（tenant-link__* 只覆盖
  // 部分行），按列位置取 ——
  var FAV_STYLE_TEXT = '.wxp-fav-star{cursor:pointer;margin-left:6px;font-style:normal;font-size:18px;line-height:1;color:#c0c4cc;vertical-align:middle;-webkit-user-select:none;user-select:none}.wxp-fav-star:hover{color:#f7ba2a}.wxp-fav-star.is-fav{color:#f7ba2a}.wxp-open-btn{cursor:pointer;margin-left:5px;color:#c0c4cc;display:inline-flex;vertical-align:middle;align-items:center}.wxp-open-btn:hover{color:#3390ec}.wxp-open-btn svg{width:17px;height:17px;display:block}.w-table__row.wxp-fav-row td{background:#fdf6ec!important}';
  var favStyleEl = document.getElementById('wxp-enhancer-fav-style');
  if (!favStyleEl) {
    favStyleEl = document.createElement('style');
    favStyleEl.id = 'wxp-enhancer-fav-style';
    (document.head || document.documentElement).appendChild(favStyleEl);
  }
  if (favStyleEl.textContent !== FAV_STYLE_TEXT) favStyleEl.textContent = FAV_STYLE_TEXT;
  var getFavs = function () {
    try { return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]'); } catch (e) { return []; }
  };
  var setFavs = function (arr) {
    try { localStorage.setItem(FAVS_KEY, JSON.stringify(arr)); } catch (e) {}
  };
  // 清理旧版 id 键（history: code:id 格式会与行错位，已废弃），只保留内容键
  try {
    var legacyFavs = getFavs();
    var cleanedFavs = legacyFavs.filter(function (k) { return typeof k === 'string' && k.indexOf('|') !== -1; });
    if (cleanedFavs.length !== legacyFavs.length) setFavs(cleanedFavs);
  } catch (e) {}
  // 行内容键：环境 | 转发名（剥离星标字符）| 接入点 | 原地址；接入点天然区分租户
  var nameCellOf = function (row) {
    try {
      // 不能依赖 type class（tenant-link__* 只覆盖部分行），按列位置取转发名称单元格
      return row.querySelector('td[class*="column_4"]') || row.children[3] || null;
    } catch (e) { return null; }
  };
  var favKeyOfRow = function (row) {
    try {
      var tds = row.children;
      var nameTd = nameCellOf(row);
      var name = nameTd ? nameTd.innerText.replace(/[☆★]/g, '').trim() : '';
      if (!name) return null;
      return (tds[1] ? tds[1].innerText.trim() : '') + '|' + name + '|' +
        (tds[4] ? tds[4].innerText.trim() : '') + '|' + (tds[5] ? tds[5].innerText.trim() : '');
    } catch (e) { return null; }
  };
  // 数据层键：与 favKeyOfRow 同构（接口字段 ↔ 行文本一一对应），两层算出的键一致
  var favKeyOfLink = function (link) {
    if (!link) return null;
    var name = String(link.simpleName || '').trim();
    if (!name) return null;
    return String(link.sceneformal || '').trim() + '|' + name + '|' +
      String(link.accessPoint || '').trim() + '|' + String(link.targetPoint || '').trim();
  };
  var findLinkCenterVm = function (vm) {
    if (!vm) return null;
    if (vm.$options && vm.$options.name === 'LinkCenter') return vm;
    var children = vm.$children || [];
    for (var i = 0; i < children.length; i++) {
      var found = findLinkCenterVm(children[i]);
      if (found) return found;
    }
    return null;
  };
  // 数据层：接口响应落库后标记 isFav 并收藏置顶（稳定排序）；表格数据
  // hospitalLinks$0 是保序过滤 computed，源数组顺序即展示顺序
  var applyMarkSort = function (lc) {
    try {
      var favs = getFavs();
      var links = lc.hospitalLinks;
      if (!links || !links.length) return;
      var fav = function (link) { return favs.indexOf(favKeyOfLink(link)) !== -1 ? 1 : 0 };
      links.forEach(function (link) { link.isFav = fav(link) === 1 });
      links.sort(function (a, b) { return fav(b) - fav(a) });
    } catch (e) {}
  };
  // 扫描链接中心表格：每行名称旁补星标（缺失才挂），按当前收藏表刷新状态。
  // 只在值变化时写 DOM，避免触发观察者死循环。
  var refreshStars = function () {
    try {
      var container = document.querySelector('.link-view-container');
      if (!container) return;
      var favs = getFavs();
      var rows = container.querySelectorAll('.w-table__body tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var nameTd = nameCellOf(row);
        if (!nameTd) continue;
        var cellDiv = nameTd.querySelector('.cell') || nameTd;
        var mount = cellDiv.querySelector('div') || cellDiv;
        var key = favKeyOfRow(row);
        var star = mount.querySelector('.wxp-fav-star');
        if (!star) {
          if (!key) continue;
          star = document.createElement('i');
          star.className = 'wxp-fav-star';
          mount.appendChild(star);
        }
        var isFav = key && favs.indexOf(key) !== -1;
        var wantCls = 'wxp-fav-star' + (isFav ? ' is-fav' : '');
        if (star.className !== wantCls) star.className = wantCls;
        var wantText = isFav ? '★' : '☆';
        if (star.textContent !== wantText) star.textContent = wantText;
        var wantTitle = isFav ? '取消收藏' : '收藏';
        if (star.title !== wantTitle) star.title = wantTitle;
        // 星标之后补「医院域名打开」按钮
        var openBtn = mount.querySelector('.wxp-open-btn');
        if (!openBtn) {
          openBtn = document.createElement('i');
          openBtn.className = 'wxp-open-btn';
          openBtn.innerHTML = OPEN_BTN_SVG;
          openBtn.title = '默认浏览器打开（医院域名）';
          mount.appendChild(openBtn);
        }
      }
    } catch (e) {}
  };
  var OPEN_BTN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
  // 医院域名：医院名称做主机名（中文由浏览器 punycode），剔除主机名非法字符，空则回退 code
  var hospitalHostOf = function (lc) {
    var h = lc.hospital || {};
    // 注意：模板字符串里 \s/\w 会被转义吞掉，正则的反斜杠必须写成 \\
    var host = String(h.name || '').trim().replace(/\\s+/g, '-').replace(/[^\\w.\\-\\u4E00-\\u9FA5]/g, '');
    if (!host) host = String(h.code || '').trim();
    return host ? host.toLowerCase() + '.localhost' : '';
  };
  // 行 → 链接对象：内容键两层同构，按键匹配（不依赖行下标）
  var linkOfRow = function (lc, row) {
    var key = favKeyOfRow(row);
    if (!key) return null;
    var links = lc.hospitalLinks || [];
    for (var i = 0; i < links.length; i++) {
      if (favKeyOfLink(links[i]) === key) return links[i];
    }
    return null;
  };
  // 「医院域名打开」：复用应用通路——openChannel 保障本地代理通道（接入点非本地时应用
  // 自行提示并中止），取 link.url 把 127.0.0.1 换成 医院名.localhost，走 AppShellOpen
  // （主进程 shell.openExternal，即应用「默认浏览器打开」的同一通路）
  var openHospitalLink = function (lc, link) {
    try {
      if (!link || !lc.openChannel(link)) return;
      var host = hospitalHostOf(lc);
      setTimeout(function () {
        try {
          var url = String(link.url || '').replace('127.0.0.1', host || '127.0.0.1');
          if (url) lc.AppShellOpen({ path: url, isFolder: false });
        } catch (e) {}
      }, 100);
    } catch (e) {}
  };
  // 点击分发：星标=切换收藏（数据层重标记/置顶）；医院域名按钮=通道保障后默认浏览器打开
  // （捕获阶段拦截，不触发行内事件）
  if (!window.__wxpEnhancerFavClick) {
    window.__wxpEnhancerFavClick = true;
    document.addEventListener('click', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('.wxp-fav-star, .wxp-open-btn') : null;
      if (!el) return;
      ev.preventDefault();
      ev.stopPropagation();
      var row = el.closest('tr');
      if (!row) return;
      var lc = findLinkCenterVm(readRootVm());
      if (!lc) return;
      if (el.classList.contains('wxp-fav-star')) {
        var key = favKeyOfRow(row);
        if (!key) return;
        var favs = getFavs();
        var idx = favs.indexOf(key);
        if (idx === -1) favs.unshift(key); else favs.splice(idx, 1);
        setFavs(favs);
        applyMarkSort(lc);
      } else {
        var link = linkOfRow(lc, row);
        if (link) openHospitalLink(lc, link);
      }
      refreshStars();
    }, true);
  }
  // 数据层接线：包装接口响应入口（getCurrentHospitalLinks），每次拉取后标记+置顶；
  // row-class 给收藏行加高亮（isFav 随每次排序触发的重渲染而刷新到行 class 上）
  if (!window.__wxpEnhancerFavDataScan) {
    var favDataTries = 0;
    window.__wxpEnhancerFavDataScan = setInterval(function () {
      favDataTries++;
      try {
        var lc = findLinkCenterVm(readRootVm());
        if (lc && !lc.__wxpEnhancerFavDataPatched && typeof lc.getCurrentHospitalLinks === 'function') {
          lc.__wxpEnhancerFavDataPatched = true;
          var origLoad = lc.getCurrentHospitalLinks;
          lc.getCurrentHospitalLinks = function () {
            var self = this;
            var result = origLoad.apply(this, arguments);
            try {
              // 跟随接口完成再标记+置顶；再留一拍余量等 Vue 渲染出去
              Promise.resolve(result).then(function () {
                [0, 300].forEach(function (delay) {
                  setTimeout(function () { applyMarkSort(self); refreshStars(); }, delay);
                });
              }).catch(function (e) {});
            } catch (e) {}
            return result;
          };
          if (typeof lc.tableRowClassName === 'function') {
            var origRowClass = lc.tableRowClassName;
            lc.tableRowClassName = function (params) {
              var base = '';
              try { base = origRowClass.call(this, params) || ''; } catch (e) {}
              try { if (params && params.row && params.row.isFav) return base + ' wxp-fav-row'; } catch (e) {}
              return base;
            };
          }
          applyMarkSort(lc);
          refreshStars();
          clearInterval(window.__wxpEnhancerFavDataScan);
        }
        if (favDataTries > 600) clearInterval(window.__wxpEnhancerFavDataScan);
      } catch (e) {
        clearInterval(window.__wxpEnhancerFavDataScan);
      }
    }, 3000);
  }
  // 表格重渲染（切医院/筛选/翻页）后补挂/刷新星标；body 在文档启动早段可能还不存在
  var startFavObserver = function () {
    if (window.__wxpEnhancerFavObserver || !document.body) return;
    window.__wxpEnhancerFavObserver = new MutationObserver(function () {
      if (window.__wxpEnhancerFavScanTimer) return;
      window.__wxpEnhancerFavScanTimer = setTimeout(function () {
        window.__wxpEnhancerFavScanTimer = null;
        refreshStars();
      }, 150);
    });
    window.__wxpEnhancerFavObserver.observe(document.body, { childList: true, subtree: true });
    refreshStars();
  };
  if (document.body) startFavObserver();
  else document.addEventListener('DOMContentLoaded', startFavObserver, { once: true });
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
