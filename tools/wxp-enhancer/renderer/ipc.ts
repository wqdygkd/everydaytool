import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const { channels: wxpIpcChannels, invoke: invokeWxpIpc, on: onWxpIpc } = createIpcHelpers('wxpEnhancer', 'WXP 增强')

export { invokeWxpIpc, onWxpIpc, wxpIpcChannels }
