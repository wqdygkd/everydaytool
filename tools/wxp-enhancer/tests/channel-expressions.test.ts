/* eslint-disable test/no-import-node-test */
// 通道注入表达式：文本级约束（禁反斜杠）+ 行为档（mock Vuex / fetch 跑真实序列化表达式）。
// 覆盖「工具建通道（绑定租户 → 生成 → 轮询端口 → 还原租户）」与
// 「WXP 侧建/关通道后工具读到的端口状态」两条链路。
import type { WxpChannelLink, WxpChannelTogglePayload } from '../../../shared/wxp.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { buildChannelSnapshotExpression, buildChannelToggleExpression } from '../backend/services/channel-collector.ts'

interface DispatchCall {
  type: string
  payload?: unknown
}

interface MockStore {
  getters: Record<string, any>
  dispatch: (type: string, payload?: unknown) => Promise<unknown>
  ports: number[]
  calls: DispatchCall[]
}

function makeStore(options: { ports?: number[], currentCode?: string } = {}): MockStore {
  const calls: DispatchCall[] = []
  const state = {
    ports: options.ports ?? [],
    calls,
    getters: {
      baseURL: 'http://wxp.local/',
      user: { code: 'tester', id_user: '7' },
      tenants: [
        { code: 'C1', name: '医院一', branchid: 'B1' },
        { code: 'C2', name: '医院二', branchid: 'B2' },
      ],
      currentTenant: { code: options.currentCode ?? 'C1', name: '医院一' },
    },
  }
  const dispatch = async (type: string, payload?: unknown): Promise<unknown> => {
    calls.push({ type, payload })
    if (type === 'app/ProxyServerAllEnabledPorts') return [...state.ports]
    if (type === 'app/GenerateProxyServerSync') {
      const suite = (payload as { suite: { middle_port: number } }).suite
      if (!state.ports.includes(suite.middle_port)) state.ports.push(suite.middle_port)
      return undefined
    }
    if (type === 'app/CloseProxyServer') {
      const port = (payload as { port: number }).port
      state.ports = state.ports.filter(item => item !== port)
      return true
    }
    return undefined
  }
  return Object.assign(state, { dispatch })
}

function makeContext(store: MockStore, links: unknown[] = []) {
  const fetchCalls: string[] = []
  const fetchImpl = async (url: string) => {
    fetchCalls.push(url)
    return { json: async () => ({ data: links }) }
  }
  const context = createContext({
    document: { getElementById: () => ({ __vue__: { $store: { getters: store.getters, dispatch: store.dispatch } } }) },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    console,
  })
  return { context, fetchCalls }
}

