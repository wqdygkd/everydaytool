/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner */
import type { InterceptorRule } from '../../../shared/interceptor.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ruleMayMatchWithoutBody, ruleNeedsRequestBody } from '../backend/services/rule-engine.ts'
import { normalizeRuleFilters, normalizeRuleSource, sanitizeStoredRule } from '../backend/store/rule-validation.ts'

function rule(overrides: Partial<InterceptorRule> = {}): InterceptorRule {
  return {
    id: 'rule-1',
    name: 'demo',
    enabled: true,
    type: 'redirect',
    source: { key: 'url', operator: 'contains', value: '/api' },
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

test('请求体预筛：忽略 payload 过滤，但保留方法 / 资源类型约束', () => {
  const ctx = {
    method: 'POST',
    url: 'https://api.example.com/api/login',
    host: 'api.example.com',
    path: '/api/login',
    resourceType: 'xmlhttprequest' as const,
    pageUrl: 'https://app.example.com',
    requestBody: null,
  }
  const payloadRule = rule({ filters: { requestPayload: { key: 'token', operator: 'equals', value: 'x' } } })
  assert.equal(ruleMayMatchWithoutBody(payloadRule, ctx), true)
  assert.equal(ruleNeedsRequestBody(payloadRule), true)

  const wrongMethod = rule({ filters: { requestMethod: ['GET'], requestPayload: { key: 'token', operator: 'equals', value: 'x' } } })
  assert.equal(ruleMayMatchWithoutBody(wrongMethod, ctx), false)
  assert.equal(ruleNeedsRequestBody(wrongMethod), true)

  const redirectRule = rule()
  assert.equal(ruleNeedsRequestBody(redirectRule), false)
})

test('规则来源校验：key / operator 枚举与 value 非空', () => {
  assert.deepEqual(normalizeRuleSource({ key: 'host', operator: 'equals', value: 'a.com' }), {
    key: 'host',
    operator: 'equals',
    value: 'a.com',
  })
  assert.equal(normalizeRuleSource({ key: 'body', operator: 'equals', value: 'x' }), null)
  assert.equal(normalizeRuleSource({ key: 'url', operator: 'startsWith', value: 'x' }), null)
  assert.equal(normalizeRuleSource({ key: 'url', operator: 'contains', value: '   ' }), null)
  assert.equal(normalizeRuleSource(undefined), null)
})

test('过滤器校验：payload / resourceType 非法时拒绝整条规则', () => {
  assert.deepEqual(normalizeRuleFilters({ requestMethod: ['POST'], resourceType: ['xmlhttprequest'] }), {
    requestMethod: ['POST'],
    resourceType: ['xmlhttprequest'],
  })
  assert.equal(normalizeRuleFilters({ requestPayload: { key: '', operator: 'equals', value: '' } }), null)
  assert.equal(normalizeRuleFilters({ requestPayload: { key: 'a', operator: 'regex', value: 'x' } }), null)
  assert.equal(normalizeRuleFilters({ resourceType: ['not-a-type'] }), null)

  assert.ok(sanitizeStoredRule(rule()))
  assert.equal(sanitizeStoredRule({ ...rule(), source: { key: 'bad' } }), null)
  assert.equal(sanitizeStoredRule({ ...rule(), type: 'unknown' }), null)
})
