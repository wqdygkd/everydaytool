// 注入脚本本体：一个自包含函数，构建时经 Function.prototype.toString() 序列化，
// 由 injection-script.ts 包一层运行时参数（window.__wxpEnv）后注入 WXP 页面。
// 约束：
// - 函数必须自包含：只使用参数、window/document 等浏览器全局，不引用任何模块导入
// - 函数体保持 ES5 风格（var / function），避免构建降级引入外部 helper 破坏自包含性
// - 运行环境是 WXP 页面（浏览器全局），而非 Node——本文件不做类型检查（@ts-nocheck），
//   ESLint 现代风格规则也已按文件豁免；行为验证靠等价性测试（见项目记忆）
/* eslint-disable
  no-var,
  vars-on-top,
  prefer-arrow-callback,
  prefer-template,
  prefer-rest-params,
  no-new-func,
  object-shorthand,
  style/semi,
  style/max-statements-per-line,
  style/operator-linebreak,
  unicorn/prefer-includes,
  unicorn/prefer-dom-node-text-content,
  e18e/prefer-includes,
  e18e/prefer-object-has-own,
  ts/no-this-alias,
  unused-imports/no-unused-vars
*/
// 运行环境是 WXP 浏览器页面；Node 侧无 DOM 类型，仅做最小环境声明
declare const window: any
declare const document: any
declare const localStorage: any
declare const sessionStorage: any
declare const location: any
declare const MutationObserver: any
export function injectionMain(): void {
  var env = window.__wxpEnv
  var CACHE_LOGIN = env.cacheLogin
  var TOKEN_KEY = env.keys.token
  var USER_CACHE_KEY = env.keys.userCache
  var SNAPSHOT_KEY = env.keys.snapshot
  var LEGACY_SNAPSHOT_KEY = env.keys.legacySnapshot
  var LOGIN_PARAMS_KEY = env.keys.loginParams
  var LOGIN_INFO_KEY = env.keys.loginInfo
  var FAVS_KEY = env.keys.favorites
  var HOME_HASH = env.homeHash
  var ENTRY_DELAY_MS = env.entryDelayMs
  var CLEAR_PENDING = env.clearPending
  var SHOW_BADGE = env.showBadge
  var BADGE_STYLE = env.badgeStyle
  var SIGNATURE = env.signature
  var RULES = JSON.parse(env.rulesJson)
  // —— 待清除登录缓存（WXP 未运行时登记的标记）：先于还原执行，本轮注入完成后换回常规脚本；
  // 清除键列表与 buildClearLoginCacheSnippet 同源（键值都来自 env.keys 单一来源）——
  if (CLEAR_PENDING) {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
      localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
      localStorage.removeItem(LOGIN_PARAMS_KEY);
      sessionStorage.removeItem(USER_CACHE_KEY);
    } catch (e) {}
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
          var params: any = {};
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
        var snapshot: any = {};
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
        var params: any = {};
        try { params = JSON.parse(localStorage.getItem(LOGIN_PARAMS_KEY) || '{}'); } catch (e) { params = {}; }
        // 1) 代理 NameNode：主进程 TCP 注册要求与登录一致的用户名
        if (!store.getters.systemNameNodeAddrs && params.nameNodeAddrs) {
          store.commit('user/SET_SYSTEMNAME_NODE_ADDRS', params.nameNodeAddrs);
          store.dispatch('app/StartNameServer', { username: decodeLoginUsername(), namenode: params.nameNodeAddrs })
            .catch(function () {});
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
              if (servers) store.dispatch('tenant/UpdateTenantsState', servers).catch(function () {});
            })
            .catch(function () {});
        } else if (statusRestored) {
          store.dispatch('tenant/UpdateTenantsState', params.statusQueryServers).catch(function () {});
        }
        // 4) iframe SSO（研发/交付/运维中心）
        store.dispatch('WxpLogin', { domain: baseUrl }).catch(function () {});
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
  var setFavs = function (arr: any) {
    try { localStorage.setItem(FAVS_KEY, JSON.stringify(arr)); } catch (e) {}
  };
  // 清理旧版 id 键（history: code:id 格式会与行错位，已废弃），只保留内容键
  try {
    var legacyFavs = getFavs();
    var cleanedFavs = legacyFavs.filter(function (k: any) { return typeof k === 'string' && k.indexOf('|') !== -1; });
    if (cleanedFavs.length !== legacyFavs.length) setFavs(cleanedFavs);
  } catch (e) {}
  // 行内容键：环境 | 转发名（剥离星标字符）| 接入点 | 原地址；接入点天然区分租户
  var nameCellOf = function (row: any) {
    try {
      // 不能依赖 type class（tenant-link__* 只覆盖部分行），按列位置取转发名称单元格
      return row.querySelector('td[class*="column_4"]') || row.children[3] || null;
    } catch (e) { return null; }
  };
  var favKeyOfRow = function (row: any) {
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
  var favKeyOfLink = function (link: any): any {
    if (!link) return null;
    var name = String(link.simpleName || '').trim();
    if (!name) return null;
    return String(link.sceneformal || '').trim() + '|' + name + '|' +
      String(link.accessPoint || '').trim() + '|' + String(link.targetPoint || '').trim();
  };
  var findLinkCenterVm = function (vm: any): any {
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
  var applyMarkSort = function (lc: any) {
    try {
      var favs = getFavs();
      var links = lc.hospitalLinks;
      if (!links || !links.length) return;
      var fav = function (link: any) { return favs.indexOf(favKeyOfLink(link)) !== -1 ? 1 : 0 };
      links.forEach(function (link: any) { link.isFav = fav(link) === 1 });
      links.sort(function (a: any, b: any) { return fav(b) - fav(a) });
    } catch (e) {}
  };
  var OPEN_BTN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
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
  // 医院域名：医院名称做主机名（中文由浏览器 punycode），剔除主机名非法字符，空则回退 code
  var hospitalHostOf = function (lc: any) {
    var h = lc.hospital || {};
    var host = String(h.name || '').trim().replace(/\s+/g, '-').replace(/[^\w.\-\u4E00-\u9FA5]/g, '');
    if (!host) host = String(h.code || '').trim();
    return host ? host.toLowerCase() + '.localhost' : '';
  };
  // 行 → 链接对象：内容键两层同构，按键匹配（不依赖行下标）
  var linkOfRow = function (lc: any, row: any) {
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
  var openHospitalLink = function (lc: any, link: any) {
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
    document.addEventListener('click', function (ev: any) {
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
              }).catch(function () {});
            } catch {}
            return result;
          };
          if (typeof lc.tableRowClassName === 'function') {
            var origRowClass = lc.tableRowClassName;
            lc.tableRowClassName = function (params: any) {
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
  if (!SHOW_BADGE) {
    var staleBadge = document.getElementById('wxp-enhancer-badge');
    staleBadge && staleBadge.parentNode && staleBadge.parentNode.removeChild(staleBadge);
    var staleBadgeStyle = document.getElementById('wxp-enhancer-badge-style');
    staleBadgeStyle && staleBadgeStyle.parentNode && staleBadgeStyle.parentNode.removeChild(staleBadgeStyle);
  } else {
    if (!document.getElementById('wxp-enhancer-badge-style')) {
      var badgeStyle = document.createElement('style');
      badgeStyle.id = 'wxp-enhancer-badge-style';
      badgeStyle.textContent = BADGE_STYLE;
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
  if (window.__wxpEnhancer === SIGNATURE) return;
  window.__wxpEnhancer = SIGNATURE;
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
}
