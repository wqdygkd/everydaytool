import type { EnvCreatePayload, EnvUpdatePayload } from '../../../../shared/types.ts'
import { createRequire } from 'node:module'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { envStore } from '../store/env-store.ts'
import { ENV_BROWSER_IPC_CHANNELS } from './channels.ts'

const require = createRequire(import.meta.url)
const { ipcMain } = require('electron') as typeof import('electron')

const MAX_TEXT_LENGTH = 512

// create / update 共用同一套校验：URL 只允许 http(s)（webview 不得导航到 file:// 等本地协议），
// 名称/账号/地址做长度上限，避免畸形数据入库后被注入到页面。
function validateEnvPayload(payload: EnvCreatePayload | EnvUpdatePayload): void {
  if (payload?.name !== undefined) {
    if (!payload.name.trim()) throw new Error('环境名称不能为空')
    if (payload.name.length > MAX_TEXT_LENGTH) throw new Error('环境名称过长')
  }
  if (payload?.username !== undefined) {
    if (!payload.username.trim()) throw new Error('账号不能为空')
    if (payload.username.length > MAX_TEXT_LENGTH) throw new Error('账号过长')
  }
  if (payload?.url !== undefined) {
    const url = payload.url.trim()
    if (!url) throw new Error('环境地址不能为空')
    if (url.length > 2048) throw new Error('环境地址过长')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('环境地址格式不正确，需包含 http(s)://')
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https')
  }
  // 密码允许为空（如 SSO 场景）
}

export function registerEnvBrowserHandlers(): void {
  safeHandle(ipcMain, ENV_BROWSER_IPC_CHANNELS.ENV_GET_ALL, () => {
    return envStore.getAll()
  })

  safeHandle(ipcMain, ENV_BROWSER_IPC_CHANNELS.ENV_CREATE, (_event, payload: EnvCreatePayload) => {
    validateEnvPayload(payload)
    return envStore.create(payload)
  })

  safeHandle(ipcMain, ENV_BROWSER_IPC_CHANNELS.ENV_UPDATE, (_event, id: string, payload: EnvUpdatePayload) => {
    validateEnvPayload(payload)
    const updated = envStore.update(id, payload)
    if (!updated) throw new Error('环境不存在')
    return updated
  })

  safeHandle(ipcMain, ENV_BROWSER_IPC_CHANNELS.ENV_DELETE, (_event, id: string) => {
    const ok = envStore.delete(id)
    if (!ok) throw new Error('环境不存在')
    return true
  })
}
