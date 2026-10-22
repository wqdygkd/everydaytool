// 规则引擎（v2）：Source + 高级过滤器匹配，生成请求执行计划（URL 改写 /
// 重定向 / 取消 / 延迟 / UA / 请求头 / 请求体），并应用响应变更。
// 命中多条规则时按列表顺序叠加；模型见 shared/interceptor.ts。
import type {
  HeaderOperation,
  InterceptorRule,
  QueryParamModification,
  ResourceType,
  RuleSource,
} from '../../../../shared/interceptor.ts'
import { Buffer } from 'node:buffer'
import { compileSourceRegex, matchSource, wildcardToRegex as sharedWildcardToRegex } from '../../../../shared/interceptor.ts'
import { normalizeHost } from './target-list.ts'

export interface RuleMatchContext {
  method: string
  url: string
  host: string
  /** pathname（不含 query） */
  path: string
  /** 由 Sec-Fetch-Dest 推断（不支持时回退 Accept 启发） */
  resourceType: ResourceType
  /** 页面 URL（Referer / Origin） */
  pageUrl?: string
  /** 已缓冲的请求体（可能为 null：无体 / 无需缓冲） */
  requestBody?: Buffer | null
  requestContentType?: string
}

export interface RequestExecutionPlan {
  /** 拦截取消：不发请求、直接断开 */
  cancel: boolean
  /** 重定向目标（本地 30x 响应，不请求上游） */
  redirectedTo: string | null
  redirectStatusCode: number
  /** replace / queryParam 改写后的最终 URL（未改写时与原 URL 相同） */
  url: URL
  rewritten: boolean
  /** 延迟毫秒（多规则取最后一条，上限 RULE_DELAY_MAX_MS） */
  delayMs: number
  /** headers 类型规则的请求头操作（按序） */
  requestHeaders: HeaderOperation[]
  /** UA 覆盖（最后一条命中规则生效） */
  userAgent: string | null
  /** 请求体静态替换（最后一条命中规则生效，与 bodyScript 互斥） */
  bodyReplace: string | undefined
  /** 请求体动态改写 JS（最后一条命中规则生效；代理侧沙箱执行） */
  bodyScript: string | undefined
}

export function wildcardToRegex(pattern: string, withCaptures = false): RegExp {
  return sharedWildcardToRegex(pattern, withCaptures)
}

function compileRegex(pattern: string): RegExp | null {
  return compileSourceRegex(pattern)
}

/**
 * 规则的请求匹配：与处理名单共用 shared/interceptor.ts 的 matchSource
 * （key 选中比什么、operator 决定怎么比），两处语义必须一致。
 */
function matchesSource(source: RuleSource, ctx: RuleMatchContext): boolean {
  return matchSource(source, { url: ctx.url, host: ctx.host, path: ctx.path })
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** 请求体取值：JSON 顶层键 / GraphQL variables 键 / 表单参数（找不到返回 null） */
function extractPayloadValue(body: Buffer | null | undefined, contentType: string | undefined, key: string): string | null {
  if (!body?.length) return null
  const text = body.toString('utf8')
  const type = (contentType ?? '').toLowerCase()

  if (type.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>
        if (key in record) return stringifyValue(record[key])
        const variables = record.variables
        if (variables && typeof variables === 'object' && key in (variables as Record<string, unknown>)) {
          return stringifyValue((variables as Record<string, unknown>)[key])
        }
      }
    } catch {
      // 非 JSON：继续按表单 / 原文处理
    }
  }

  if (type.includes('form-urlencoded')) {
    const params = new URLSearchParams(text)
    if (params.has(key)) return params.get(key)
  }

  return null
}

function matchesFilters(rule: InterceptorRule, ctx: RuleMatchContext): boolean {
  const filters = rule.filters
  if (!filters) return true

  if (filters.requestMethod?.length) {
    const method = ctx.method.toUpperCase()
    if (!filters.requestMethod.some(item => item.toUpperCase() === method)) return false
  }

  if (filters.resourceType?.length && !filters.resourceType.includes(ctx.resourceType)) return false

  if (filters.pageUrl) {
    const page = ctx.pageUrl ?? ''
    if (!page.toLowerCase().includes(filters.pageUrl.toLowerCase())) return false
  }

  if (filters.requestPayload) {
    const { key, operator, value } = filters.requestPayload
    if (!key) return false
    const actual = extractPayloadValue(ctx.requestBody, ctx.requestContentType, key)
    if (actual === null) return false
    if (operator === 'equals' ? actual !== value : !actual.includes(value)) return false
  }

  return true
}

