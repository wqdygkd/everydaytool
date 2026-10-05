import { IPC_CHANNELS } from '../tools/chrome-sandbox/backend/ipc/channels.js'
import { ENV_BROWSER_IPC_CHANNELS } from '../tools/env-browser/backend/ipc/channels.js'
import { TREEASE_IPC_CHANNELS } from '../tools/treease-editor/backend/ipc/channels.js'
import { WXP_IPC_CHANNELS } from '../tools/wxp-enhancer/backend/ipc/channels.js'

type IpcChannels = Record<string, string>

export interface IpcNamespace {
  preloadNamespace: string
  channels: IpcChannels
}

export const ipcNamespaces: IpcNamespace[] = [
  { preloadNamespace: 'chromeSandbox', channels: IPC_CHANNELS },
  { preloadNamespace: 'envBrowser', channels: ENV_BROWSER_IPC_CHANNELS },
  { preloadNamespace: 'treeaseEditor', channels: TREEASE_IPC_CHANNELS },
  { preloadNamespace: 'wxpEnhancer', channels: WXP_IPC_CHANNELS },
]
