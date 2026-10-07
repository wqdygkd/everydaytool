import type { WxpClearLoginCacheResult, WxpRunningState, WxpSettings } from '../../../../shared/types.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { sleep } from '../../../../shared/sleep.ts'
import { wxpConfigStore } from '../store/config-store.ts'
import { isExecutableRunning } from '../utils/process-detect.ts'
import { CdpInjectionSession, evaluateInPageTargets, waitForCdpPort } from './cdp-client.ts'
import { buildClearLoginCacheSnippet, buildInjectionSource } from './injection-source.ts'
import { processLauncher } from './launcher-service.ts'

const PROFILE_ID = 'wxp'
/** 拉起后的最短等待：给进程一点启动时间，CDP 就绪探测由 waitForCdpPort 重试兜底 */
const STARTUP_DELAY_MS = 500
const CDP_TIMEOUT_MS = 30000
const POLL_INTERVAL_MS = 2000

let session: CdpInjectionSession | null = null

let runningState: WxpRunningState | null = null

/** 本次会话使用的设置（进程退出回调里判定应用是否存活用） */
let activeSettings: WxpSettings | null = null

let statusEmitter: ((state: WxpRunningState | null) => void) | null = null

// 附加模式下没有子进程可跟踪，用存活看门狗检测应用自行退出。
// 频率从 4s 降到 15s：看门狗每次都要拉起一次进程查询，过高的频率会持续消耗 CPU/电量。
const ATTACH_CHECK_INTERVAL_MS = 15000
const ATTACH_MAX_MISSES = 2

let attachWatchdog: NodeJS.Timeout | null = null
let attachMissCount = 0

function stopAttachWatchdog(): void {
  if (attachWatchdog) {
    clearInterval(attachWatchdog)
    attachWatchdog = null
  }
  attachMissCount = 0
}

function startAttachWatchdog(settings: WxpSettings): void {
  stopAttachWatchdog()
  attachWatchdog = setInterval(() => {
    void checkAttachedAlive(settings)
  }, ATTACH_CHECK_INTERVAL_MS)
}

async function checkAttachedAlive(settings: WxpSettings): Promise<void> {
  if (await isExecutableRunning(settings.executablePath)) {
    attachMissCount = 0
    return
  }
  attachMissCount += 1
  if (attachMissCount >= ATTACH_MAX_MISSES) {
    logger.info('wxp:attached app exited')
    await teardownSession()
  }
}

/** 结束注入会话并清理运行状态（应用退出、看门狗判定退出、手动停止共用） */
async function teardownSession(): Promise<boolean> {
  stopAttachWatchdog()
  if (session) {
    await session.stop()
    session = null
  }
  const stopped = await processLauncher.stop(PROFILE_ID, { graceful: true })
  clearState()
  return stopped
}

/** 被拉起进程退出：先确认应用进程真的消失（launcher 交接型启动时应用可能仍存活），再决定拆会话还是转看门狗 */
async function handleAppExit(): Promise<void> {
  const current = session
  if (!current) return
  const settings = activeSettings
  if (settings && await isExecutableRunning(settings.executablePath)) {
    logger.info('wxp:launcher exited but app still alive, switching to watchdog')
    startAttachWatchdog(settings)
    return
  }
  session = null
  stopAttachWatchdog()
  void current.stop().catch(() => {})
  logger.info('wxp:app exited by user')
  clearState()
}

export function setWxpStatusEmitter(emitter: ((state: WxpRunningState | null) => void)): void {
  statusEmitter = emitter
}

function emitStatus(): void {
  statusEmitter?.(runningState)
}

function setState(patch: Partial<WxpRunningState>): WxpRunningState {
  const next: WxpRunningState = {
    port: runningState?.port ?? 0,
    status: 'stopped',
    message: '',
    updatedAt: Date.now(),
    ...runningState,
    ...patch,
  }
  runningState = next
  emitStatus()
  return next
}

function clearState(): void {
  runningState = null
  emitStatus()
}

export function assertSettings(settings: WxpSettings): void {
  if (!settings.executablePath.trim()) {
    throw new Error('未设置 WXP 路径，请先选择可执行文件')
  }
  if (!Number.isInteger(settings.debugPort) || settings.debugPort < 1024 || settings.debugPort > 65535) {
    throw new Error('调试端口需在 1024 - 65535 之间')
  }
}

async function buildInjectionSourceFromStore(clearLoginCacheOnce = false): Promise<string> {
  const settings = await wxpConfigStore.getSettings()
  return buildInjectionSource({
    showStatusBadge: settings.showStatusBadge,
    cacheLogin: settings.cacheLogin,
    clearLoginCacheOnce,
  })
}

