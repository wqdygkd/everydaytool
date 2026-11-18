/* eslint-disable test/no-import-node-test */
// 注入脚本的行为档测试：在 mock DOM 世界里跑真实序列化产物（buildInjectionSource），
// 守住「收藏匹配 / 星标 / 置顶 / 医院域名 URL」这条链路。
// 背景：WXP 3.1.28 起接口 `middle_ip` 返回 `localhost`（旧版是 `127.0.0.1`）。
// 若按字面比较接入点，收藏会全部匹配不上——表现为星标不亮、收藏不置顶、
// 收藏页「打开 / 复制」提示「该医院的转发列表里没有这条收藏」、打开后医院域名前缀消失。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { buildInjectionSource } from '../backend/services/injection-source.ts'

interface FakeNode {
  tagName: string
  id: string
  className: string
  title: string
  innerHTML: string
  style: Record<string, string>
  children: FakeNode[]
  parentNode: FakeNode | null
  _text: string
  textContent: string
  innerText: string
  classList: { contains: (name: string) => boolean }
  appendChild: (child: FakeNode) => FakeNode
  removeChild: (child: FakeNode) => FakeNode
  addEventListener: () => void
  removeEventListener: () => void
  matches: (selector: string) => boolean
  closest: (selector: string) => FakeNode | null
  querySelector: (selector: string) => FakeNode | null
  querySelectorAll: () => FakeNode[]
  findAll: (predicate: (child: FakeNode) => boolean) => FakeNode[]
}

interface LinkRecord {
  type: number
  sceneformal: string
  simpleName: string
  accessPoint: string
  targetPoint: string
  url: string
  localPort: string
  proxyState: string
}

interface Favorite {
  sceneformal: string
  simpleName: string
  accessPoint: string
  targetPoint: string
  hospital: string
  tenantId: string
  code: string
}

/** 极简 DOM 节点：只实现注入脚本用到的 API */
function makeNode(tag: string): FakeNode {
  const node = {
    tagName: tag,
    id: '',
    className: '',
    title: '',
    innerHTML: '',
    style: {},
    children: [] as FakeNode[],
    parentNode: null as FakeNode | null,
    _text: '',
    classList: {
      contains: (name: string): boolean => String(node.className).split(/\s+/).includes(name),
    },
    appendChild(child: FakeNode) {
      child.parentNode = node
      node.children.push(child)
      return child
    },
    removeChild(child: FakeNode) {
      node.children = node.children.filter(item => item !== child)
      return child
    },
    addEventListener() {},
    removeEventListener() {},
    matches(selector: string): boolean {
      return selector.split(',').some((raw) => {
        const part = raw.trim()
        return part.startsWith('.')
          ? (` ${node.className} `).includes(` ${part.slice(1)} `)
          : node.tagName === part
      })
    },
    closest(selector: string): FakeNode | null {
      let current: FakeNode | null = node
      while (current) {
        if (current.matches(selector)) return current
        current = current.parentNode
      }
      return null
    },
    querySelector(selector: string): FakeNode | null {
      if (selector === 'div') return node.children.find(child => child.tagName === 'div') ?? null
      if (selector === '.cell') return node.children.find(child => child.className === 'cell') ?? null
      if (selector === '.wxp-fav-star') return node.findAll(child => child.className.includes('wxp-fav-star'))[0] ?? null
      if (selector === '.wxp-open-btn') return node.findAll(child => child.className.includes('wxp-open-btn'))[0] ?? null
      const column = selector.match(/column_(\d+)/)
      if (column) return node.children.find(child => child.className.includes(`column_${column[1]}`)) ?? null
      return null
    },
    querySelectorAll(): FakeNode[] {
      return []
    },
    findAll(predicate: (child: FakeNode) => boolean): FakeNode[] {
      const found: FakeNode[] = []
      const walk = (current: FakeNode): void => {
        for (const child of current.children) {
          if (predicate(child)) found.push(child)
          walk(child)
        }
      }
      walk(node)
      return found
    },
  } as FakeNode
  Object.defineProperty(node, 'textContent', {
    get: () => node._text + node.children.map(child => child.textContent).join(''),
    set: (value: string) => {
      node._text = String(value)
      node.children = []
    },
  })
  Object.defineProperty(node, 'innerText', { get: () => node.textContent })
  return node
}

