import type { RuleType } from '../../shared/interceptor'
import { describe, expect, it } from 'vitest'
import { RULE_TYPE_LABELS } from '../../shared/interceptor'
import {
  INTERCEPTOR_TABS,
  INTERCEPTOR_TOOL_ROOT,
  ruleTypeFromPath,
  ruleTypeRouteName,
  tabKeyFromPath,
} from './tabs'

describe('interceptor 页签映射', () => {
  it('key / 路由名唯一，首项为 status（主路由重定向目标）', () => {
    const keys = INTERCEPTOR_TABS.map(tab => tab.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(INTERCEPTOR_TABS.map(tab => tab.routeName)).size).toBe(keys.length)
    expect(INTERCEPTOR_TABS[0]?.key).toBe('status')
  })
})

describe('tabKeyFromPath', () => {
  it('从路径解析当前视图；非法 / 缺失回落 status', () => {
    expect(tabKeyFromPath(INTERCEPTOR_TOOL_ROOT)).toBe('status')
    expect(tabKeyFromPath(`${INTERCEPTOR_TOOL_ROOT}/traffic`)).toBe('traffic')
    expect(tabKeyFromPath(`${INTERCEPTOR_TOOL_ROOT}/rules/token`)).toBe('rules')
    expect(tabKeyFromPath('/tools/other')).toBe('status')
    expect(tabKeyFromPath(`${INTERCEPTOR_TOOL_ROOT}/not-a-tab`)).toBe('status')
  })
})

describe('ruleTypeFromPath / ruleTypeRouteName', () => {
  const ruleTypes = Object.keys(RULE_TYPE_LABELS) as RuleType[]

  it('仅 /rules/<type> 命中，且 type 必须在 RULE_TYPE_LABELS 内', () => {
    expect(ruleTypeFromPath(`${INTERCEPTOR_TOOL_ROOT}/rules/${ruleTypes[0]}`)).toBe(ruleTypes[0])
    expect(ruleTypeFromPath(`${INTERCEPTOR_TOOL_ROOT}/rules/not-a-type`)).toBeNull()
    expect(ruleTypeFromPath(`${INTERCEPTOR_TOOL_ROOT}/status`)).toBeNull()
  })

  it('路由名生成与路径解析互逆', () => {
    for (const type of ruleTypes) {
      const path = `${INTERCEPTOR_TOOL_ROOT}/rules/${type}`
      expect(ruleTypeFromPath(path)).toBe(type)
      expect(ruleTypeRouteName(type)).toBe(`tool-interceptor-rules-${type}`)
    }
  })
})
