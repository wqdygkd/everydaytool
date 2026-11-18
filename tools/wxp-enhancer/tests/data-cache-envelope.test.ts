/* eslint-disable test/no-import-node-test */
// data-cache.json 落盘信封：收藏明文、登录态密文，且能读回 v2（整份密文）/ v1（整份明文）
import type { WxpDataCache } from '../../../shared/wxp.ts'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { parseWxpCacheFile, serializeWxpCacheFile, WXP_DATA_CACHE_SCHEMA_VERSION } from '../../../shared/wxp-cache.ts'

const sealStub = (plain: string): string => `edt-secret:${Buffer.from(plain).toString('base64')}`
function openStub(sealed: string) {
  return {
    value: Buffer.from(sealed.slice('edt-secret:'.length), 'base64').toString(),
    failed: false,
  }
}
const openFailing = () => ({ value: '', failed: true })

const CACHE: WxpDataCache = {
  collectedAt: 1_700_000_000_000,
  login: {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessExpiresAt: 1,
    refreshExpiresAt: 2,
    username: 'tester',
    password: '',
    user: { code: 'tester' },
    nameNodeAddrs: '10.0.0.1:9000',
    statusQueryServers: '10.0.0.2:2401',
    snapshotExists: true,
  },
  favorites: [
    {
      sceneformal: '[正式]',
      simpleName: 'portal-A',
      accessPoint: 'localhost:9001',
      targetPoint: '10.0.0.1:80',
      hospital: '医院A',
      tenantId: 't1',
      code: 'c1',
    },
  ],
  favoritesUpdatedAt: 1_700_000_000_500,
}

test('收藏明文落盘，登录态独占密文段', () => {
  const file = serializeWxpCacheFile(CACHE, sealStub)
  assert.equal(file.schemaVersion, WXP_DATA_CACHE_SCHEMA_VERSION)
  assert.deepEqual(file.favorites, CACHE.favorites)
  assert.equal(file.favoritesUpdatedAt, CACHE.favoritesUpdatedAt)
  assert.ok(file.sealed?.startsWith('edt-secret:'))
  // 登录态不能出现在明文层
  assert.equal(file.login, undefined)
  assert.equal(file.collectedAt, undefined)
  assert.ok(!JSON.stringify(file.favorites).includes('access-token'))
})

test('v3 往返：收藏与登录态都能读回', () => {
  const file = serializeWxpCacheFile(CACHE, sealStub)
  const parsed = parseWxpCacheFile(JSON.parse(JSON.stringify(file)), openStub)
  assert.deepEqual(parsed, CACHE)
})

test('登录态解不开时收藏照旧返回（换机 / keychain 变化）', () => {
  const file = serializeWxpCacheFile(CACHE, sealStub)
  const parsed = parseWxpCacheFile(file, openFailing)
  assert.ok(parsed)
  assert.deepEqual(parsed.favorites, CACHE.favorites)
  assert.equal(parsed.favoritesUpdatedAt, CACHE.favoritesUpdatedAt)
  assert.equal(parsed.login.accessToken, '')
})

test('读得回 v2（整份密文）：下次写入自动升级', () => {
  const legacy = { schemaVersion: 2, sealed: sealStub(JSON.stringify(CACHE)) }
  const parsed = parseWxpCacheFile(legacy, openStub)
  assert.deepEqual(parsed, CACHE)
  assert.deepEqual(serializeWxpCacheFile(parsed as WxpDataCache, sealStub).favorites, CACHE.favorites)
})

test('读得回 v1（整份明文）', () => {
  const parsed = parseWxpCacheFile(CACHE, openStub)
  assert.deepEqual(parsed, CACHE)
})

test('safeStorage 不可用（seal 不加密）时登录态按明文同层写出并读回', () => {
  const file = serializeWxpCacheFile(CACHE, plain => plain)
  assert.equal(file.sealed, undefined)
  assert.equal(file.login?.username, 'tester')
  assert.deepEqual(parseWxpCacheFile(file, openStub), CACHE)
})
