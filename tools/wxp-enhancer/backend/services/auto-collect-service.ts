import type { WxpDataCache } from '../../../../shared/wxp.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { evaluateOnMainPage } from './cdp-client.ts'
import { buildLoginStateExpression, collectWxpData } from './data-collector.ts'

/** 登录探针轮询间隔：WXP 运行期间常驻，失败静默等下轮 */
const PROBE_INTERVAL_MS = 15000
/** 无变化时的兜底刷新：保证长时间运行后数据缓存不会太旧 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

interface LoginProbeState {
  userCode?: string
  favUpdatedAt?: number
}

let timer: NodeJS.Timeout | null = null
let generation = 0
let ticking = false
let lastFavTs: number | null = null
let lastCollectedAt = 0

let cacheEmitter: ((cache: WxpDataCache) => void) | null = null

export function setWxpDataCacheEmitter(emitter: ((cache: WxpDataCache) => void) | null): void {
  cacheEmitter = emitter
}

/**
 * 登录后自动采集：探测到 WXP 已登录（Vuex 用户存在）即把登录信息与收藏数据
 * 写入工具数据缓存并广播，前端无需手动点「从 WXP 读取」；收藏时间戳变化或超过
 * 兜底间隔时重新采集。页面未就绪等异常静默跳过，下轮继续。
 */
export function startAutoCollect(port: number): void {
  stopAutoCollect()
  const gen = ++generation
  lastFavTs = null
  lastCollectedAt = 0

  const tick = async (): Promise<void> => {
    if (gen !== generation || ticking) return
    ticking = true
    try {
      const state = (await evaluateOnMainPage(port, buildLoginStateExpression())) as LoginProbeState | null
      if (gen !== generation || !state?.userCode) return
      const favTs = Number(state.favUpdatedAt ?? 0)
      const stale = lastCollectedAt === 0 || Date.now() - lastCollectedAt > REFRESH_INTERVAL_MS
      if (lastFavTs !== null && favTs === lastFavTs && !stale) return
      const cache = await collectWxpData(port)
      if (gen !== generation) return
      lastFavTs = favTs
      lastCollectedAt = cache.collectedAt
      cacheEmitter?.(cache)
      logger.info('wxp:data cache auto collected', {
        userCode: state.userCode,
        favorites: cache.favorites.length,
      })
    } catch {
      // 页面未就绪 / 目标繁忙：下轮继续
    } finally {
      if (gen === generation) ticking = false
    }
  }

  void tick()
  timer = setInterval(() => {
    void tick()
  }, PROBE_INTERVAL_MS)
}

export function stopAutoCollect(): void {
  generation += 1
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
