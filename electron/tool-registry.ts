import { interceptorBackend } from '../tools/interceptor/backend/index.ts'
import { offlinePackBackend } from '../tools/offline-pack/backend/index.ts'
import { outlookRegisterBackend } from '../tools/outlook-register/backend/index.ts'
import { pikpakGetBackend } from '../tools/pikpak-get/backend/index.ts'
import { skillManagerBackend } from '../tools/skill-manager/backend/index.ts'
import { twebCacheBackend } from '../tools/tweb-cache/backend/index.ts'
import { workbuddy2apiPanelBackend } from '../tools/workbuddy2api-panel/backend/index.ts'
import { wxpEnhancerBackend } from '../tools/wxp-enhancer/backend/index.ts'

export interface ToolBackend {
  initialize: () => void
  dispose?: () => Promise<void> | void
}

export const toolBackends: ToolBackend[] = [interceptorBackend, wxpEnhancerBackend, offlinePackBackend, outlookRegisterBackend, pikpakGetBackend, skillManagerBackend, twebCacheBackend, workbuddy2apiPanelBackend]
