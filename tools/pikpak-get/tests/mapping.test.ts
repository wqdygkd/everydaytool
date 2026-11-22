/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import type { PikpakParseRaw, PikpakWhoamiRaw } from '../backend/engine/mapping.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapAccount, mapLink, mapNode, mapParseResult, mapTask, mapWhoami, toEngineTaskInput } from '../backend/engine/mapping.ts'

// 这些用例锁死「引擎 snake_case → shared camelCase」的映射契约。
// 背景：NAS 模式下主进程拿到的是引擎 JSON，漏映射会让渲染层读到 undefined
// （典型症状：parse.linkId 缺失 → IPC 的 requireId 报「ID 非法」）。

const NAS_PARSE: PikpakParseRaw = {
  link_id: 'abc123def4567890',
  title: '分享标题',
  file_num: 2,
  truncated: false,
  parsed_at: '2026-11-22T00:00:00.000Z',
  nodes: [
    { id: 'n1', name: 'movie.mkv', path: '/movie.mkv', parent_id: '', is_folder: false, size: 1024, hash: null, mime: 'video/x-matroska', downloaded: true, exists: true },
    { id: 'f1', name: 'subs', path: '/subs', parent_id: '', is_folder: true, size: 0, hash: null, mime: '', child_count: 1 },
  ] as never,
}

test('mapParseResult 带回 linkId 与 camelCase 节点', () => {
  const result = mapParseResult(NAS_PARSE)
  assert.equal(result.linkId, 'abc123def4567890')
  assert.equal(result.title, '分享标题')
  assert.equal(result.fileNum, 2)
  assert.equal(result.truncated, false)
  assert.equal(result.parsedAt, '2026-11-22T00:00:00.000Z')
  assert.equal(result.nodes.length, 2)
  assert.deepEqual(result.nodes[0], {
    id: 'n1',
    name: 'movie.mkv',
    path: '/movie.mkv',
    parentId: '',
    isFolder: false,
    size: 1024,
    hash: null,
    mime: 'video/x-matroska',
    childCount: null,
    downloaded: true,
    exists: true,
  })
  assert.equal(result.nodes[1]!.isFolder, true)
  assert.equal(result.nodes[1]!.childCount, 1)
  // 未标记下载的文件夹默认 false，渲染层按「未下载」处理
  assert.equal(result.nodes[1]!.downloaded, false)
  assert.equal(result.nodes[1]!.exists, false)
})

test('mapParseResult 对缺失字段兜底，不产生 undefined 节点', () => {
  const result = mapParseResult({})
  assert.equal(result.linkId, '')
  assert.equal(result.title, '')
  assert.equal(result.fileNum, null)
  assert.equal(result.parsedAt, null)
  assert.deepEqual(result.nodes, [])
})

test('mapLink 把 share_id / pass_code / parsed_at 映射到 camelCase', () => {
  const link = mapLink({
    id: 'abc123def4567890',
    url: 'https://mypikpak.com/s/xyz',
    title: '示例',
    folder: '未分组',
    share_id: 'xyz',
    pass_code: 'p1',
    root_id: '',
    created_at: '2026-11-20T00:00:00.000Z',
    updated_at: '2026-11-21T00:00:00.000Z',
    parsed_at: '2026-11-22T00:00:00.000Z',
    parse_cache: null,
  })
  assert.equal(link.shareId, 'xyz')
  assert.equal(link.passCode, 'p1')
  assert.equal(link.parsedAt, '2026-11-22T00:00:00.000Z')
  assert.equal('parse_cache' in link, false)
})

