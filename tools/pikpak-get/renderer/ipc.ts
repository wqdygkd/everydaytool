import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: pikpakGetIpcChannels,
  invoke: invokePikpakGetIpc,
} = createIpcHelpers('pikpakGet', 'PikPak 下载')

export { invokePikpakGetIpc, pikpakGetIpcChannels }