/** 单条规则的匹配（不看 enabled；弹窗要连禁用的规则一起列出） */
export function ruleMatches(rule: InterceptorRule, ctx: RuleMatchContext): boolean {
  return matchesSource(rule.source, ctx) && matchesFilters(rule, ctx)
}

// ---------------------------------------------------------------------------
// 域级适用性（弹窗按「当前页面的域」筛出可用规则，而不是拿单条流量去匹配）
// ---------------------------------------------------------------------------

/** 近似可注册域（不做完整 PSL：只覆盖常见的两段后缀） */
const TWO_LEVEL_SUFFIXES = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'])

export function registrableDomain(host: string): string {
  const parts = normalizeHost(host).split('.')
  if (parts.length <= 2) return parts.join('.')
  const second = parts[parts.length - 2] ?? ''
  if (TWO_LEVEL_SUFFIXES.has(second)) return parts.slice(-3).join('.')
  return parts.slice(-2).join('.')
}

/**
 * 规则里的「域」约束：
 * - host 键 → 值本身；
 * - url 键 → URL 模式的主机段（`*://www.a.com/x` → `www.a.com`；纯主机片段 `appmiu.com` 也算主机）；
 * - 其余（path 键 / 只有路径 / 值为空 / 无法解析）→ undefined，表示与域无关（对任何站点都可能生效）
 */
