import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'

const { commands, invoke: invokeCommand, on: onCommand } = createCommandHelpers('chromeSandbox', 'Chrome 沙箱')

export { commands, invokeCommand, onCommand }
