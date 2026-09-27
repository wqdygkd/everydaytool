import type { EnvCreatePayload, EnvUpdatePayload } from '../../../../shared/types.js'
import { createRequire } from 'node:module'
import { envStore } from '../store/env-store.js'
import { ENV_BROWSER_IPC_CHANNELS } from './channels.js'

const require = createRequire(import.meta.url)
const { ipcMain } = require('electron') as typeof import('electron')

export function registerEnvBrowserHandlers(): void {
  ipcMain.handle(ENV_BROWSER_IPC_CHANNELS.ENV_GET_ALL, () => {
    return envStore.getAll()
  })

  ipcMain.handle(ENV_BROWSER_IPC_CHANNELS.ENV_CREATE, (_event, payload: EnvCreatePayload) => {
    if (!payload?.name?.trim()) throw new Error('环境名称不能为空')
    if (!payload?.url?.trim()) throw new Error('环境地址不能为空')
    if (!payload?.username?.trim()) throw new Error('账号不能为空')
    // password may be empty for SSO? allow empty but warn
    try {
      const u = new URL(payload.url)
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('仅支持 http/https')
    } catch {
      throw new Error('环境地址格式不正确，需包含 http(s)://')
    }
    return envStore.create(payload)
  })

  ipcMain.handle(ENV_BROWSER_IPC_CHANNELS.ENV_UPDATE, (_event, id: string, payload: EnvUpdatePayload) => {
    const updated = envStore.update(id, payload)
    if (!updated) throw new Error('环境不存在')
    return updated
  })

  ipcMain.handle(ENV_BROWSER_IPC_CHANNELS.ENV_DELETE, (_event, id: string) => {
    const ok = envStore.delete(id)
    if (!ok) throw new Error('环境不存在')
    return true
  })
}