test('mapTask 把文件表的 node_id 映射到 nodeId', () => {
  const task = mapTask({
    id: 'task-1',
    link_id: 'abc123def4567890',
    file_ids: ['n1'],
    dest: '/downloads',
    account_id: 'acc-1',
    status: 'running',
    current_file: 'n1',
    files: { n1: { node_id: 'n1', name: 'movie.mkv', size: 1024, downloaded: 512, speed: 64, eta: 8 } },
    logs: [],
    error: null,
    created_at: '2026-11-22T00:00:00.000Z',
    updated_at: '2026-11-22T00:00:00.000Z',
    planned_files: 3,
    planned_bytes: 4096,
  })
  assert.equal(task.linkId, 'abc123def4567890')
  assert.equal(task.currentFile, 'n1')
  assert.equal(task.plannedFiles, 3)
  assert.equal(task.plannedBytes, 4096)
  assert.deepEqual(task.files.n1, { nodeId: 'n1', name: 'movie.mkv', size: 1024, downloaded: 512, speed: 64, eta: 8 })
})

test('mapTask 对旧引擎缺失的计划字段兜底（文件数退回 file_ids 长度）', () => {
  const task = mapTask({
    id: 'task-3',
    link_id: 'abc',
    file_ids: ['n1', 'n2'],
    dest: '/downloads',
    account_id: null,
    status: 'queued',
    current_file: null,
    files: {},
    logs: [],
    error: null,
    created_at: '',
    updated_at: '',
  } as never)
  assert.equal(task.plannedFiles, 2)
  assert.equal(task.plannedBytes, 0)
})

test('mapTask 速度 / ETA 缺省为 0', () => {
  const task = mapTask({
    id: 'task-2',
    link_id: 'abc',
    file_ids: null,
    dest: '/downloads',
    account_id: null,
    status: 'queued',
    current_file: null,
    files: { n1: { node_id: 'n1', name: 'a.mkv', size: 1, downloaded: 0 } as never },
    logs: [],
    error: null,
    created_at: '',
    updated_at: '',
  })
  assert.equal(task.files.n1!.speed, 0)
  assert.equal(task.files.n1!.eta, 0)
})

test('mapWhoami 把 in_trash / expires_at 映射到 camelCase', () => {
  const raw: PikpakWhoamiRaw = { usage: 10, limit: 100, in_trash: 2, free: 88, expires_at: '2027-01-01' }
  assert.deepEqual(mapWhoami(raw), { usage: 10, limit: 100, inTrash: 2, free: 88, expiresAt: '2027-01-01' })
})

test('mapAccount 把流量字段映射到 camelCase', () => {
  const account = mapAccount({
    id: 'acc-1',
    label: 'user@example.com',
    traffic_capped_at: 1000,
    created_at: '2026-11-20T00:00:00.000Z',
    updated_at: '2026-11-21T00:00:00.000Z',
    traffic: { capped_at: 1000, retry_at: 4600, remaining: 3600 },
  })
  assert.equal(account.trafficCappedAt, 1000)
  assert.deepEqual(account.traffic, { cappedAt: 1000, retryAt: 4600, remaining: 3600 })
})

test('mapNode 保留 childCount 缺省 null', () => {
  const node = mapNode({ id: 'f1', name: 'subs', path: '/subs', parent_id: '', is_folder: true, size: 0, hash: null, mime: '' })
  assert.equal(node.childCount, null)
  assert.equal(node.isFolder, true)
})

test('toEngineTaskInput 把 camelCase 请求体转成引擎读的 snake_case', () => {
  const body = toEngineTaskInput({ linkId: 'abc123', fileIds: ['n1', 'n2'], dest: '/downloads', accountId: 'acc-1' })
  assert.deepEqual(body, { link_id: 'abc123', file_ids: ['n1', 'n2'], dest: '/downloads', account_id: 'acc-1' })
})

test('toEngineTaskInput 缺省字段发 null，空选文件等价于不筛选', () => {
  assert.deepEqual(toEngineTaskInput({ linkId: 'abc123' }), { link_id: 'abc123', file_ids: null, dest: null, account_id: null })
  assert.deepEqual(toEngineTaskInput({ linkId: 'abc123', fileIds: [] }).file_ids, null)
})

test('toEngineTaskInput 拷贝文件数组，不与调用方共享引用', () => {
  const fileIds = ['n1']
  const body = toEngineTaskInput({ linkId: 'abc123', fileIds })
  fileIds.push('n2')
  assert.deepEqual(body.file_ids, ['n1'])
})
