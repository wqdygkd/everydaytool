import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'

const { commands: wxpCommands, invoke: invokeWxpCommand, on: onWxpCommand } = createCommandHelpers('wxpEnhancer', 'WXP 增强')

export { invokeWxpCommand, onWxpCommand, wxpCommands }
