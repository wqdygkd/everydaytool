import type { IpcChannels } from '../shared/ipc-validation.ts'
import { EDT_APP_IPC_CHANNELS } from '../backend/ipc/channels.ts'
import { CHROME_SANDBOX_IPC_CHANNELS } from '../tools/chrome-sandbox/backend/ipc/channels.ts'
import { ENV_BROWSER_IPC_CHANNELS } from '../tools/env-browser/backend/ipc/channels.ts'
import { INTERCEPTOR_IPC_CHANNELS } from '../tools/interceptor/backend/ipc/channels.ts'
import { OFFLINE_PACK_IPC_CHANNELS } from '../tools/offline-pack/backend/ipc/channels.ts'
import { TELEGRAM_CACHE_IPC_CHANNELS } from '../tools/telegram-cache/backend/ipc/channels.ts'
import { TREEASE_EDITOR_IPC_CHANNELS } from '../tools/treease-editor/backend/ipc/channels.ts'
import { WXP_ENHANCER_IPC_CHANNELS } from '../tools/wxp-enhancer/backend/ipc/channels.ts'

export interface IpcNamespace {
  /** 渲染层 window 上暴露的对象名（preload contextBridge） */
  preloadNamespace: string
  /** 该命名空间允许 invoke / on 的通道白名单 */
  channels: IpcChannels
}

// preload 命名空间清单：新增工具时先在这里登记通道表，再在 renderer 侧声明 window 类型。
// 顺序即 preload 注入顺序，与注册表本身无关。
export const ipcNamespaces: IpcNamespace[] = [
  { preloadNamespace: 'edtApp', channels: EDT_APP_IPC_CHANNELS },
  { preloadNamespace: 'interceptor', channels: INTERCEPTOR_IPC_CHANNELS },
  { preloadNamespace: 'chromeSandbox', channels: CHROME_SANDBOX_IPC_CHANNELS },
  { preloadNamespace: 'envBrowser', channels: ENV_BROWSER_IPC_CHANNELS },
  { preloadNamespace: 'treeaseEditor', channels: TREEASE_EDITOR_IPC_CHANNELS },
  { preloadNamespace: 'wxpEnhancer', channels: WXP_ENHANCER_IPC_CHANNELS },
  { preloadNamespace: 'offlinePack', channels: OFFLINE_PACK_IPC_CHANNELS },
  { preloadNamespace: 'telegramCache', channels: TELEGRAM_CACHE_IPC_CHANNELS },
]
