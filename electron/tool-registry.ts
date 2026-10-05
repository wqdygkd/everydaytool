import { chromeSandboxBackend } from '../tools/chrome-sandbox/backend/index.js'
import { envBrowserBackend } from '../tools/env-browser/backend/index.js'
import { treeaseEditorBackend } from '../tools/treease-editor/backend/index.js'
import { wxpEnhancerBackend } from '../tools/wxp-enhancer/backend/index.js'

export interface ToolBackend {
  initialize: () => Promise<void> | void
  dispose?: () => Promise<void> | void
}

export const toolBackends: ToolBackend[] = [chromeSandboxBackend, envBrowserBackend, treeaseEditorBackend, wxpEnhancerBackend]
