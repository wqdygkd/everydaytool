// M3 可行性报告：把「运行环境」「依赖」「媒体路径」「页面捕获能力」「MTProto 前置条件」汇总成
// 一份可导出、可决策的报告。它不执行下载、不读凭据、不假装具备 MTProto 能力。
import type {
  TelegramFeasibilityCheck,
  TelegramFeasibilityDependencies,
  TelegramFeasibilityReport,
} from '../../../../shared/telegram-cache.ts'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { describeMtprotoConfig } from './mtproto-service.ts'
import { getTelegramObservationStats } from './observation-service.ts'
import {
  describePageCaptureCapability,
  getLastPageProbeClues,
  getTrafficClassification,
} from './page-capture-service.ts'
import { getLastProbe } from './probe-service.ts'
import { getTelegramMtprotoReportSection } from './telegram-media-adapter.ts'

const require = createRequire(import.meta.url)

function probeTeleproto(): TelegramFeasibilityDependencies['teleproto'] {
  // 只做“是否安装 / 版本”探测：不 import 库、不读凭据、不建立连接
  for (const candidate of ['teleproto/package.json', 'teleproto']) {
    try {
      const resolved = require.resolve(candidate)
      const pkgPath = resolved.endsWith('package.json')
        ? resolved
        : path.join(path.dirname(resolved), 'package.json')
      const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
      return {
        packageName: 'teleproto',
        installed: true,
        version: typeof raw.version === 'string' ? raw.version : null,
      }
    } catch {
      // 继续尝试下一个入口
    }
  }
  return { packageName: 'teleproto', installed: false, version: null }
}

export function buildTelegramFeasibilityReport(): TelegramFeasibilityReport {
  const stats = getTelegramObservationStats()
  const traffic = getTrafficClassification()
  const clues = getLastPageProbeClues()
  const capture = describePageCaptureCapability()
  const probe = getLastProbe()
  const teleproto = probeTeleproto()
  const mtConfig = describeMtprotoConfig()
  const httpMediaRequests = traffic.imageRequests + traffic.mediaRequests

  let httpMediaMajority: boolean | null = null
  let summary: string
  if (httpMediaRequests === 0 && traffic.websocketRequests === 0) {
    summary = '样本不足：先打开聊天、浏览图片并播放一段媒体，再运行检查。'
  } else if (httpMediaRequests === 0) {
    summary = '当前样本里没有图片 / 媒体的普通 HTTP 请求，媒体可能走 WebSocket / blob：全局 HTTP 拦截收益低，应优先验证页面捕获与 MTProto 路径。'
  } else if (traffic.websocketRequests === 0) {
    httpMediaMajority = true
    summary = '当前样本的媒体请求全部走普通 HTTP，可优先复用 HTTP 缓存与页面捕获；MTProto 下载器不是必需项。'
  } else {
    summary = `HTTP 媒体请求 ${httpMediaRequests} 个、WebSocket 请求 ${traffic.websocketRequests} 个：两条路径并存，需用固定聊天 / 媒体集合做基准测试后再决定 MTProto 下载器优先级。`
  }

  const checks: TelegramFeasibilityCheck[] = [
    {
      id: 'electron-runtime',
      title: 'Electron / Chromium 运行时',
      status: process.versions.electron ? 'pass' : 'fail',
      detail: `Electron ${process.versions.electron ?? '?'} / Chromium ${process.versions.chrome ?? '?'} / Node ${process.versions.node}`,
    },
    {
      id: 'page-probe',
      title: '页面只读探测（UA / SW / blob / 媒体元素）',
      status: probe?.ok ? 'pass' : 'blocked',
      detail: probe?.ok
        ? `UA: ${probe.userAgent || '未知'}；SW ${probe.serviceWorkerActive ? '活动' : '未活动'}；blob ${probe.blobUrlCount}；媒体元素 ${probe.mediaElementCount}`
        : '尚未成功探测页面；请等 Telegram 页面加载完成后在诊断页执行探测。',
    },
    {
      id: 'http-media-majority',
      title: '媒体路径判定',
      status: httpMediaMajority === true ? 'pass' : httpMediaMajority === false ? 'fail' : 'blocked',
      detail: summary,
    },
    {
      id: 'teleproto-installed',
      title: 'teleproto 依赖',
      status: teleproto.installed ? 'pass' : 'blocked',
      detail: teleproto.installed
        ? `已安装 teleproto@${teleproto.version ?? 'unknown'}；仍需实测分块语义`
        : '未安装 teleproto；本工具不会自动安装依赖。',
    },
    {
      id: 'api-credentials',
      title: 'api_id / api_hash',
      status: mtConfig.configured ? 'pass' : 'blocked',
      detail: mtConfig.configured
        ? '已从主进程环境 / .env 读取（值不会进入日志、渲染层或页面）。'
        : `缺少：${mtConfig.missing.join(' / ') || 'TELEGRAM_API_ID / TELEGRAM_API_HASH'}`,
    },
    {
      id: 'session-storage',
      title: '登录会话与存储',
      status: mtConfig.hasSession ? 'manual' : 'blocked',
      detail: mtConfig.hasSession
        ? '会话字符串由 .env 提供；未使用 OS 密钥加密，文件权限由用户负责。'
        : '缺少 TELEGRAM_SESSION：先运行 pnpm telegram:session 生成。',
    },
    {
      id: 'mtproto-connect',
      title: 'MTProto 连接 / 账号',
      status: mtConfig.connected ? 'pass' : 'manual',
      detail: mtConfig.connected
        ? '当前已连接；实际下载仍需用固定媒体验证分块与完整性。'
        : '尚未连接：运行一次 MTProto 下载才会建立连接。',
    },
    {
      id: 'resume-math',
      title: '分块 / 续传字节数学',
      status: 'pass',
      detail: '已实现库无关规划器（分块、区间合并、连续提交量、缺口）并通过自检；teleproto 的 offset / limit 语义仍需实测。',
    },
    {
      id: 'integrity-verify',
      title: '完整性校验（SHA-256 对照）',
      status: 'manual',
      detail: '需要真实分块下载后与完整下载的 SHA-256 对照；当前没有下载器。',
    },
    {
      id: 'account-scope',
      title: '账号级缓存隔离',
      status: 'blocked',
      detail: '缺少稳定 account scope；切换账号前必须清理缓存。',
    },
  ]

  return {
    checkedAt: Date.now(),
    environment: {
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node ?? null,
      platform: process.platform,
      userAgent: probe?.userAgent || null,
      pageUrl: probe?.url || null,
      serviceWorkerActive: probe?.ok ? probe.serviceWorkerActive : null,
      blobUrlCount: probe?.ok ? probe.blobUrlCount : null,
      mediaElementCount: probe?.ok ? probe.mediaElementCount : null,
      websocketObserved: traffic.websocketRequests > 0,
    },
    dependencies: { teleproto },
    checks,
    observation: {
      requests: stats.requests,
      websocketRequests: traffic.websocketRequests,
      imageRequests: traffic.imageRequests,
      mediaRequests: traffic.mediaRequests,
      blobClues: clues.blobUrlCount,
      byType: stats.byType,
      topHosts: stats.byHost.slice(0, 5),
      note: '分类来自 webRequest 的 resourceType 计数，不包含字节量；WebSocket 只说明存在长连接，不能据此推断媒体体积。',
    },
    capture,
    mtproto: getTelegramMtprotoReportSection(mtConfig.configured && mtConfig.hasSession),
    decision: {
      httpMediaMajority,
      summary,
    },
  }
}
