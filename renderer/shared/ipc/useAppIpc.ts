import { createIpcHelpers } from './createIpcHelpers'

const { channels: appIpcChannels, invoke: invokeAppIpc, on: onAppIpc } = createIpcHelpers('edtApp', 'Edt App')

export { appIpcChannels, invokeAppIpc, onAppIpc }
