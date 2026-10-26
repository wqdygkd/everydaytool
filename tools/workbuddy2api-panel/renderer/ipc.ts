import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: wb2apiIpcChannels,
  invoke: invokeWb2apiIpc,
  on: onWb2apiIpc,
} = createIpcHelpers('workbuddy2apiPanel', 'WorkBuddy2API')

export { invokeWb2apiIpc, onWb2apiIpc, wb2apiIpcChannels }
