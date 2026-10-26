import type { Wb2apiHealthSnapshot } from '../../../../shared/workbuddy2api-panel.ts'
import {
  buildWb2apiHealthzUrl,
  WB2API_HEALTH_SERVICE,
} from '../../../../shared/workbuddy2api-panel.ts'

/**
 * 探活只在主进程：看 service 字段；503 + 正确 service = running_empty，≠ 进程挂。
 * 不要求 HTTP 200。
 */
export async function probeHealthz(port: number, timeoutMs = 2500): Promise<Wb2apiHealthSnapshot> {
  const url = buildWb2apiHealthzUrl(port)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const text = await res.text()
    let service: string | null = null
    let healthy: number | null = null
    let total: number | null = null
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      if (typeof json.service === 'string') service = json.service
      if (typeof json.healthy === 'number') healthy = json.healthy
      if (typeof json.total === 'number') total = json.total
    } catch {
      // 非 JSON 忽略
    }
    const headerService = res.headers.get('x-service')
    if (!service && headerService) service = headerService

    const identityOk = service === WB2API_HEALTH_SERVICE
    return {
      ok: identityOk,
      statusCode: res.status,
      service,
      healthy,
      total,
      error: identityOk ? null : `身份不匹配：service=${service ?? 'null'}`,
    }
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      service: null,
      healthy: null,
      total: null,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function classifyHealthStatus(
  health: Wb2apiHealthSnapshot,
): 'running' | 'running_empty' | 'unhealthy' {
  if (!health.ok) return 'unhealthy'
  if (health.statusCode === 503) return 'running_empty'
  if (health.statusCode === 200) return 'running'
  if ((health.healthy ?? 0) > 0) return 'running'
  return 'running_empty'
}
