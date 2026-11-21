import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: outlookRegisterIpcChannels,
  invoke: invokeOutlookRegisterIpc,
} = createIpcHelpers('outlookRegister', 'Outlook 注册')

export { invokeOutlookRegisterIpc, outlookRegisterIpcChannels }
