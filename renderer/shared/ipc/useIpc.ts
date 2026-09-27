import { createIpcHelpers } from './createIpcHelpers'

const { getApi: getChromeSandboxApi, channels: ipcChannels, invoke: invokeIpc, on: onIpc } = createIpcHelpers('chromeSandbox', 'Electron')

export { getChromeSandboxApi, invokeIpc, ipcChannels, onIpc }