/** vm 里创建的数组 / 对象原型来自另一个 realm，deepStrictEqual 会判不等：先转成当前 realm 的纯数据 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const RAW_LINKS = [
  {
    id: 11,
    name: 'portal-A(转发1)',
    sceneformal: true,
    middle_ip: 'localhost',
    middle_port: 9001,
    middle_realip: '10.0.0.1',
    middle_realport: 80,
    browsetype: 'middlebrowse',
    opera_port: 9101,
    protocol: 'https',
    url_suffix: 'portal',
  },
  {
    id: 12,
    name: 'browser-B(转发2)',
    sceneformal: false,
    middle_ip: '10.0.0.9',
    middle_port: 9002,
    middle_realip: '10.0.0.2',
    middle_realport: 8080,
    browsetype: 'deliverbrowse',
    opera_port: 9102,
    protocol: 'http',
    url_suffix: '',
  },
]

const LINK: WxpChannelLink = {
  id: '11',
  name: 'portal-A(转发1)',
  simpleName: 'portal-A',
  sceneformal: '[正式]',
  accessPoint: 'localhost:9001',
  targetPoint: '10.0.0.1:80',
  localIp: 'localhost',
  localPort: 9001,
  relIp: '10.0.0.1',
  relPort: 80,
  browsetype: 'middlebrowse',
  operaPort: 9101,
  protocol: 'https',
  urlSuffix: 'portal',
  canOpen: true,
  online: false,
}

const PAYLOAD: WxpChannelTogglePayload = { hospitalCode: 'C1', link: LINK }

test('表达式不含反斜杠且可编译（模板字符串注入约束）', () => {
  const sources = [
    buildChannelSnapshotExpression('', true),
    buildChannelSnapshotExpression('C1', false),
    buildChannelToggleExpression(PAYLOAD, 'open'),
    buildChannelToggleExpression(PAYLOAD, 'close'),
  ]
  for (const source of sources) {
    assert.ok(!source.includes('\\'), '表达式里出现反斜杠会被模板字符串吞掉')
    // eslint-disable-next-line no-new-func -- 注入产物只能这样校验可编译性
    assert.doesNotThrow(() => new Function(source))
  }
})

test('快照：医院 / 当前医院 / 转发行映射 / 端口即状态', async () => {
  const store = makeStore({ ports: [9001] })
  const { context, fetchCalls } = makeContext(store, RAW_LINKS)
  const result = await runInContext(buildChannelSnapshotExpression('', true), context)

  assert.equal(result.hospitalCode, 'C1')
  assert.equal(result.currentCode, 'C1')
  assert.deepEqual(plain(result.hospitals), [
    { code: 'C1', name: '医院一', branchid: 'B1' },
    { code: 'C2', name: '医院二', branchid: 'B2' },
  ])
  assert.deepEqual(result.onlinePorts, [9001])
  assert.equal(fetchCalls.length, 1)
  assert.ok(fetchCalls[0].includes('suit/getByUserAndBranch'))
  assert.ok(fetchCalls[0].includes('usercode=tester'))
  assert.ok(fetchCalls[0].includes('idBranch=B1'))

  const [formal, remote] = result.links
  assert.equal(formal.simpleName, 'portal-A')
  assert.equal(formal.protocol, 'https')
  assert.equal(formal.online, true)
  assert.equal(formal.canOpen, true)
  assert.equal(remote.online, false)
  assert.equal(remote.canOpen, false)
  assert.equal(remote.sceneformal, '[非正式]')
})

test('快照：指定医院时不拉列表（轮询省流量）', async () => {
  const store = makeStore({ ports: [] })
  const { context, fetchCalls } = makeContext(store, RAW_LINKS)
  const result = await runInContext(buildChannelSnapshotExpression('C2', false), context)

  assert.equal(result.hospitalCode, 'C2')
  assert.deepEqual(plain(result.links), [])
  assert.equal(fetchCalls.length, 0)
})

test('建立通道：先绑定租户 → 生成 → 轮询到端口 → 还原租户', async () => {
  const store = makeStore({ ports: [], currentCode: 'C2' })
  const { context } = makeContext(store)
  const result = await runInContext(buildChannelToggleExpression(PAYLOAD, 'open'), context)

  assert.equal(result.ok, true)
  assert.equal(result.already, false)
  assert.deepEqual(result.ports, [9001])
  const types = store.calls.map(call => call.type)
  assert.deepEqual(types, [
    'app/ProxyServerAllEnabledPorts',
    'app/BindCurrentProxyTenant',
    'app/GenerateProxyServerSync',
    'app/ProxyServerAllEnabledPorts',
    'app/BindCurrentProxyTenant',
  ])
  assert.equal(store.calls[1].payload, 'C1')
  const suite = (store.calls[2].payload as any).suite
  assert.equal(suite.middle_port, 9001)
  assert.equal(suite.middle_realip, '10.0.0.1')
  assert.equal((store.calls[2].payload as any).tenant.code, 'C1')
  // 收尾还原成 WXP 当前医院（C2），避免打断用户在 WXP 上继续建通道
  assert.equal(store.calls[4].payload, 'C2')
})

test('关闭通道：调用 CloseProxyServer 并等端口消失', async () => {
  const store = makeStore({ ports: [9001] })
  const { context } = makeContext(store)
  const result = await runInContext(buildChannelToggleExpression({ ...PAYLOAD, link: { ...LINK, online: true } }, 'close'), context)

  assert.equal(result.ok, true)
  assert.deepEqual(result.ports, [])
  assert.ok(store.calls.some(call => call.type === 'app/CloseProxyServer'))
})

test('端口已是目标状态：直接返回 already，不发建立 / 关闭', async () => {
  const onlineStore = makeStore({ ports: [9001] })
  const { context } = makeContext(onlineStore)
  const opened = await runInContext(buildChannelToggleExpression(PAYLOAD, 'open'), context)
  assert.equal(opened.already, true)
  assert.equal(opened.ok, true)
  assert.ok(!onlineStore.calls.some(call => call.type === 'app/GenerateProxyServerSync'))

  const offlineStore = makeStore({ ports: [] })
  const offline = await runInContext(
    buildChannelToggleExpression({ ...PAYLOAD, link: { ...LINK, online: false } }, 'close'),
    makeContext(offlineStore).context,
  )
  assert.equal(offline.already, true)
  assert.ok(!offlineStore.calls.some(call => call.type === 'app/CloseProxyServer'))
})

test('参数注入防护：引号 / 反斜杠不允许拼进表达式', () => {
  assert.throws(() => buildChannelSnapshotExpression('C1"', true), /非法字符/)
  assert.throws(() => buildChannelToggleExpression({ ...PAYLOAD, hospitalCode: 'C\\1' }, 'open'), /非法字符/)
})
