import { EDT_APP_IPC_CHANNELS } from '../backend/ipc/channels.ts'
import { IPC_CHANNELS } from '../tools/chrome-sandbox/backend/ipc/channels.ts'
import { ENV_BROWSER_IPC_CHANNELS } from '../tools/env-browser/backend/ipc/channels.ts'
import { TREEASE_IPC_CHANNELS } from '../tools/treease-editor/backend/ipc/channels.ts'
import { WXP_IPC_CHANNELS } from '../tools/wxp-enhancer/backend/ipc/channels.ts'

type IpcChannels = Record<string, string>

export interface IpcNamespace {
  preloadNamespace: string
  channels: IpcChannels
}

export const ipcNamespaces: IpcNamespace[] = [
  { preloadNamespace: 'edtApp', channels: EDT_APP_IPC_CHANNELS },
  { preloadNamespace: 'chromeSandbox', channels: IPC_CHANNELS },
  { preloadNamespace: 'envBrowser', channels: ENV_BROWSER_IPC_CHANNELS },
  { preloadNamespace: 'treeaseEditor', channels: TREEASE_IPC_CHANNELS },
  { preloadNamespace: 'wxpEnhancer', channels: WXP_IPC_CHANNELS },
]
