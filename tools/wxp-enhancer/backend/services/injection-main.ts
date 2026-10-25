// 注入脚本本体：一个自包含函数，构建时经 Function.prototype.toString() 序列化，
// 由 injection-script.ts 包一层运行时参数（window.__wxpEnv）后注入 WXP 页面。
// 约束：
// - 函数必须自包含：只使用参数、window/document 等浏览器全局，不引用任何模块导入
// - 函数体保持 ES5 风格（var / function），避免构建降级引入外部 helper 破坏自包含性
// - 运行环境是 WXP 页面（浏览器全局），而非 Node——本文件用 declare const 声明页面全局，避开 DOM 类型检查（@ts-nocheck 被 lint 禁用），
//   ESLint 现代风格规则也已按文件豁免；行为验证靠等价性测试（见项目记忆）
/* eslint-disable
  no-var,
  vars-on-top,
  prefer-arrow-callback,
  prefer-template,
  prefer-rest-params,
  object-shorthand,
  style/semi,
  style/max-statements-per-line,
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

  // —— 生命周期：所有 interval / observer / 监听都登记到这里 ——
  // 注入脚本会在每个新文档执行，只靠「找到目标后清理」时未命中分支会留下常驻定时器；
  // 页面卸载（pagehide）统一回收，避免长会话下定时器与观察器持续累积。
  var disposers: any[] = [];
  function addDisposer(fn: any) {
    disposers.push(fn);
  }
  function disposeAll() {
    for (var i = 0; i < disposers.length; i++) {
      try { disposers[i](); } catch (e) {}
    }
    disposers.length = 0;
  }
  if (window.addEventListener) {
    window.addEventListener('pagehide', disposeAll, { once: true });
  }

  var CACHE_LOGIN = env.cacheLogin
  var USER_CACHE_KEY = env.keys.userCache
  var SNAPSHOT_KEY = env.keys.snapshot
  var LEGACY_SNAPSHOT_KEY = env.keys.legacySnapshot
  var LOGIN_PARAMS_KEY = env.keys.loginParams
  var FAVS_KEY = env.keys.favorites
  var FAV_TS_KEY = env.keys.favoritesTs
  var BACKUP_FAVS = (env.favoritesBackup && env.favoritesBackup.favs) || []
  var BACKUP_TS = (env.favoritesBackup && env.favoritesBackup.updatedAt) || 0
  var HOME_HASH = env.homeHash
  var ENTRY_DELAY_MS = env.entryDelayMs
  var SNAPSHOT_TTL_MS = env.snapshotTtlMs
  var CLEAR_PENDING = env.clearPending
  var SHOW_BADGE = env.showBadge
  var BADGE_STYLE = env.badgeStyle
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
  // 登录用户名：从已解码的 Vuex 用户对象读取（与黑名单 userCode 同源）；
  // 应用凭据缓存（login-info-cache）现为 RSA 加密，页面侧不再自行解密
  var readLoginUsername = function (store: any) {
    try {
      var user = (store && store.getters && store.getters.user) || null;
      if (!user) return '';
      return user.code || user.userCode || user.username || user.name || '';
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
  // —— 快照读写（{v,at,data} 信封：v=1，at=写入时间，超期不还原；兼容旧版裸 map） ——
  var readSnapshot = function () {
    try {
      var raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1 && parsed.data) {
        if (typeof parsed.at === 'number' && typeof SNAPSHOT_TTL_MS === 'number' && Date.now() - parsed.at > SNAPSHOT_TTL_MS) return null;
        return parsed.data;
      }
      return parsed;
    } catch (e) { return null; }
  };
  var clearSnapshot = function () {
    try {
      if (localStorage.getItem(SNAPSHOT_KEY)) localStorage.removeItem(SNAPSHOT_KEY);
      if (localStorage.getItem(LEGACY_SNAPSHOT_KEY)) localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
    } catch (e) {}
  };
  // 信封里的 at 每次都变，不能拿整包字符串比对。数据没变时最多一小时碰一次 at，TTL 才不会在长会话里空转过期
  var lastSnapshotPayload = '';
  var lastSnapshotAt = 0;
  var SNAPSHOT_TOUCH_MS = 60 * 60 * 1000;
  var writeSnapshot = function (data: any) {
    var payload = JSON.stringify(data);
    var now = Date.now();
    if (payload === lastSnapshotPayload && now - lastSnapshotAt < SNAPSHOT_TOUCH_MS) return;
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 1, at: now, data: data }));
      lastSnapshotPayload = payload;
      lastSnapshotAt = now;
      if (localStorage.getItem(LEGACY_SNAPSHOT_KEY)) localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
    } catch (quotaError) {
      // 超出 localStorage 配额：整体快照不可靠，清掉退化为只镜像用户信息
      clearSnapshot();
      var userJson = sessionStorage.getItem(USER_CACHE_KEY);
      if (userJson) {
        try {
          if (localStorage.getItem(LEGACY_SNAPSHOT_KEY) !== userJson) localStorage.setItem(LEGACY_SNAPSHOT_KEY, userJson);
        } catch (e) {}
      }
    }
  };
  // —— 还原（文档启动最早时刻，先于路由守卫）：整体还原上次会话的 sessionStorage ——
  // 链接中心等页面的数据依赖登录后写入 sessionStorage 的会话态，只还原用户信息会进得去主页但拿不到数据；
  // 登录信号以路由守卫自己的事实来源（sessionStorage 用户信息键）为准，不依赖应用令牌键
  // （应用已改为 cookie 会话，localStorage 再无令牌键——旧的令牌门控会让还原永远不执行）
  try {
    if (CACHE_LOGIN && !sessionStorage.getItem(USER_CACHE_KEY)) {
      var snapshotData = readSnapshot();
      if (snapshotData) {
        for (var key in snapshotData) {
          if (Object.prototype.hasOwnProperty.call(snapshotData, key)) {
            try { sessionStorage.setItem(key, snapshotData[key]); } catch (e) {}
          }
        }
      } else {
        // 旧版单键镜像兼容：无整体快照时至少还原用户信息
        var legacyUser = localStorage.getItem(LEGACY_SNAPSHOT_KEY);
        if (legacyUser) sessionStorage.setItem(USER_CACHE_KEY, legacyUser);
      }
    }
  } catch (e) {}
  // —— 快照：sessionStorage 有用户信息即视为登录态，把全部 sessionStorage 备份到 localStorage ——
  // 登出守护：同一文档内曾经见过登录态、现在用户信息消失 = 会话被应用清除（用户主动登出），
  // 才清掉快照；文档启动时本来就空 = 重启后的首次加载，此时不动快照、等上面的还原执行——
  // 不能以"令牌键缺失"为登出信号（应用已无 localStorage 令牌键，那样会删掉有效快照）
  var mirrorNow = function () {
    try {
      var currentUser = sessionStorage.getItem(USER_CACHE_KEY);
      if (!currentUser) {
        if (window.__wxpEnhancerSawUser) {
          window.__wxpEnhancerSawUser = false;
          clearSnapshot();
        }
        return;
      }
      window.__wxpEnhancerSawUser = true;
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
      var fresh: any = {};
      for (var i = 0; i < sessionStorage.length; i++) {
        var skey = sessionStorage.key(i);
        fresh[skey] = sessionStorage.getItem(skey);
      }
      writeSnapshot(fresh);
    } catch (e) {}
  };
  if (CACHE_LOGIN && !window.__wxpEnhancerSessionMirror) {
    window.__wxpEnhancerSessionMirror = setInterval(mirrorNow, 3000);
    addDisposer(function () {
      clearInterval(window.__wxpEnhancerSessionMirror);
      window.__wxpEnhancerSessionMirror = null;
    });
    // 退出前刷盘：登录后立刻退出（不足 3s 轮询间隔）时仍能留下快照
    if (window.addEventListener) {
      var onPageHide = function () {
        try { if (CACHE_LOGIN) mirrorNow(); } catch (e) {}
      };
      window.addEventListener('pagehide', onPageHide);
      addDisposer(function () {
        try { window.removeEventListener('pagehide', onPageHide); } catch (e) {}
      });
    }
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
  if (CACHE_LOGIN && sessionStorage.getItem(USER_CACHE_KEY) && isLoginHref() && !window.__wxpEnhancerEntry) {
    window.__wxpEnhancerEntry = true;
    setTimeout(function () {
      if (isLoginHref() && sessionStorage.getItem(USER_CACHE_KEY)) {
        if (location.hash !== HOME_HASH) location.hash = HOME_HASH;
        location.reload();
      }
    }, ENTRY_DELAY_MS);
  }
  // —— 登录页遮罩：缓存登录会在登录页停一拍再进主页。盖住登录页，登录成功（已离开登录页且 Vuex 有用户）
  // 或登录失效（会话被清掉、仍停在登录页、或超时）后撤掉，避免挡住手动登录 ——
  var LOGIN_LOADING_KEY = '__wxpEnhancerLoginLoading';
  var LOGIN_LOADING_STYLE = [
    '#wxp-enhancer-login-loading{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483646;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'background:rgba(244,247,252,.96);color:#1a1a1a}',
    '#wxp-enhancer-login-loading .wxp-login-spin{width:36px;height:36px;border-radius:50%;',
    'border:3px solid #d6e4f5;border-top-color:#2d5afa;animation:wxpLoginSpin .8s linear infinite}',
    '#wxp-enhancer-login-loading .wxp-login-text{margin-top:14px;',
    'font:14px/1.4 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#333}',
    '@keyframes wxpLoginSpin{to{transform:rotate(360deg)}}',
  ].join('');
  var loginLoadingStarted = function () {
    try { return Number(sessionStorage.getItem(LOGIN_LOADING_KEY)) || 0; } catch (e) { return 0; }
  };
  var hideLoginLoading = function () {
    try { sessionStorage.removeItem(LOGIN_LOADING_KEY); } catch (e) {}
    var el = document.getElementById('wxp-enhancer-login-loading');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  };
  var showLoginLoading = function () {
    try {
      if (!sessionStorage.getItem(LOGIN_LOADING_KEY)) sessionStorage.setItem(LOGIN_LOADING_KEY, String(Date.now()));
    } catch (e) {}
    var style = document.getElementById('wxp-enhancer-login-loading-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'wxp-enhancer-login-loading-style';
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== LOGIN_LOADING_STYLE) style.textContent = LOGIN_LOADING_STYLE;
    if (!document.getElementById('wxp-enhancer-login-loading')) {
      var mask = document.createElement('div');
      mask.id = 'wxp-enhancer-login-loading';
      mask.innerHTML = '<div class="wxp-login-spin"></div><div class="wxp-login-text">正在登录…</div>';
      (document.body || document.documentElement).appendChild(mask);
    }
  };
  var loginSucceeded = function () {
    if (isLoginHref()) return false;
    try {
      var store = readStore();
      return !!(store && store.getters && store.getters.user);
    } catch (e) { return false; }
  };
  var loginFailed = function () {
    var started = loginLoadingStarted();
    var elapsed = started ? Date.now() - started : 0;
    try {
      if (isLoginHref() && !sessionStorage.getItem(USER_CACHE_KEY)) return true;
    } catch (e) {}
    if (isLoginHref() && elapsed > 5000) return true;
    if (elapsed > 15000) return true;
    return false;
  };
  if (CACHE_LOGIN && String(location.protocol || '') !== 'devtools:') {
    var cachedUser = false;
    try { cachedUser = !!sessionStorage.getItem(USER_CACHE_KEY); } catch (e) {}
    if (loginLoadingStarted() && loginSucceeded()) {
      hideLoginLoading();
    } else if (loginLoadingStarted() || (cachedUser && isLoginHref())) {
      showLoginLoading();
      if (!window.__wxpEnhancerLoginWatch) {
        window.__wxpEnhancerLoginWatch = setInterval(function () {
          if (loginSucceeded() || loginFailed()) {
            clearInterval(window.__wxpEnhancerLoginWatch);
            window.__wxpEnhancerLoginWatch = null;
            hideLoginLoading();
          }
        }, 300);
        addDisposer(function () {
          if (window.__wxpEnhancerLoginWatch) clearInterval(window.__wxpEnhancerLoginWatch);
          window.__wxpEnhancerLoginWatch = null;
        });
      }
    }
  }
  // —— 登录引导补跑：真实登录时应用在登录响应处理里做三件事——拉取黑名单与租户
  // 列表（链接中心的数据源）、启动代理 NameNode（不启动就是「代理异常 / 无可用的
  // NameNode服务」）、建立 iframe SSO；缓存登录启动时这些全部没跑。等 Vue 应用挂载、
  // 路由守卫恢复用户后按登录顺序补跑：参数用镜像（LOGIN_PARAMS_KEY）还原，用户名从
  // Vuex 用户对象读取（与黑名单 userCode 同源）。幂等：store 里已有对应值则跳过该项 ——
  if (CACHE_LOGIN && sessionStorage.getItem(USER_CACHE_KEY) && !window.__wxpEnhancerBootstrap) {
    var bootstrapTries = 0;
    window.__wxpEnhancerBootstrap = setInterval(function () {
      bootstrapTries++;
      try {
        if (bootstrapTries > 40) {
          clearInterval(window.__wxpEnhancerBootstrap);
          window.__wxpEnhancerBootstrap = null;
          return;
        }
        var store = readStore();
        if (!store || !store.getters || !store.getters.user || !store.getters.baseURL) return;
        clearInterval(window.__wxpEnhancerBootstrap);
        window.__wxpEnhancerBootstrap = null;
        var baseUrl = store.getters.baseURL;
        var params: any = {};
        try { params = JSON.parse(localStorage.getItem(LOGIN_PARAMS_KEY) || '{}'); } catch (e) { params = {}; }
        // 1) 代理 NameNode：主进程 TCP 注册要求与登录一致的用户名
        if (!store.getters.systemNameNodeAddrs && params.nameNodeAddrs) {
          store.commit('user/SET_SYSTEMNAME_NODE_ADDRS', params.nameNodeAddrs);
          store.dispatch('app/StartNameServer', { username: readLoginUsername(store), namenode: params.nameNodeAddrs })
            .catch(function () {});
        }
        // 2) 租户状态源：还原后才能把租户在线/离线标记刷出来
        var statusRestored = false;
        if (!store.getters.tenantStatusQueryServers && params.statusQueryServers) {
          store.commit('user/SET_TENANTSTATUS_QUERY_SERVERS', params.statusQueryServers);
          statusRestored = true;
        }
        // 3) 黑名单 → 租户列表 → 在线状态（链接中心数据链，按登录时的顺序；
        // GetAllTenants 必须带 idUser，否则接口返回空导致链接中心无数据）
        var tenantsEmpty = !store.getters.tenants || !store.getters.tenants.length;
        if (tenantsEmpty) {
          var tenantUser = store.getters.user || {};
          var tenantIdUser = tenantUser.id_user || tenantUser.idUser || '';
          store.dispatch('blacklist/LoadBlacklists', { baseUrl: baseUrl, userCode: store.getters.user.code })
            .then(function () { return store.dispatch('tenant/GetAllTenants', { baseUrl: baseUrl, idUser: tenantIdUser }); })
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
        // 异常分支同样要及时停表：否则找不到目标时会一直轮询到 40 次上限
        clearInterval(window.__wxpEnhancerBootstrap);
        window.__wxpEnhancerBootstrap = null;
      }
    }, 500);
    addDisposer(function () {
      if (window.__wxpEnhancerBootstrap) clearInterval(window.__wxpEnhancerBootstrap);
      window.__wxpEnhancerBootstrap = null;
    });
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
  var hospitalLabel = function (lc: any) {
    try {
      var h = (lc && lc.hospital) || {};
      return String(h.name || h.code || '').trim();
    } catch (e) { return ''; }
  };
  // 收藏是对象，不是拼接字符串。旧的 `环境|名称|接入点|原地址` 在读到时拆开；
  // 没有 `|` 的旧 id 键丢掉。身份按四个字段相等，医院名不参与匹配。
  var parseFavItem = function (item: any) {
    if (item && typeof item === 'object') {
      var name = String(item.simpleName || '').trim();
      if (!name) return null;
      return {
        sceneformal: String(item.sceneformal || '').trim(),
        simpleName: name,
        accessPoint: String(item.accessPoint || '').trim(),
        targetPoint: String(item.targetPoint || '').trim(),
        hospital: String(item.hospital || '').trim(),
        tenantId: String(item.tenantId || '').trim(),
        code: String(item.code || '').trim(),
      };
    }
    if (typeof item !== 'string' || item.indexOf('|') === -1) return null;
    var parts = item.split('|');
    var legacyName = String(parts[1] || '').trim();
    if (!legacyName) return null;
    return {
      sceneformal: String(parts[0] || '').trim(),
      simpleName: legacyName,
      accessPoint: String(parts[2] || '').trim(),
      targetPoint: String(parts.slice(3).join('|') || '').trim(),
      hospital: '',
      tenantId: '',
      code: '',
    };
  };
  // 转发四字段相同才是同一条。两边都有租户 id 时还必须是同一家医院，避免医院改名后串到别的租户
  var sameFav = function (a: any, b: any) {
    if (!a || !b || a.sceneformal !== b.sceneformal || a.simpleName !== b.simpleName || a.accessPoint !== b.accessPoint || a.targetPoint !== b.targetPoint) return false;
    if (a.tenantId && b.tenantId && a.tenantId !== b.tenantId) return false;
    return true;
  };
  var findFav = function (favs: any, fav: any) {
    for (var i = 0; i < favs.length; i++) { if (sameFav(favs[i], fav)) return i;
    }
    return -1;
  };
  // touchTs 只在用户点星标或补上医院名时写入。迁移旧字符串 / 恢复备份若打上 Date.now()，会把页面标成更新，备份就恢复不回来
  var writeFavs = function (arr: any, touchTs: any) {
    try {
      localStorage.setItem(FAVS_KEY, JSON.stringify(arr));
      if (touchTs) localStorage.setItem(FAV_TS_KEY, String(touchTs));
      if (window.__wxpEnhancerRefreshFavTab) window.__wxpEnhancerRefreshFavTab();
    } catch (e) {}
  };
  var setFavs = function (arr: any) {
    writeFavs(arr, Date.now());
  };
  var getFavs = function () {
    var raw = [];
    try { raw = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]'); } catch (e) { raw = []; }
    if (!raw || !raw.length) return [];
    var out: any[] = [];
    var dirty = false;
    for (var i = 0; i < raw.length; i++) {
      var parsed = parseFavItem(raw[i]);
      if (!parsed) { dirty = true; continue; }
      if (JSON.stringify(raw[i]) !== JSON.stringify(parsed)) dirty = true;
      out.push(parsed);
    }
    if (dirty) writeFavs(out, 0);
    return out;
  };
  var normalizeFavList = function (arr: any) {
    var out: any[] = [];
    if (!arr || !arr.length) return out;
    for (var i = 0; i < arr.length; i++) {
      var parsed = parseFavItem(arr[i]);
      if (parsed) out.push(parsed);
    }
    return out;
  };
  // 启动时把 data-cache.json 里的收藏补进页面 localStorage。
  // 只追加页面没有的项，不删页面上多出来的收藏；缓存为空时不动页面。
  // 不拿时间戳挡：页面时间戳更新但列表里已经没有这些收藏时，旧逻辑会直接跳过。
  try {
    var pageFavs = getFavs();
    var backupFavs = normalizeFavList(BACKUP_FAVS);
    if (backupFavs.length > 0) {
      var mergedFavs = pageFavs.slice();
      for (var bi = 0; bi < backupFavs.length; bi++) {
        if (findFav(mergedFavs, backupFavs[bi]) === -1) mergedFavs.push(backupFavs[bi]);
      }
      if (mergedFavs.length !== pageFavs.length) {
        var pageTs = 0;
        try { pageTs = Number(localStorage.getItem(FAV_TS_KEY)) || 0; } catch (e) {}
        writeFavs(mergedFavs, Math.max(BACKUP_TS, pageTs));
      }
    }
  } catch (e) {}
  // 行记录与接口记录字段同构（环境 / 转发名 / 接入点 / 原地址），按字段相等匹配，不依赖行下标
  var nameCellOf = function (row: any) {
    try {
      // 不能依赖 type class（tenant-link__* 只覆盖部分行），按列位置取转发名称单元格
      return row.querySelector('td[class*="column_4"]') || row.children[3] || null;
    } catch (e) { return null; }
  };
  var favOfRow = function (row: any) {
    try {
      var tds = row.children;
      var nameTd = nameCellOf(row);
      var name = nameTd ? nameTd.innerText.replace(/[☆★]/g, '').trim() : '';
      if (!name) return null;
      return {
        sceneformal: tds[1] ? tds[1].innerText.trim() : '',
        simpleName: name,
        accessPoint: tds[4] ? tds[4].innerText.trim() : '',
        targetPoint: tds[5] ? tds[5].innerText.trim() : '',
        hospital: '',
        tenantId: '',
        code: '',
      };
    } catch (e) { return null; }
  };
  var favOfLink = function (link: any, lc: any): any {
    if (!link) return null;
    var name = String(link.simpleName || '').trim();
    if (!name) return null;
    var h = (lc && lc.hospital) || {};
    return {
      sceneformal: String(link.sceneformal || '').trim(),
      simpleName: name,
      accessPoint: String(link.accessPoint || '').trim(),
      targetPoint: String(link.targetPoint || '').trim(),
      hospital: '',
      tenantId: String(h.id || '').trim(),
      code: String(h.code || '').trim(),
    };
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
      var h = lc.hospital || {};
      var label = hospitalLabel(lc);
      var tenantId = String(h.id || '').trim();
      var code = String(h.code || '').trim();
      var changed = false;
      links.forEach(function (link: any) {
        var idx = findFav(favs, favOfLink(link, lc));
        link.isFav = idx !== -1;
        if (idx === -1) return;
        if (tenantId && favs[idx].tenantId !== tenantId) { favs[idx].tenantId = tenantId; changed = true; }
        if (code && favs[idx].code !== code) { favs[idx].code = code; changed = true; }
        if (label && favs[idx].hospital !== label) { favs[idx].hospital = label; changed = true; }
      });
      links.sort(function (a: any, b: any) { return (b.isFav ? 1 : 0) - (a.isFav ? 1 : 0); });
      if (changed) writeFavs(favs, Date.now());
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
        var rec = favOfRow(row);
        var star = mount.querySelector('.wxp-fav-star');
        if (!star) {
          if (!rec) continue;
          star = document.createElement('i');
          star.className = 'wxp-fav-star';
          mount.appendChild(star);
        }
        var isFav = rec && findFav(favs, rec) !== -1;
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
  // 打开链接的主机名用租户 code；code 为空才回退中文名
  var hospitalHostOf = function (lc: any) {
    var h = lc.hospital || {};
    var host = String(h.code || '').trim().replace(/[^\w.-]/g, '');
    if (!host) host = String(h.name || '').trim().replace(/\s+/g, '-').replace(/[^\w.\-\u4E00-\u9FA5]/g, '');
    return host ? host.toLowerCase() + '.localhost' : '';
  };
  // 行 → 链接对象：内容键两层同构，按键匹配（不依赖行下标）
  var linkOfRow = function (lc: any, row: any) {
    var rec = favOfRow(row);
    if (!rec) return null;
    var links = lc.hospitalLinks || [];
    for (var i = 0; i < links.length; i++) {
      if (sameFav(favOfLink(links[i], lc), rec)) return links[i];
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
    var onFavClick = function (ev: any) {
      var el = ev.target && ev.target.closest ? ev.target.closest('.wxp-fav-star, .wxp-open-btn') : null;
      if (!el) return;
      ev.preventDefault();
      ev.stopPropagation();
      var row = el.closest('tr');
      if (!row) return;
      var lc = findLinkCenterVm(readRootVm());
      if (!lc) return;
      if (el.classList.contains('wxp-fav-star')) {
        var rec = favOfRow(row);
        if (!rec) return;
        var favs = getFavs();
        var idx = findFav(favs, rec);
        if (idx === -1) {
          var starred = lc.hospital || {};
          rec.hospital = hospitalLabel(lc);
          rec.tenantId = String(starred.id || '').trim();
          rec.code = String(starred.code || '').trim();
          favs.unshift(rec);
        } else {
          favs.splice(idx, 1);
        }
        setFavs(favs);
        applyMarkSort(lc);
      } else {
        var link = linkOfRow(lc, row);
        if (link) openHospitalLink(lc, link);
      }
      refreshStars();
    };
    document.addEventListener('click', onFavClick, true);
    addDisposer(function () {
      document.removeEventListener('click', onFavClick, true);
      window.__wxpEnhancerFavClick = false;
    });
  }
  // 数据层接线：包装接口响应入口（getCurrentHospitalLinks），每次拉取后标记+置顶；
  // row-class 给收藏行加高亮（isFav 随每次排序触发的重渲染而刷新到行 class 上）
  if (!window.__wxpEnhancerFavDataScan) {
    var favDataTries = 0;
    var favDataScan = setInterval(function () {
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
          clearInterval(favDataScan);
          window.__wxpEnhancerFavDataDone = true;
          return;
        }
        // 找不到链接中心时不无限轮询：3000ms × 600 次相当于最长 30 分钟常驻定时器，
        // 这里降到 60 次（3 分钟），未命中就交还给下一次文档注入重试
        if (favDataTries > 60) {
          clearInterval(favDataScan);
          window.__wxpEnhancerFavDataScan = false;
        }
      } catch (e) {
        clearInterval(favDataScan);
        window.__wxpEnhancerFavDataScan = false;
      }
    }, 3000);
    window.__wxpEnhancerFavDataScan = true;
    addDisposer(function () {
      clearInterval(favDataScan);
      window.__wxpEnhancerFavDataScan = false;
    });
  }
  // 表格重渲染（切医院/筛选/翻页）后补挂/刷新星标；body 在文档启动早段可能还不存在
  var startFavObserver = function () {
    if (window.__wxpEnhancerFavObserver || !document.body) return;
    window.__wxpEnhancerFavObserver = new MutationObserver(function () {
      if (window.__wxpEnhancerFavScanTimer) return;
      window.__wxpEnhancerFavScanTimer = setTimeout(function () {
        window.__wxpEnhancerFavScanTimer = null;
        refreshStars();
      }, 300);
    });
    // 观察范围仍为 body（链接中心容器会被整体替换，收窄到容器会漏掉重挂载），
    // 但抖动从 150ms 提到 300ms，并且 refreshStars 内部找不到容器时直接返回，
    // 避免表格重渲染时高频全量遍历行 DOM。
    window.__wxpEnhancerFavObserver.observe(document.body, { childList: true, subtree: true });
    refreshStars();
    addDisposer(function () {
      if (window.__wxpEnhancerFavScanTimer) clearTimeout(window.__wxpEnhancerFavScanTimer);
      window.__wxpEnhancerFavScanTimer = null;
      window.__wxpEnhancerFavObserver.disconnect();
      window.__wxpEnhancerFavObserver = null;
    });
  };
  if (document.body) startFavObserver();
  else document.addEventListener('DOMContentLoaded', startFavObserver, { once: true });
  // —— 收藏页签：插在「链接中心」后面，表格按医院分组（对齐工具侧「收藏的转发」） ——
  var FAV_VIEW_ID = 'wxp-fav';
  var favOpening = false;
  var favStatus = '';
  window.__wxpEnhancerRefreshFavTab = function () {};
  var FAV_TAB_STYLE = [
    '#wxp-enhancer-fav-tab{box-sizing:border-box;overflow:auto;background:#fff;padding:12px 16px}',
    '#wxp-enhancer-fav-tab .status{min-height:22px;margin:0 0 8px;color:#707579;font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
    '#wxp-enhancer-fav-tab table{width:100%;border-collapse:collapse;font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1a1a1a}',
    '#wxp-enhancer-fav-tab th{text-align:left;font-weight:600;color:#707579;background:#f7f8fa;padding:8px 12px;border-bottom:1px solid #ebeef5}',
    '#wxp-enhancer-fav-tab td{padding:8px 12px;border-bottom:1px solid #ebeef5;vertical-align:middle}',
    '#wxp-enhancer-fav-tab tr.hospital td{font-weight:600;background:#f7f8fa;color:#2d5afa;cursor:pointer}',
    '#wxp-enhancer-fav-tab tr.hospital td:hover{text-decoration:underline}',
    '#wxp-enhancer-fav-tab .name{padding-left:28px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}',
    '#wxp-enhancer-fav-tab .actions{display:flex;gap:6px;justify-content:flex-end}',
    '#wxp-enhancer-fav-tab .open{border:0;background:#2d5afa;color:#fff;border-radius:4px;padding:2px 12px;cursor:pointer}',
    '#wxp-enhancer-fav-tab .copy{border:1px solid #dcdfe6;background:#fff;color:#2d5afa;border-radius:4px;padding:2px 12px;cursor:pointer}',
    '#wxp-enhancer-fav-tab .remove{border:0;background:transparent;color:#e34d59;border-radius:4px;padding:2px 8px;cursor:pointer}',
    '#wxp-enhancer-fav-tab .open:disabled,#wxp-enhancer-fav-tab .copy:disabled{opacity:.6;cursor:default}',
    '#wxp-enhancer-fav-tab .empty{padding:32px 12px;text-align:center;color:#707579}',
  ].join('');
  var ensureFavTabStyle = function () {
    var style: any = document.getElementById('wxp-enhancer-fav-tab-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'wxp-enhancer-fav-tab-style';
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== FAV_TAB_STYLE) style.textContent = FAV_TAB_STYLE;
  };
  var removeFavDrawer = function () {
    var ids = ['wxp-enhancer-fav-entry', 'wxp-enhancer-fav-page', 'wxp-enhancer-fav-page-style'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  };
  var isDevtoolsHost = function () {
    try {
      var proto = String(location.protocol || '');
      if (proto === 'devtools:') return true;
      var href = String(location.href || '');
      return href.indexOf('devtools://') === 0 || href.indexOf('chrome-devtools://') === 0;
    } catch (e) { return false; }
  };
  var tenantsOf = function () {
    try {
      var store = readStore();
      return (store && store.getters && store.getters.tenants) || [];
    } catch (e) { return []; }
  };
  // 优先租户 id，旧收藏没有 id 时再按 code / 中文名
  var tenantOfFav = function (fav: any) {
    var tenants = tenantsOf();
    var id = String((fav && fav.tenantId) || '').trim();
    var code = String((fav && fav.code) || '').trim();
    var saved = String((fav && fav.hospital) || '').trim();
    var i;
    if (id) {
      for (i = 0; i < tenants.length; i++) { if (String(tenants[i].id || '') === id) return tenants[i];
      }
      return null;
    }
    for (i = 0; i < tenants.length; i++) {
      var name = String(tenants[i].name || '').trim();
      var itemCode = String(tenants[i].code || '').trim();
      if (code && itemCode === code) return tenants[i];
      if (saved && (saved === name || saved === itemCode)) return tenants[i];
    }
    return null;
  };
  var showHospitalInLinkCenter = function (fav: any) {
    var tenant = tenantOfFav(fav);
    if (!tenant) {
      favStatus = '未找到医院「' + (fav.hospital || '') + '」';
      window.__wxpEnhancerRefreshFavTab();
      return;
    }
    try {
      var store = readStore();
      var views = (store && store.state && store.state.menuView && store.state.menuView.visitedViews) || [];
      var linkView = null;
      for (var i = 0; i < views.length; i++) { if (String(views[i].id) === '4') linkView = views[i];
      }
      if (linkView && store.dispatch) store.dispatch('menuView/SetActiveView', linkView);
    } catch (e) {}
    var lc = findLinkCenterVm(readRootVm());
    if (lc && typeof lc.selectedHospital === 'function') lc.selectedHospital(tenant);
  };
  var channelOfFav = function (fav: any) {
    var unknown = { text: '', cls: '' };
    try {
      var lc = findLinkCenterVm(readRootVm());
      if (!lc) return unknown;
      var loaded = (lc.hospital || {});
      var loadedId = String(loaded.id || '').trim();
      if (fav.tenantId && loadedId && fav.tenantId !== loadedId) return unknown;
      if (!fav.tenantId) {
        var target = String((fav && fav.hospital) || '').trim();
        var currentName = hospitalLabel(lc);
        var currentCode = String(loaded.code || '').trim();
        if (target && target !== currentName && target !== currentCode && fav.code !== currentCode) return unknown;
      }
      var links = lc.hospitalLinks || [];
      for (var i = 0; i < links.length; i++) {
        if (!sameFav(favOfLink(links[i], lc), fav)) continue;
        var state = String(links[i].proxyState || '');
        if (state === 'online') return { text: '在线', cls: 'is-online' };
        if (state === 'loading') return { text: '连接中', cls: 'is-loading' };
        if (state === 'offline') return { text: '离线', cls: 'is-offline' };
        return unknown;
      }
    } catch (e) {}
    return unknown;
  };
  // 链接中心：type 0 运维 / 1 交付在 WXP 内打开（原地址，不加医院前缀）；其余默认浏览器打开
  var isInnerWxpLink = function (link: any) {
    var type = Number(link && link.type);
    return type === 0 || type === 1;
  };
  var favoriteUrlOf = function (lc: any, link: any) {
    var url = String((link && link.url) || '');
    if (!url || isInnerWxpLink(link)) return url;
    var host = hospitalHostOf(lc);
    return host ? url.replace('127.0.0.1', host) : url;
  };
  var copyText = function (lc: any, text: any, done: any) {
    var ok = function () { done(true); };
    var bad = function () { done(false); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        var yes = document.execCommand('copy');
        document.body.removeChild(ta);
        yes ? ok() : bad();
      } catch (e) { bad(); }
    };
    try {
      if (lc && typeof lc.$copyText === 'function') {
        lc.$copyText(text).then(ok).catch(bad);
        return;
      }
    } catch (e) {}
    try {
      if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
        window.navigator.clipboard.writeText(text).then(ok).catch(fallback);
        return;
      }
    } catch (e) {}
    fallback();
  };
  var openLinkLikeCenter = function (lc: any, link: any) {
    if (!link || typeof lc.openChannel !== 'function' || !lc.openChannel(link)) return false;
    setTimeout(function () {
      try {
        if (isInnerWxpLink(link) && typeof lc.AddVisitedView === 'function') {
          lc.AddVisitedView({
            path: String(link.url || ''),
            title: link.simpleName,
            desc: (lc.hospital && lc.hospital.name) || '',
            autoLogin: {
              domain: String(link.protocol || 'http') + '://' + String(link.accessPoint || ''),
              type: Number(link.type) === 0 ? 'cop' : 'deliv',
            },
          });
          return;
        }
        var url = favoriteUrlOf(lc, link);
        if (url && typeof lc.AppShellOpen === 'function') lc.AppShellOpen({ path: url, isFolder: false });
      } catch (e) {}
    }, 100);
    return true;
  };
  var useFavoriteLink = function (fav: any, action: any) {
    if (favOpening) return;
    favOpening = true;
    favStatus = action === 'copy' ? '正在复制链接…' : '正在打开…';
    window.__wxpEnhancerRefreshFavTab();
    var finish = function (ok: any, message: any) {
      favOpening = false;
      favStatus = message || (ok ? '已打开' : '打开失败');
      window.__wxpEnhancerRefreshFavTab();
    };
    var openNow = function (lc: any) {
      var links = lc.hospitalLinks || [];
      var link: any = null;
      for (var i = 0; i < links.length; i++) {
        if (sameFav(favOfLink(links[i], lc), fav)) { link = links[i]; break; }
      }
      if (!link) {
        finish(false, fav.hospital ? '该医院的转发列表里没有这条收藏' : '这条收藏还没有医院，请先在链接中心打开对应医院');
        return;
      }
      if (action === 'copy') {
        var copied = favoriteUrlOf(lc, link);
        if (!copied) { finish(false, '没有可复制的地址'); return; }
        copyText(lc, copied, function (ok: any) { finish(ok, ok ? '已复制链接' : '复制失败'); });
        return;
      }
      if (!openLinkLikeCenter(lc, link)) {
        finish(false, '接入点非本地 IP，请复制地址用外部浏览器访问');
        return;
      }
      finish(true, isInnerWxpLink(link) ? '已在 WXP 中打开' : '已在浏览器中打开');
    };
    var afterHospital = function (lc: any) {
      var hospital = tenantOfFav(fav);
      var loadedId = String((lc.hospital && lc.hospital.id) || '').trim();
      if (hospital && loadedId && loadedId === String(hospital.id || '').trim()) { openNow(lc); return; }
      if (!hospital) {
        var target = String(fav.hospital || '').trim();
        var currentName = hospitalLabel(lc);
        var currentCode = String((lc.hospital && lc.hospital.code) || '').trim();
        if (!target || target === currentName || target === currentCode || (fav.code && fav.code === currentCode)) { openNow(lc); return; }
        finish(false, '未找到医院「' + (target || fav.tenantId || '') + '」');
        return;
      }
      if (typeof lc.selectedHospital !== 'function') {
        finish(false, '未找到医院「' + (fav.hospital || fav.tenantId || '') + '」');
        return;
      }
      lc.selectedHospital(hospital);
      var ticks = 0;
      var timer = setInterval(function () {
        ticks++;
        if (lc.loading && ticks < 60) return;
        clearInterval(timer);
        openNow(lc);
      }, 250);
    };
    var waitLc = function () {
      var found = findLinkCenterVm(readRootVm());
      if (found) { afterHospital(found); return; }
      var ticks = 0;
      var timer = setInterval(function () {
        ticks++;
        var lc = findLinkCenterVm(readRootVm());
        if (lc || ticks > 40) {
          clearInterval(timer);
          if (!lc) finish(false, '未找到链接中心');
          else afterHospital(lc);
        }
      }, 250);
    };
    try { waitLc(); } catch (e) { finish(false, '打开失败'); }
  };
  var openFavoriteInWxp = function (fav: any) { useFavoriteLink(fav, 'open'); };
  var copyFavoriteLink = function (fav: any) { useFavoriteLink(fav, 'copy'); };
  var removeFavorite = function (fav: any) {
    var favs = getFavs();
    var idx = findFav(favs, fav);
    if (idx === -1) return;
    favs.splice(idx, 1);
    favStatus = '已取消收藏';
    setFavs(favs);
    try { refreshStars(); } catch (e) {}
  };
  var favTabVnodes = function (h: any) {
    var favs = getFavs();
    var status = h('div', { class: 'status' }, favStatus);
    if (!favs.length) {
      return [status, h('div', { class: 'empty' }, '还没有收藏。在链接中心的转发名称旁点星标即可加入。')];
    }
    var grouped: any = {};
    var keys: any[] = [];
    for (var i = 0; i < favs.length; i++) {
      var key = favs[i].tenantId ? 'id:' + favs[i].tenantId : 'name:' + (favs[i].hospital || '未知医院');
      if (!grouped[key]) { grouped[key] = []; keys.push(key); }
      grouped[key].push(favs[i]);
    }
    keys.sort(function (a: any, b: any) {
      var la = (tenantOfFav(grouped[a][0]) || {}).name || grouped[a][0].hospital || '未知医院';
      var lb = (tenantOfFav(grouped[b][0]) || {}).name || grouped[b][0].hospital || '未知医院';
      if (la === '未知医院') return 1;
      if (lb === '未知医院') return -1;
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
    var body: any[] = [];
    for (var g = 0; g < keys.length; g++) {
      (function (items: any) {
        var live = tenantOfFav(items[0]);
        var label = (live && live.name) || items[0].hospital || '未知医院';
        body.push(h('tr', { class: 'hospital' }, [
          h('td', {
            attrs: { colspan: 5, title: '在链接中心打开这家医院' },
            on: { click: function () { showHospitalInLinkCenter(items[0]); } },
          }, label + '（' + items.length + '）'),
        ]));
        for (var r = 0; r < items.length; r++) {
          (function (fav: any) {
            var channel = channelOfFav(fav);
            body.push(h('tr', [
              h('td', { class: 'name', attrs: { title: fav.simpleName } }, fav.simpleName),
              h('td', fav.sceneformal || '—'),
              h('td', { attrs: { title: fav.accessPoint || '' } }, fav.accessPoint || '—'),
              h('td', { attrs: { title: fav.targetPoint || '' } }, fav.targetPoint || '—'),
              h('td', [
                h('div', { class: 'actions' }, [
                  h('button', {
                    class: 'open',
                    attrs: { disabled: favOpening ? 'disabled' : null, title: channel.text || '与链接中心相同：运维/交付在 WXP 内打开，其余用浏览器' },
                    on: { click: function () { openFavoriteInWxp(fav); } },
                  }, '打开'),
                  h('button', {
                    class: 'copy',
                    attrs: { disabled: favOpening ? 'disabled' : null, title: '复制打开时使用的地址' },
                    on: { click: function () { copyFavoriteLink(fav); } },
                  }, '复制'),
                  h('button', {
                    class: 'remove',
                    attrs: { title: '从收藏中移除' },
                    on: { click: function () { removeFavorite(fav); } },
                  }, '删除'),
                ]),
              ]),
            ]));
          })(items[r]);
        }
      })(grouped[keys[g]]);
    }
    var table = h('table', [
      h('thead', [h('tr', [
        h('th', '医院 / 转发'),
        h('th', '环境'),
        h('th', '接入点'),
        h('th', '原地址'),
        h('th', ''),
      ])]),
      h('tbody', body),
    ]);
    return [status, table];
  };
  var ensureFavView = function () {
    removeFavDrawer();
    if (isDevtoolsHost()) return;
    var root = readRootVm();
    var menu = root && root.$store && root.$store.state && root.$store.state.menuView;
    var views = menu && menu.visitedViews;
    if (!views || !views.length || !root.constructor || !root.constructor.component) return;
    var Vue = root.constructor;
    var appMain: any = null;
    var findAppMain = function (vm: any) {
      if (!vm || appMain) return;
      if (vm.$options && vm.$options.name === 'AppMain') { appMain = vm; return; }
      var children = vm.$children || [];
      for (var ci = 0; ci < children.length; ci++) findAppMain(children[ci]);
    };
    findAppMain(root);
    // 全局 Vue.component 加在另一份 components 表上，AppMain 解析不到，页签会渲成空标签。
    // 脚本按 rev 重注时旧组件还在，对不上就换掉并卸下页签，让后面重新挂上新渲染函数
    var favUiRev = env && env.rev;
    var FavCtor = Vue.options.components.WxpFavLinks;
    if (!FavCtor || !FavCtor.options || FavCtor.options.wxpRev !== favUiRev) {
      Vue.component('WxpFavLinks', {
        name: 'WxpFavLinks',
        wxpRev: favUiRev,
        props: { eleHeight: { type: Number, default: 0 } },
        data: function () { return { tick: 0 }; },
        mounted: function () {
          var self = this;
          window.__wxpEnhancerRefreshFavTab = function () { self.tick += 1; };
        },
        beforeDestroy: function () {
          window.__wxpEnhancerRefreshFavTab = function () {};
        },
        render: function (h: any) {
          var tick = this.tick;
          return h('div', {
            attrs: { id: 'wxp-enhancer-fav-tab' },
            style: { height: this.eleHeight ? this.eleHeight + 'px' : 'calc(100vh - 90px)' },
          }, favTabVnodes(h).concat([h('span', { style: { display: 'none' } }, String(tick))]));
        },
      });
      FavCtor = Vue.options.components.WxpFavLinks;
      if (appMain && appMain.$options && appMain.$options.components) {
        appMain.$options.components.WxpFavLinks = FavCtor;
        appMain.$forceUpdate();
      }
      for (var drop = views.length - 1; drop >= 0; drop--) {
        if (views[drop].id === FAV_VIEW_ID) views.splice(drop, 1);
      }
    } else if (appMain && appMain.$options && appMain.$options.components && !appMain.$options.components.WxpFavLinks) {
      appMain.$options.components.WxpFavLinks = FavCtor;
      appMain.$forceUpdate();
    }
    ensureFavTabStyle();
    var linkAt = -1;
    var favAt = -1;
    for (var i = 0; i < views.length; i++) {
      if (String(views[i].id) === '4') linkAt = i;
      if (views[i].id === FAV_VIEW_ID) favAt = i;
    }
    if (linkAt === -1) return;
    if (favAt === linkAt + 1) return;
    var view = favAt >= 0
      ? views.splice(favAt, 1)[0]
      : {
          id: FAV_VIEW_ID,
          title: '收藏',
          component: 'WxpFavLinks',
          sysView: true,
          enableClose: false,
          elementHeight: views[linkAt].elementHeight || 618,
        };
    if (favAt >= 0 && favAt < linkAt) linkAt -= 1;
    views.splice(linkAt + 1, 0, view);
  };
  var favViewTimer = setInterval(ensureFavView, 1000);
  addDisposer(function () { clearInterval(favViewTimer); });
  if (document.body) ensureFavView();
  else document.addEventListener('DOMContentLoaded', ensureFavView, { once: true });
  // —— 「增强中」：挂在顶栏页签与右侧用户区之间（不塞进 .right-menu，避免挤掉关闭按钮） ——
  var removeBadge = function () {
    var staleBadge = document.getElementById('wxp-enhancer-badge');
    staleBadge && staleBadge.parentNode && staleBadge.parentNode.removeChild(staleBadge);
    var staleBadgeStyle = document.getElementById('wxp-enhancer-badge-style');
    staleBadgeStyle && staleBadgeStyle.parentNode && staleBadgeStyle.parentNode.removeChild(staleBadgeStyle);
  };
  var placeBadge = function () {
    var header = document.querySelector('.window-header-wrapper');
    if (!header) return;
    var right = header.querySelector('.right-menu');
    if (!right) return;
    var badge = document.getElementById('wxp-enhancer-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'wxp-enhancer-badge';
      badge.textContent = '增强中';
    }
    if (badge.parentNode !== header || badge.nextSibling !== right) header.insertBefore(badge, right);
  };
  if (!SHOW_BADGE) {
    removeBadge();
  } else {
    var badgeStyleEl = document.getElementById('wxp-enhancer-badge-style');
    if (!badgeStyleEl) {
      badgeStyleEl = document.createElement('style');
      badgeStyleEl.id = 'wxp-enhancer-badge-style';
      (document.head || document.documentElement).appendChild(badgeStyleEl);
    }
    if (badgeStyleEl.textContent !== BADGE_STYLE) badgeStyleEl.textContent = BADGE_STYLE;
    placeBadge();
    var badgeTimer = setInterval(placeBadge, 1000);
    addDisposer(function () { clearInterval(badgeTimer); });
  }
}
