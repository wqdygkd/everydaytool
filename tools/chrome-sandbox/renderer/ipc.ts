import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const { channels: ipcChannels, invoke: invokeIpc, on: onIpc } = createIpcHelpers('chromeSandbox', 'Electron')

export { invokeIpc, ipcChannels, onIpc }
