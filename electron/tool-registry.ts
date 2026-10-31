import { chromeSandboxBackend } from '../tools/chrome-sandbox/backend/index.ts'
import { envBrowserBackend } from '../tools/env-browser/backend/index.ts'
import { interceptorBackend } from '../tools/interceptor/backend/index.ts'
import { offlinePackBackend } from '../tools/offline-pack/backend/index.ts'
import { telegramCacheBackend } from '../tools/telegram-cache/backend/index.ts'
import { treeaseEditorBackend } from '../tools/treease-editor/backend/index.ts'
import { twebCacheBackend } from '../tools/tweb-cache/backend/index.ts'
import { workbuddy2apiPanelBackend } from '../tools/workbuddy2api-panel/backend/index.ts'
import { wxpEnhancerBackend } from '../tools/wxp-enhancer/backend/index.ts'

export interface ToolBackend {
  initialize: () => Promise<void> | void
  dispose?: () => Promise<void> | void
}

// 顺序有意义：tweb-cache 通过平台层取用 telegram-cache 注册的归档引擎，必须排在它之后。
export const toolBackends: ToolBackend[] = [interceptorBackend, chromeSandboxBackend, envBrowserBackend, treeaseEditorBackend, wxpEnhancerBackend, offlinePackBackend, telegramCacheBackend, twebCacheBackend, workbuddy2apiPanelBackend]
