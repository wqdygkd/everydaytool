// wxp-enhancer 域：注入脚本装配（本体以 JS 资产嵌入，参数经 JSON 拼装，与 Node toString 产物等价）。
use serde_json::{json, Value};

pub const WXP_INJECTION_REV: u32 = 15;

// —— 键名单一来源（与 Node 版 injection-source.ts 完全一致）——
const USER_CACHE_KEY: &str = "user-info-cache";
const SNAPSHOT_KEY: &str = "__wxpEnhancerSessionSnapshot";
const LEGACY_SNAPSHOT_KEY: &str = "__wxpEnhancerUserCache";
const LOGIN_PARAMS_KEY: &str = "__wxpEnhancerLoginParams";
const LINK_FAVORITES_KEY: &str = "__wxpEnhancerLinkFavorites";
const LINK_FAVORITES_TS_KEY: &str = "__wxpEnhancerLinkFavoritesTs";

const BADGE_STYLE: &str = concat!(
    "#wxp-enhancer-badge{display:inline-flex;align-items:center;align-self:center;gap:6px;",
    "flex:none;height:24px;margin:0 8px;padding:0 10px;border-radius:999px;",
    "background:rgba(255,255,255,.18);color:#fff;",
    "font:12px/1 system-ui,-apple-system,\"Segoe UI\",\"Microsoft YaHei\",sans-serif;letter-spacing:.02em;",
    "pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag}",
    "#wxp-enhancer-badge::before{content:\"\";width:7px;height:7px;border-radius:50%;background:#07c160;",
    "animation:wxpEnhancerBreathe 2.2s ease-in-out infinite}",
    "@keyframes wxpEnhancerBreathe{0%,100%{opacity:1;box-shadow:0 0 6px 1px rgba(7,193,96,.55)}",
    "50%{opacity:.35;box-shadow:0 0 1px 0 rgba(7,193,96,.15)}}",
);

const HOME_HASH: &str = "#/home";
const ENTRY_DELAY_MS: u64 = 800;
const SNAPSHOT_TTL_MS: u64 = 14 * 24 * 60 * 60 * 1000;

pub struct InjectionOptions {
    pub show_status_badge: bool,
    pub cache_login: bool,
    pub clear_login_cache_once: bool,
    /// 链接收藏备份（页面没有的项补进 localStorage）
    pub favorites_backup: Option<Value>,
}

/// 装配注入脚本：`window.__wxpEnv = {参数}; (函数本体)();`
pub fn build_injection_source(options: &InjectionOptions) -> String {
    let favorites = options
        .favorites_backup
        .clone()
        .unwrap_or(json!({ "favs": [], "updatedAt": 0 }));
    let env = json!({
        "cacheLogin": options.cache_login,
        "clearPending": options.clear_login_cache_once,
        "showBadge": options.show_status_badge,
        "entryDelayMs": ENTRY_DELAY_MS,
        "homeHash": HOME_HASH,
        "snapshotTtlMs": SNAPSHOT_TTL_MS,
        "rev": WXP_INJECTION_REV,
        "favoritesBackup": favorites,
        "badgeStyle": BADGE_STYLE,
        "clearSnippet": build_clear_login_cache_snippet(),
        "keys": {
            "userCache": USER_CACHE_KEY,
            "snapshot": SNAPSHOT_KEY,
            "legacySnapshot": LEGACY_SNAPSHOT_KEY,
            "loginParams": LOGIN_PARAMS_KEY,
            "favorites": LINK_FAVORITES_KEY,
            "favoritesTs": LINK_FAVORITES_TS_KEY,
        },
    });
    format!(
        "window.__wxpEnv = {};\n({})();",
        env,
        include_str!("../../assets/wxp-injection-main.js")
    )
}

/// 清除登录缓存的页面端脚本
pub fn build_clear_login_cache_snippet() -> String {
    format!(
        r#";(function () {{
  try {{
    localStorage.removeItem({SNAPSHOT_KEY:?});
    localStorage.removeItem({LEGACY_SNAPSHOT_KEY:?});
    localStorage.removeItem({LOGIN_PARAMS_KEY:?});
    sessionStorage.removeItem({USER_CACHE_KEY:?});
  }} catch (e) {{}}
}})();"#
    )
}
