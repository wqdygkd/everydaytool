import { chromeSandboxBackend } from '../tools/chrome-sandbox/backend/index.ts'
import { envBrowserBackend } from '../tools/env-browser/backend/index.ts'
import { treeaseEditorBackend } from '../tools/treease-editor/backend/index.ts'
import { wxpEnhancerBackend } from '../tools/wxp-enhancer/backend/index.ts'

export interface ToolBackend {
  initialize: () => Promise<void> | void
  dispose?: () => Promise<void> | void
  /** 数据根目录变更后的域内重载（重开数据库等）；未实现的域默认实时从 data-root 取路径 */
  onDataDirectoryChanged?: () => Promise<void> | void
}

export const toolBackends: ToolBackend[] = [chromeSandboxBackend, envBrowserBackend, treeaseEditorBackend, wxpEnhancerBackend]

/** 数据根目录变更后依次通知各工具域重载（backend/ipc 的应用设置处理器经 main.ts 注入调用） */
export async function notifyDataDirectoryChanged(): Promise<void> {
  for (const backend of toolBackends) {
    await backend.onDataDirectoryChanged?.()
  }
}
