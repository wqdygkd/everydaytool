import type { IpcChannels } from '../shared/ipc-validation.ts'
import { EDT_APP_IPC_CHANNELS } from '../backend/ipc/channels.ts'
import { INTERCEPTOR_IPC_CHANNELS } from '../tools/interceptor/backend/ipc/channels.ts'
import { OFFLINE_PACK_IPC_CHANNELS } from '../tools/offline-pack/backend/ipc/channels.ts'
import { SKILL_MANAGER_IPC_CHANNELS } from '../tools/skill-manager/backend/ipc/channels.ts'
import { TREEASE_EDITOR_IPC_CHANNELS } from '../tools/treease-editor/backend/ipc/channels.ts'
import { TWEB_CACHE_IPC_CHANNELS } from '../tools/tweb-cache/backend/ipc/channels.ts'
import { WB2API_PANEL_IPC_CHANNELS } from '../tools/workbuddy2api-panel/backend/ipc/channels.ts'
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
  { preloadNamespace: 'treeaseEditor', channels: TREEASE_EDITOR_IPC_CHANNELS },
  { preloadNamespace: 'wxpEnhancer', channels: WXP_ENHANCER_IPC_CHANNELS },
  { preloadNamespace: 'offlinePack', channels: OFFLINE_PACK_IPC_CHANNELS },
  { preloadNamespace: 'skillManager', channels: SKILL_MANAGER_IPC_CHANNELS },
  { preloadNamespace: 'twebCache', channels: TWEB_CACHE_IPC_CHANNELS },
  { preloadNamespace: 'workbuddy2apiPanel', channels: WB2API_PANEL_IPC_CHANNELS },
]