function sourceHostPattern(rule: InterceptorRule): string | undefined {
  const raw = (rule.source.value ?? '').trim()
  if (!raw) return undefined
  if (rule.source.key === 'host') return raw
  if (rule.source.key === 'url') {
    if (rule.source.operator === 'matches') return undefined
    const match = /^[a-z*]+:\/\/([^/?#]+)/i.exec(raw)
    if (match?.[1]) return match[1]
    // 没有协议头但看着像主机名（含点、无路径）
    if (!raw.includes('/') && /^[\w.*:-]+$/.test(raw) && raw.includes('.')) return raw
    return undefined
  }
  return undefined
}

/** 模式与站点是否算「同一域」：自身 / 子域 / 父域 / 同一个可注册域（含通配与包含语义） */
function hostMatchesPattern(pattern: string, host: string, operator: RuleSource['operator']): boolean {
  const value = pattern.replace(/:\d+$/, '').toLowerCase()
  if (!value || value === '*') return true
  if (operator === 'matches') return compileRegex(value)?.test(host) ?? false
  if (value.startsWith('*.')) {
    const base = value.slice(2)
    if (host === base || host.endsWith(`.${base}`)) return true
  }
  if (value.includes('*') || value.includes('?')) {
    if (wildcardToRegex(value).test(host)) return true
  }
  if (operator === 'contains') {
    // 「包含」是子串语义：值出现在 host 里即算同域（appmiu 也能吃 www.appmiu.com）
    if (host.includes(value)) return true
  }
  if (value === host) return true
  if (host.endsWith(`.${value}`) || value.endsWith(`.${host}`)) return true
  return registrableDomain(host) === registrableDomain(value)
}

/**
 * 该站点能否用上这条规则：
 * - `global`：规则不绑定具体域（path / 无主机段 / 值为空），任何站点都可能命中；
 * - `site`：规则的域约束与当前站点同域；
 * - `null`：用不上。
 * 注意这是「域级」判断，不看具体路径 / 方法 / 资源类型——那些属于流量级匹配。
 */
export function ruleAppliesToHost(rule: InterceptorRule, host: string): 'global' | 'site' | null {
  const normalized = normalizeHost(host)

  const pageFilter = (rule.filters?.pageUrl ?? '').trim().toLowerCase()
  if (pageFilter) {
    const domain = registrableDomain(normalized)
    if (!pageFilter.includes(normalized) && !pageFilter.includes(domain)) return null
  }

  const pattern = sourceHostPattern(rule)
  if (pattern === undefined) return 'global'
  // 纯通配（`*` / `*:*` / `*.` 这类通配独占）等于不约束域
  if (/^[\s*?:]*$/.test(pattern)) return 'global'
  return hostMatchesPattern(pattern, normalized, rule.source.operator) ? 'site' : null
}

/** 命中规则集合（请求/响应/mock 共用一次匹配，避免重复求值） */
export function findMatchingRules(rules: InterceptorRule[], ctx: RuleMatchContext): InterceptorRule[] {
  return rules.filter(rule => rule.enabled && ruleMatches(rule, ctx))
}

/** mock 短路：首个「不调服务器」的命中规则（type=response 且 mock） */
export function findMockRule(matchedRules: InterceptorRule[]): InterceptorRule | null {
  return matchedRules.find(rule => rule.type === 'response' && rule.response?.mock) ?? null
}

function applyQueryModifications(url: URL, modifications: QueryParamModification[]): void {
  for (const modification of modifications) {
    if (modification.action !== 'removeAll' && !modification.param) continue
    switch (modification.action) {
      case 'add':
        if (url.searchParams.has(modification.param)) {
          if ((modification.actionWhenParamExists ?? 'overwrite') === 'overwrite') {
            url.searchParams.set(modification.param, modification.value ?? '')
          }
        } else {
          url.searchParams.append(modification.param, modification.value ?? '')
        }
        break
      case 'remove':
        url.searchParams.delete(modification.param)
        break
      case 'removeAll':
        url.search = ''
        break
    }
  }
}

/** 计算重定向目标：支持正则 / 通配捕获组 `$1` 替换与查询串保留 */
function computeRedirectLocation(rule: InterceptorRule, ctx: { url: string, host: string, path: string }, currentUrl: URL): string | null {
  const config = rule.redirect
  if (!config?.destination) return null

  let location = config.destination
  if (/\$[1-9]/.test(location)) {
    const candidate = ctx[rule.source.key]
    let regex: RegExp | null = null
    if (rule.source.operator === 'matches') regex = compileRegex(rule.source.value)
    else if (rule.source.operator === 'wildcard') regex = wildcardToRegex(rule.source.value, true)
    const match = regex ? regex.exec(candidate) : null
    location = location.replace(/\$(\d)/g, (_full, digit: string) => match?.[Number(digit)] ?? '')
  }

  if (config.preserveQueryParams && currentUrl.search && !location.includes('?')) {
    location += currentUrl.search
  }

  if (!/^https?:\/\//i.test(location)) return null
  return location
}

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.min(Math.trunc(ms), 30_000)
}

/**
 * 请求执行计划（按规则顺序叠加）：
 * cancel / redirect 短路 URL 改写；其余动作照常收集（redirect 时仅延迟有意义）。
 */
export function planRequest(matchedRules: InterceptorRule[], currentUrl: URL): RequestExecutionPlan {
  let url = new URL(currentUrl.toString())
  let rewritten = false
  let cancel = false
  let redirectedTo: string | null = null
  let redirectStatusCode = 302
  let delayMs = 0
  const requestHeaders: HeaderOperation[] = []
  let userAgent: string | null = null
  let bodyReplace: string | undefined
  let bodyScript: string | undefined

  for (const rule of matchedRules) {
    const shapingBlocked = cancel || redirectedTo !== null

    switch (rule.type) {
      case 'cancel':
        cancel = true
        break
      case 'redirect':
        if (!shapingBlocked) {
          const config = rule.redirect
          if (config) {
            const location = computeRedirectLocation(rule, { url: url.toString(), host: url.hostname, path: url.pathname }, url)
            if (location) {
              redirectedTo = location
              redirectStatusCode = config.statusCode ?? 302
            }
          }
        }
        break
      case 'replace':
        if (!shapingBlocked && rule.replace?.from) {
          const next = url.toString().replace(rule.replace.from, rule.replace.to)
          try {
            url = new URL(next)
            rewritten = true
          } catch {
            // 替换结果非法：保持原 URL
          }
        }
        break
      case 'queryParam':
        if (!shapingBlocked && rule.queryParam?.modifications?.length) {
          applyQueryModifications(url, rule.queryParam.modifications)
          rewritten = true
        }
        break
      case 'delay':
        if (rule.delay) delayMs = clampDelay(rule.delay.delayMs)
        break
      case 'headers':
        if (rule.headers?.request?.length) requestHeaders.push(...rule.headers.request)
        break
      case 'userAgent':
        if (rule.userAgent?.userAgent) userAgent = rule.userAgent.userAgent
        break
      case 'request': {
        const config = rule.request
        if (!config) break
        if (config.type === 'code') {
          if (config.value) {
            bodyScript = config.value
            bodyReplace = undefined
          }
        } else {
          const value = config.value ?? config.bodyReplace
          if (value !== undefined) {
            bodyReplace = value
            bodyScript = undefined
          }
        }
        break
      }
      case 'response':
        break
      case 'script':
        // 动态脚本：浏览器侧注入执行（见 script-compile.ts），代理不做任何动作
        break
    }
  }

  if (cancel) redirectedTo = null
  return { cancel, redirectedTo, redirectStatusCode, url, rewritten, delayMs, requestHeaders, userAgent, bodyReplace, bodyScript }
}

export function findHeaderKey(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  return Object.keys(headers).find(key => key.toLowerCase() === lower)
}

export function setHeaderValue(headers: Record<string, string>, name: string, value: string): void {
  const key = findHeaderKey(headers, name)
  if (key) headers[key] = value
  else headers[name] = value
}

export function applyHeaderOperations(headers: Record<string, string>, operations: HeaderOperation[] | undefined): void {
  if (!operations?.length) return

  for (const operation of operations) {
    if (!operation.name) continue
    const existingKey = findHeaderKey(headers, operation.name)

    switch (operation.action) {
      case 'add':
        // add：同名头已存在则拼接（模拟多值头），否则新建
        if (existingKey) headers[existingKey] = `${headers[existingKey]}, ${operation.value ?? ''}`
        else headers[operation.name] = operation.value ?? ''
        break
      case 'remove':
        if (existingKey) delete headers[existingKey]
        break
      case 'override':
        if (existingKey) headers[existingKey] = operation.value ?? ''
        else headers[operation.name] = operation.value ?? ''
        break
    }
  }
}

export interface ResponseMutationResult {
  statusCode: number
  /** 自定义状态文案（未设置时 undefined，由调用方回退标准文案） */
  statusText: string | undefined
  headers: Record<string, string>
  body: Buffer | null
}

/** 响应侧变更：headers 类型规则的响应头操作 + response 类型规则的状态码 / 文案 / 改体 */
export function applyResponseMutations(
  matchedRules: InterceptorRule[],
  statusCode: number,
  headers: Record<string, string>,
  body: Buffer | null,
): ResponseMutationResult {
  let nextStatus = statusCode
  let nextStatusText: string | undefined
  let nextBody = body

  for (const rule of matchedRules) {
    if (rule.type === 'headers' && rule.headers?.response?.length) {
      applyHeaderOperations(headers, rule.headers.response)
    }
    if (rule.type !== 'response' || !rule.response) continue

    const config = rule.response
    if (config.statusCode !== undefined && Number.isFinite(config.statusCode)) nextStatus = config.statusCode
    if (config.statusText) nextStatusText = config.statusText
    if (config.bodyReplace !== undefined) {
      nextBody = Buffer.from(config.bodyReplace, 'utf8')
      const lengthKey = findHeaderKey(headers, 'content-length')
      if (lengthKey) headers[lengthKey] = String(nextBody.byteLength)
      const encodingKey = findHeaderKey(headers, 'content-encoding')
      // 替换后的正文不再具备原压缩编码；代理先解压再替换，此处清掉编码头
      if (encodingKey) delete headers[encodingKey]
    }
  }

  return { statusCode: nextStatus, statusText: nextStatusText, headers, body: nextBody }
}
