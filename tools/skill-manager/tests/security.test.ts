/* eslint-disable test/no-import-node-test -- Node 内置 test runner，避免新增依赖 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGlobalLock } from '../backend/locks/global-lock.ts'
import { parseProjectLock } from '../backend/locks/project-lock.ts'
import { parseSourceInput } from '../backend/sources/parse.ts'

test('来源解析拒绝以 - 开头的来源与 ref', () => {
  assert.throws(() => parseSourceInput('--upload-pack=evil'), /来源不能以 - 开头/)
  assert.throws(() => parseSourceInput('acme/skills#-x'), /不能以 - 开头/)
  assert.throws(() => parseSourceInput('acme/skills', '-x'), /不能以 - 开头/)
})

test('git 来源只接受白名单协议', () => {
  assert.throws(() => parseSourceInput('ftp://example.com/repo.git'), /不支持的 git 协议/)
  assert.throws(() => parseSourceInput('ext::sh -c whoami'), /无法识别来源|不支持的 git 协议/)
  const ok = parseSourceInput('https://github.com/acme/repo')
  assert.equal(ok.source, 'acme/repo')
})

test('锁文件键名不合法时整份拒绝', () => {
  const project = parseProjectLock(JSON.stringify({
    version: 1,
    skills: {
      '../escape': { source: 'o/r', sourceType: 'github', computedHash: 'h' },
    },
  }))
  assert.equal(project.ok, false)
  if (!project.ok) assert.match(project.message, /技能名不合法/)

  const global = parseGlobalLock(JSON.stringify({
    version: 3,
    skills: {
      'a/b': { source: 'o/r', sourceType: 'github', skillFolderHash: 'h' },
    },
  }))
  assert.equal(global.ok, false)
  if (!global.ok) assert.match(global.message, /技能名不合法/)
})
