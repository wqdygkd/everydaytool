import { createIpcHelpers } from './createIpcHelpers'

const { getApi: getWxpApi, channels: wxpIpcChannels, invoke: invokeWxpIpc, on: onWxpIpc } = createIpcHelpers('wxpEnhancer', 'WXP 增强')

export { getWxpApi, invokeWxpIpc, onWxpIpc, wxpIpcChannels }
