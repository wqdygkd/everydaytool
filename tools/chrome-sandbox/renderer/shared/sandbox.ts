import type { SandboxStatus } from '../../../../shared/types'

export function formatSandboxStatus(status: SandboxStatus): string {
  return status === 'running' ? '运行中' : '已停止'
}
