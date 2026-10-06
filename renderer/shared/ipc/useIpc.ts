import { createIpcHelpers } from './createIpcHelpers'

const { channels: ipcChannels, invoke: invokeIpc, on: onIpc } = createIpcHelpers('chromeSandbox', 'Electron')

export { invokeIpc, ipcChannels, onIpc }
