import { logger } from '../../../backend/utils/logger.ts'
import { registerSkillManagerHandlers } from './ipc/handlers.ts'
import { cleanupStaleInstallArtifacts } from './services/installer.ts'

export const skillManagerBackend = {
  initialize(): void {
    registerSkillManagerHandlers()
    void cleanupStaleInstallArtifacts().catch((error) => {
      logger.warn('Failed to clean stale skill-manager install artifacts', {
        error: (error as Error).message,
      })
    })
  },
}
