import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: chromeSandboxIpcChannels,
  invoke: invokeChromeSandboxIpc,
  on: onChromeSandboxIpc,
} = createIpcHelpers('chromeSandbox', 'Electron')

export { chromeSandboxIpcChannels, invokeChromeSandboxIpc, onChromeSandboxIpc }
