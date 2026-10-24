import { createCommandHelpers } from './createCommandHelpers'

const { commands: appCommands, invoke: invokeAppCommand, on: onAppCommand } = createCommandHelpers('edtApp', 'Edt App')

export { appCommands, invokeAppCommand, onAppCommand }
