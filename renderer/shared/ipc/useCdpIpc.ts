import { createIpcHelpers } from './createIpcHelpers'

const { getApi: getCdpInjectorApi, channels: cdpIpcChannels, invoke: invokeCdpIpc, on: onCdpIpc } = createIpcHelpers('cdpInjector', 'CDP 注入')

export { cdpIpcChannels, getCdpInjectorApi, invokeCdpIpc, onCdpIpc }