/** 链接中心表格行：td[0..6] = 序号 / 环境 / 状态 / 转发名称 / 接入点 / 原地址 / 快捷操作 */
function makeRow(link: LinkRecord, index: number): FakeNode {
  const row = makeNode('tr')
  const texts = [String(index + 1), link.sceneformal, link.proxyState, link.simpleName, link.accessPoint, link.targetPoint, '']
  texts.forEach((text, cell) => {
    const td = makeNode('td')
    td.className = `w-table_1_column_${cell + 1}   w-table__cell`
    const holder = makeNode('div')
    holder._text = text
    if (cell === 3) {
      const wrapper = makeNode('div')
      wrapper.className = 'cell'
      wrapper.appendChild(holder)
      td.appendChild(wrapper)
    }
    else {
      td.appendChild(holder)
    }
    row.appendChild(td)
  })
  return row
}

function makeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

interface World {
  linkCenter: {
    hospitalLinks: Array<LinkRecord & { isFav?: boolean }>
    opened: string[]
    copied: string[]
  }
  rows: FakeNode[]
  components: Record<string, { options: { render: (h: unknown) => unknown } }>
  favorites: () => Array<Favorite & { isFav?: boolean }>
  /** 卸载注入脚本注册的定时器 / 观察者，否则 node:test 进程会被常驻 interval 挂住 */
  teardown: () => void
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** 组装「链接中心已选中一家医院」的最小世界，跑一遍真实注入脚本 */
function runInjection(links: LinkRecord[], favorites: Favorite[]): World {
  const localStorage = makeStorage()
  const sessionStorage = makeStorage()
  localStorage.setItem('__wxpEnhancerLinkFavorites', JSON.stringify(favorites))

  const rows = links.map((link, index) => makeRow(link, index))
  const container = makeNode('div')
  container.className = 'link-view-container'
  container.querySelectorAll = () => rows

  const opened: string[] = []
  const copied: string[] = []
  const linkCenter = {
    $options: { name: 'LinkCenter' },
    hospital: { id: 't1', code: 'c1', name: '医院A' },
    hospitalLinks: links.map(link => ({ ...link })),
    loading: false,
    selectedHospital() {},
    openChannel: () => true,
    AppShellOpen: (arg: { path: string }) => { opened.push(arg.path) },
    AddVisitedView: (arg: { path: string }) => { opened.push(arg.path) },
    $copyText: (text: string) => {
      copied.push(text)
      return Promise.resolve(text)
    },
    tableRowClassName: () => 'table-even-row',
    getCurrentHospitalLinks: () => Promise.resolve(),
  }
  const appMain = { $options: { name: 'AppMain', components: {} }, $forceUpdate() {} }
  const components: World['components'] = {}
  // 脚本按 Vue.component(name, options) 注册收藏页组件，并读 constructor.options.wxpRev 判断是否要重装
  const Vue = {
    options: { components },
    component(name: string, options: World['components'][string]['options']) { components[name] = { options } },
  }
  const view = { id: '4', title: '链接中心', component: 'LinkCenter', elementHeight: 618 }
  const store = {
    state: { menuView: { visitedViews: [view], activeView: view } },
    getters: {
      tenants: [{ id: 't1', code: 'c1', name: '医院A' }],
      user: { code: 'u1', id_user: 'u1' },
      baseURL: 'https://base',
    },
    commit() {},
    dispatch: () => Promise.resolve(),
  }
  const appEl = makeNode('div')
  appEl.id = 'app'
  Object.assign(appEl, { __vue__: { $store: store, $children: [appMain, linkCenter], constructor: Vue } })

  const document = {
    head: makeNode('head'),
    documentElement: makeNode('head'),
    body: makeNode('body'),
    getElementById: (id: string) => (id === 'app' ? appEl : null),
    querySelector: (selector: string) => (selector === '.link-view-container' ? container : null),
    createElement: (tag: string) => makeNode(tag),
    addEventListener() {},
    removeEventListener() {},
    execCommand: () => true,
  }
  const sandbox = {
    window: { addEventListener() {}, removeEventListener() {} },
    document,
    localStorage,
    sessionStorage,
    location: { href: 'app://./index.html#/home', hash: '#/home', protocol: 'app:', reload() {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    Promise,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error,
  }
  runInContext(buildInjectionSource({ favoritesBackup: { favs: [], updatedAt: 0 } }), createContext(sandbox))
  const globals = sandbox.window as { __wxpEnhancerTeardown?: () => void }
  return {
    linkCenter: Object.assign(linkCenter, { opened, copied }),
    rows,
    components,
    favorites: () => JSON.parse(localStorage.getItem('__wxpEnhancerLinkFavorites') ?? '[]') as Favorite[],
    teardown: () => { globals.__wxpEnhancerTeardown?.() },
  }
}

/** 收藏页按钮：用组件真实 render 函数 + 假 h 渲染出 vnode 树，返回按文案分组的按钮 */
function favTabButtons(world: World): Array<{ label: string, click: () => void }> {
  const h = (tag: string, first?: unknown, second?: unknown): Record<string, unknown> => {
    const asChildren = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value])
    const isData = first && typeof first === 'object' && !Array.isArray(first)
    return { tag, data: (isData ? first : {}) as Record<string, unknown>, children: asChildren(isData ? second : first) }
  }
  const render = world.components.WxpFavLinks.options.render as (this: unknown, h: unknown) => Record<string, unknown>
  const tree = render.call({ tick: 0, eleHeight: 618 }, h)
  const buttons: Array<{ label: string, click: () => void }> = []
  const walk = (vnode: unknown): void => {
    if (!vnode || typeof vnode !== 'object') return
    const node = vnode as { tag?: string, data?: { on?: { click?: () => void } }, children?: unknown[] }
    if (node.tag === 'button' && node.data?.on?.click) {
      const label = (node.children ?? []).filter(child => typeof child === 'string').join('')
      const click = node.data.on.click
      buttons.push({ label, click })
    }
    ;(node.children ?? []).forEach(walk)
  }
  walk(tree)
  return buttons
}

const LINKS: LinkRecord[] = [
  { type: 2, sceneformal: '[非正式]', simpleName: 'portal-A', accessPoint: 'localhost:9001', targetPoint: '10.0.0.1:80', url: 'http://localhost:9001/portal/#/login', localPort: '9001', proxyState: '未启用' },
  { type: 3, sceneformal: '[非正式]', simpleName: 'grafana-A', accessPoint: 'localhost:9003', targetPoint: '10.0.0.3:3000', url: 'http://localhost:9003/cluster/grafana/d/x?orgId=1', localPort: '9003', proxyState: '未启用' },
]

const FAVORITES: Favorite[] = [
  { sceneformal: '[非正式]', simpleName: 'portal-A', accessPoint: '127.0.0.1:9001', targetPoint: '10.0.0.1:80', hospital: '医院A', tenantId: 't1', code: 'c1' },
  { sceneformal: '[非正式]', simpleName: 'grafana-A', accessPoint: '127.0.0.1:9003', targetPoint: '10.0.0.3:3000', hospital: '医院A', tenantId: 't1', code: 'c1' },
]

test('接入点主机不同（收藏 127.0.0.1 / 接口 localhost）仍匹配并置顶', async () => {
  const world = runInjection([...LINKS].reverse(), FAVORITES) // 接口顺序故意反着给
  try {
    await sleep(1300) // 等 ensureFavView 的 1s 补挂
    assert.deepEqual(world.linkCenter.hospitalLinks.map(link => link.isFav), [true, true])
  }
  finally {
    world.teardown()
  }
})

test('收藏页「复制」给出医院域名地址（本地主机换 code.localhost，端口与路径保留）', async () => {
  const world = runInjection(LINKS, FAVORITES)
  try {
    await sleep(1300)
    const copy = favTabButtons(world).filter(button => button.label === '复制')[1]
    assert.ok(copy, '收藏页应渲染出复制按钮')
    copy.click()
    await sleep(50)
    assert.deepEqual(world.linkCenter.copied, ['http://c1.localhost:9003/cluster/grafana/d/x?orgId=1'])
  }
  finally {
    world.teardown()
  }
})

test('收藏页「打开」对 Portal 链接走浏览器 + 医院域名', async () => {
  const world = runInjection(LINKS, FAVORITES)
  try {
    await sleep(1300)
    const open = favTabButtons(world).filter(button => button.label === '打开')[0]
    assert.ok(open, '收藏页应渲染出打开按钮')
    open.click()
    await sleep(250)
    assert.deepEqual(world.linkCenter.opened, ['http://c1.localhost:9001/portal/#/login'])
  }
  finally {
    world.teardown()
  }
})