export const wxpService = {
  getRunning(): WxpRunningState | null {
    return runningState
  },

  async launch(): Promise<WxpRunningState> {
    if (session || processLauncher.isRunning(PROFILE_ID)) {
      throw new Error('WXP 增强已在运行中，请先停止后再启动')
    }

    const settings = await wxpConfigStore.getSettings()
    assertSettings(settings)
    activeSettings = settings

    // 已在运行的 WXP（上次会话遗留等）若调试端口仍可用，直接附加注入，不重复拉起
    if (await this.probeCdp(settings.debugPort)) {
      if (!(await isExecutableRunning(settings.executablePath))) {
        throw new Error(`调试端口 ${settings.debugPort} 已被其他程序占用，请更换端口后重试`)
      }
      setState({
        port: settings.debugPort,
        status: 'connecting',
        message: `发现 WXP 已在运行，附加调试端口 ${settings.debugPort}…`,
        targetCount: 0,
      })
      const attachedState = await this.startSession(settings, '已附加到运行中的 WXP，脚本注入生效')
      startAttachWatchdog(settings)
      return attachedState
    }

    if (await isExecutableRunning(settings.executablePath)) {
      throw new Error('检测到 WXP 已在运行（未开启调试端口），请先退出 WXP 再启动')
    }

    setState({
      port: settings.debugPort,
      status: 'launching',
      message: '正在启动 WXP…',
      targetCount: 0,
    })

    try {
      // 不传 --user-data-dir：复用 WXP 自身数据，登录状态由应用保留
      const { pid, args } = await processLauncher.launch(
        PROFILE_ID,
        settings.executablePath,
        settings.extraArgs?.trim() ?? '',
        settings.debugPort,
        { onExit: () => {
          void handleAppExit()
        } },
      )

      setState({
        pid,
        status: 'waiting',
        message: `进程已启动 (PID ${pid})，等待 CDP…`,
        launchArgs: args,
      })

      await sleep(STARTUP_DELAY_MS)

      setState({
        status: 'connecting',
        message: `连接调试端口 ${settings.debugPort}…`,
      })

      await waitForCdpPort(settings.debugPort, CDP_TIMEOUT_MS)

      const state = await this.startSession(settings, '注入运行中，新页面将自动应用')
      logger.info('wxp:launch success', { port: settings.debugPort, pid })
      return state
    } catch (error) {
      // 若进程在等待 CDP 期间已退出，给出比「超时」更准确的原因
      const childAlive = processLauncher.isRunning(PROFILE_ID)
      await this.stop().catch(() => {})
      const raw = (error as Error).message
      const message = !childAlive && raw.includes('CDP 端口')
        ? 'WXP 进程在启动过程中已退出，请检查路径与启动参数'
        : raw
      setState({
        status: 'error',
        message,
        port: settings.debugPort,
        pid: undefined,
      })
      logger.error('wxp:launch failed', { error: message })
      throw error
    }
  },

  /** 短探测调试端口是否已有 CDP 服务在监听 */
  async probeCdp(port: number): Promise<boolean> {
    try {
      await waitForCdpPort(port, 2500)
      return true
    } catch {
      return false
    }
  },

  async startSession(settings: WxpSettings, message: string): Promise<WxpRunningState> {
    // 登记了「待清除登录缓存」时，首轮注入的脚本带清除块（先于还原执行）
    const clearPending = await wxpConfigStore.getLoginCacheClearPending()
    const nextSession = new CdpInjectionSession({
      port: settings.debugPort,
      scriptSource: await buildInjectionSourceFromStore(clearPending),
      pollIntervalMs: POLL_INTERVAL_MS,
      onTargetsInjected: ({ total }) => {
        setState({
          status: 'running',
          message: '注入运行中，新页面将自动应用',
          targetCount: total,
        })
      },
    })

    session = nextSession
    await nextSession.start()

    if (clearPending) {
      // 清除已在首轮注入完成，换回常规脚本并强制重注入：否则后续新文档会把用户
      // 重新登录后写入的快照再次清掉
      await wxpConfigStore.setLoginCacheClearPending(false)
      nextSession.setScriptSource(await buildInjectionSourceFromStore())
      await nextSession.scanAndInject(true).catch(() => {})
      logger.info('wxp:login cache cleared on boot')
    }

    return setState({
      status: 'running',
      message,
      targetCount: nextSession.injectedTargetCount,
    })
  },

  /** 优先正常关闭（让 WXP 保存登录/会话状态），超时后才强制结束 */
  async stop(): Promise<boolean> {
    return teardownSession()
  },

  /**
   * 清除登录缓存。运行中：在全部页面移除工具写入的会话快照 / 镜像与会话内用户
   * 缓存（不动应用自身的 wxp_access_token）并刷新页面，重新加载后的文档无快照可
   * 还原，路由守卫会把应用送回登录页。未运行：登记待清除标记，下次启动注入的
   * 脚本会在文档最早时刻先行清除，随后自动换回常规脚本。
   */
  async clearLoginCache(): Promise<WxpClearLoginCacheResult> {
    if (session && runningState) {
      const port = runningState.port
      const cleared = await evaluateInPageTargets(port, buildClearLoginCacheSnippet())
      await evaluateInPageTargets(port, 'location.reload();').catch(() => 0)
      await wxpConfigStore.setLoginCacheClearPending(false)
      setState({ message: `已清除登录缓存（${cleared} 个页面），请重新登录` })
      return { pages: cleared }
    }
    await wxpConfigStore.setLoginCacheClearPending(true)
    return { pages: 0, pending: true }
  },

  async reinject(): Promise<number> {
    if (!session) {
      throw new Error('WXP 未在运行，请先启动')
    }
    const count = await session.scanAndInject(true)
    setState({
      status: 'running',
      message: `已重新注入（${count} 个页面）`,
      targetCount: session.injectedTargetCount,
    })
    return count
  },

  /** 设置保存后若在运行，自动用新脚本重新注入（失败不影响保存） */
  async applyIfRunning(): Promise<boolean> {
    if (!session) return false
    session.setScriptSource(await buildInjectionSourceFromStore())
    await this.reinject()
    return true
  },
}
