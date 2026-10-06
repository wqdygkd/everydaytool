import type { EnvConfig, EnvCreatePayload, EnvUpdatePayload } from '../../../../shared/types'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'
import { defineStore } from 'pinia'

export type { EnvConfig, EnvCreatePayload, EnvUpdatePayload }

const STORAGE_KEY = 'edt:env-browser:configs'

const { getApi: getEnvBrowserApi } = createIpcHelpers('envBrowser', '环境浏览器')

// Electron 内由 preload 注入；网页预览缺注入时返回 undefined，调用方回退 localStorage
function getIpc() {
  try {
    return getEnvBrowserApi()
  } catch {
    return undefined
  }
}

function readLocal(): EnvConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as EnvConfig[]
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function writeLocal(list: EnvConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}
function genLocalId() {
  return `env_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export const useEnvBrowserStore = defineStore('env-browser/env', () => {
  const envs = ref<EnvConfig[]>([])
  const loading = ref(false)
  const activeId = ref<string | null>(null)
  const openIds = ref<string[]>([])

  const openEnvs = computed(() => openIds.value.map(id => envs.value.find(e => e.id === id)).filter(Boolean) as EnvConfig[])

  async function loadAll() {
    loading.value = true
    try {
      const api = getIpc()
      if (api) {
        const list = (await api.invoke(api.channels.ENV_GET_ALL)) as EnvConfig[]
        envs.value = list || []
      } else {
        envs.value = readLocal()
      }
    } finally {
      loading.value = false
    }
  }

  async function create(payload: EnvCreatePayload) {
    const api = getIpc()
    if (api) {
      const env = (await api.invoke(api.channels.ENV_CREATE, payload)) as EnvConfig
      envs.value.unshift(env)
      return env
    }
    if (!payload?.name?.trim()) throw new Error('环境名称不能为空')
    if (!payload?.url?.trim()) throw new Error('环境地址不能为空')
    if (!payload?.username?.trim()) throw new Error('账号不能为空')
    try {
      if (!['http:', 'https:'].includes(new URL(payload.url).protocol)) throw new Error('仅支持 http/https')
    } catch { throw new Error('环境地址格式不正确，需包含 http(s)://') }
    const now = new Date().toISOString()
    const env: EnvConfig = {
      id: genLocalId(),
      name: payload.name.trim(),
      url: payload.url.trim(),
      username: payload.username.trim(),
      password: payload.password,
      remark: payload.remark?.trim() || null,
      autoLogin: payload.autoLogin === false ? 0 : 1,
      createdAt: now,
      updatedAt: now,
    }
    const list = [env, ...readLocal()]
    writeLocal(list)
    envs.value.unshift(env)
    return env
  }

  async function update(id: string, payload: EnvUpdatePayload) {
    const api = getIpc()
    if (api) {
      const updated = (await api.invoke(api.channels.ENV_UPDATE, id, payload)) as EnvConfig
      const idx = envs.value.findIndex(e => e.id === id)
      if (idx >= 0) envs.value[idx] = updated
      return updated
    }
    const list = readLocal()
    const idx = list.findIndex(e => e.id === id)
    if (idx < 0) throw new Error('环境不存在')
    const now = new Date().toISOString()
    const cur = list[idx]
    const updated: EnvConfig = {
      ...cur,
      name: payload.name?.trim() ?? cur.name,
      url: payload.url?.trim() ?? cur.url,
      username: payload.username?.trim() ?? cur.username,
      password: payload.password ?? cur.password,
      remark: payload.remark !== undefined ? (payload.remark?.trim() || null) : cur.remark,
      autoLogin: payload.autoLogin !== undefined ? (payload.autoLogin ? 1 : 0) : cur.autoLogin,
      updatedAt: now,
    }
    list[idx] = updated
    writeLocal(list)
    const vi = envs.value.findIndex(e => e.id === id)
    if (vi >= 0) envs.value[vi] = updated
    return updated
  }

  async function remove(id: string) {
    const api = getIpc()
    if (api) {
      await api.invoke(api.channels.ENV_DELETE, id)
    } else {
      const list = readLocal().filter(e => e.id !== id)
      writeLocal(list)
    }
    envs.value = envs.value.filter(e => e.id !== id)
    openIds.value = openIds.value.filter(v => v !== id)
    if (activeId.value === id) {
      activeId.value = openIds.value[0] || null
    }
  }

  function open(id: string) {
    if (!openIds.value.includes(id)) openIds.value.push(id)
    activeId.value = id
  }

  function closeTab(id: string) {
    openIds.value = openIds.value.filter(v => v !== id)
    if (activeId.value === id) {
      activeId.value = openIds.value[openIds.value.length - 1] || null
    }
  }

  function switchTab(id: string) {
    if (openIds.value.includes(id)) activeId.value = id
  }

  return { envs, loading, activeId, openIds, openEnvs, loadAll, create, update, remove, open, closeTab, switchTab }
})
