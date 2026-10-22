// 处理名单匹配：名单是**白名单闸门**，只按请求 origin（scheme + host + port）判定。
// 命中 → 进处理层（拆包 / 记流量）并交给规则；没命中 → 整条透传，规则一条都不跑。
// 细粒度的"这个地址怎么处理"全在规则里（见 docs/interceptor.md §3）。
import type { InterceptorTarget } from '../../../../shared/interceptor.ts'
import { targetMatchesOrigin } from '../../../../shared/interceptor.ts'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host)
  return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith('127.')
}

/** 主机名归一（小写、去方括号）：上游连接 / 证书校验 / 规则域判定共用 */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, '')
}

/** 条目是否生效（历史数据无 enabled 字段 = 启用） */
export function isTargetEnabled(target: InterceptorTarget): boolean {
  return target.enabled !== false
}

export interface TargetMatch {
  target: InterceptorTarget
}

/** 名单匹配：条目之间是并集，第一个命中即处理（origin 字符串相等） */
export function matchTarget(targets: InterceptorTarget[], origin: string): TargetMatch | null {
  for (const target of targets) {
    if (targetMatchesOrigin(target, origin)) return { target }
  }
  return null
}
