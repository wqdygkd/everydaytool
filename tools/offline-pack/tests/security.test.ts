/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAllowedMsStoreDownloadUrl,
  isValidVsCodePackageId,
  isValidVsCodeVersion,
} from '../../../shared/offline-pack.ts'

test('Microsoft Store 下载只允许微软域名', () => {
  assert.equal(isAllowedMsStoreDownloadUrl('https://software-static.download.prss.microsoft.com/a.appx'), true)
  assert.equal(isAllowedMsStoreDownloadUrl('https://evil.example/a.appx'), false)
  assert.equal(isAllowedMsStoreDownloadUrl('file:///etc/passwd'), false)
})

test('VSCode 包标识与版本号校验', () => {
  assert.equal(isValidVsCodePackageId('ms-python'), true)
  assert.equal(isValidVsCodePackageId('../evil'), false)
  assert.equal(isValidVsCodeVersion('2024.1.0'), true)
  assert.equal(isValidVsCodeVersion('1/../../x'), false)
})
