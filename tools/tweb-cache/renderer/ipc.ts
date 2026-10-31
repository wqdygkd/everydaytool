import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: twebCacheIpcChannels,
  invoke: invokeTwebCacheIpc,
  on: onTwebCacheIpc,
} = createIpcHelpers('twebCache', 'Telegram 缓存（tweb）')

export { invokeTwebCacheIpc, onTwebCacheIpc, twebCacheIpcChannels }
