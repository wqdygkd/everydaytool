import { chromeSandboxBackend } from '../tools/chrome-sandbox/backend/index.ts'
import { envBrowserBackend } from '../tools/env-browser/backend/index.ts'
import { interceptorBackend } from '../tools/interceptor/backend/index.ts'
import { offlinePackBackend } from '../tools/offline-pack/backend/index.ts'
import { telegramCacheBackend } from '../tools/telegram-cache/backend/index.ts'
import { treeaseEditorBackend } from '../tools/treease-editor/backend/index.ts'
import { wxpEnhancerBackend } from '../tools/wxp-enhancer/backend/index.ts'

export interface ToolBackend {
  initialize: () => Promise<void> | void
  dispose?: () => Promise<void> | void
}

export const toolBackends: ToolBackend[] = [interceptorBackend, chromeSandboxBackend, envBrowserBackend, treeaseEditorBackend, wxpEnhancerBackend, offlinePackBackend, telegramCacheBackend]
