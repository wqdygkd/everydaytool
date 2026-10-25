import type { IpcInvokeApi } from '@renderer/shared/ipc/types'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: treeaseEditorIpcChannels,
  invoke: invokeTreeaseEditorIpc,
  on: onTreeaseEditorIpc,
  getApi,
} = createIpcHelpers('treeaseEditor', 'Treease 编辑器')

/** 网页预览（无 preload 注入）时返回 null，调用方各自走降级分支 */
export function getTreeaseEditorApi(): IpcInvokeApi | null {
  try {
    return getApi()
  } catch {
    return null
  }
}

export { invokeTreeaseEditorIpc, onTreeaseEditorIpc, treeaseEditorIpcChannels }
