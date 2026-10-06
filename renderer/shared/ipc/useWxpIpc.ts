import { createIpcHelpers } from './createIpcHelpers'

const { channels: wxpIpcChannels, invoke: invokeWxpIpc, on: onWxpIpc } = createIpcHelpers('wxpEnhancer', 'WXP 增强')

export { invokeWxpIpc, onWxpIpc, wxpIpcChannels }
