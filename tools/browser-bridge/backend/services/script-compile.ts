// 动态脚本规则 → InjectedScript 编译：把规则的 source 条件编译为
// ① 窄 chrome match pattern（注册范围）+ ② 代码外的运行时守卫（进页面前再校验一次
// location 匹配），扩展侧 chrome.userScripts 通道原样复用；source 留空 = 应用于所有页面。
import type { BridgeRule, InjectedScript, RuleSource } from '../../../../shared/browser-bridge.ts'
import { wildcardToRegex } from './rule-engine.ts'

const ALL_PAGES_MATCH = '*://*/*'

/** 形状合法的 chrome match pattern（scheme://…/…）才直接用作注册范围，否则退回全站 + 守卫 */
function asMatchPattern(value: string): string | null {
  const match = /^(?:\*|https?|file|ftp):\/\/(\S*)$/.exec(value)
  if (!match) return null
  return match[1].includes('/') ? value : null
}

function computeMatches(source: RuleSource): string[] {
  const value = source.value.trim()
  if (!value) return [ALL_PAGES_MATCH]
  if (source.operator === 'wildcard') {
    const pattern = asMatchPattern(value)
    if (pattern) return [pattern]
  }
  if (source.key === 'host' && source.operator === 'equals') return [`*://${value.toLowerCase()}/*`]
  return [ALL_PAGES_MATCH]
}

/** 生成守卫表达式（对页面 location 复刻 rule-engine 的 source 匹配语义）；留空返回 null（不守卫） */
function buildGuard(source: RuleSource): string | null {
  const value = source.value.trim()
  if (!value) return null
  const isHost = source.key === 'host'
  const target = source.key === 'url'
    ? 'location.href'
    : isHost ? 'location.hostname.toLowerCase()' : 'location.pathname'
  const literal = JSON.stringify(isHost ? value.toLowerCase() : value)
  switch (source.operator) {
    case 'equals':
      return `${target} === ${literal}`
    case 'contains':
      return `${target}.includes(${literal})`
    case 'matches':
      return `__edtMatch(${literal}, ${target})`
    case 'wildcard':
      return `__edtMatch(${JSON.stringify(wildcardToRegex(value).source)}, ${target})`
  }
}

function wrapWithGuard(source: RuleSource, code: string): string {
  const condition = buildGuard(source)
  if (!condition) return code
  const guard = [
    '(() => {',
    '  const __edtMatch = (pattern, target) => {',
    '    try {',
    '      return new RegExp(pattern).test(target)',
    '    } catch (e) {',
    '      return false',
    '    }',
    '  }',
    `  if (!(${condition})) return`,
  ]
  return [...guard, code, '})()'].join('\n')
}

/** 脚本规则（启用与禁用都下发，扩展按 enabled 过滤注册）→ 扩展用 InjectedScript 列表 */
export function compileScriptRules(rules: BridgeRule[]): InjectedScript[] {
  return rules
    .filter(rule => rule.type === 'script' && rule.script?.code.trim())
    .map((rule) => {
      const config = rule.script!
      return {
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        matches: computeMatches(rule.source),
        world: config.world,
        runAt: config.runAt,
        code: wrapWithGuard(rule.source, config.code),
        updatedAt: rule.updatedAt,
      }
    })
}
