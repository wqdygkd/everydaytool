// tweb-cache（以 tweb / Telegram Web K 为前端）的共享常量与类型。
//
// 归档实现与 HTTP 协议复用 telegram-cache 的引擎（见 shared/telegram-cache.ts），
// 但数据按工具 scope 分开：`<assets>/tweb-cache/messages/...`。
// 这里只放本工具独有的东西：站点端口、配置、站点状态。
import type { TelegramSiteInfo } from './telegram-cache.ts'

/**
 * 站点端口基址：与 telegram-cache 的 34100 错开，保证两个工具**不同 origin**。
 * 两个 PWA 的 Service Worker 作用域都是 `/`，同源会互相接管 fetch；且 origin 变化
 * 会让登录态（IndexedDB / localStorage / SW 注册）全部作废，所以端口必须确定。
 */
export const TWEB_CACHE_SITE_PORT_BASE = 34200
export const TWEB_CACHE_SITE_PORT_RANGE = 16
export const TWEB_CACHE_SITE_PORT_MIN = 1024
export const TWEB_CACHE_SITE_PORT_MAX = 65535

export interface TwebCacheConfig {
  /** 站点端口：落盘后固定，保 origin 不变；null = 还没分配过 */
  sitePort: number | null
}

export const TWEB_CACHE_DEFAULT_CONFIG: TwebCacheConfig = {
  sitePort: null,
}

/** 站点状态与 telegram-cache 同构，直接复用同一份形状（渲染层只读展示） */
export type TwebCacheSiteInfo = TelegramSiteInfo
