import type { CommandApi } from './types'
import { COMMAND_GROUPS } from '@shared/command-groups'
import { subscribeDesktopEvent } from '../../desktop/event-bus'
import { invokeDesktop, isTauriEnvironment } from '../../desktop/tauri'

export function createCommandHelpers(domain: string, label: string): {
  getApi: () => CommandApi
  commands: () => Record<string, string>
  invoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  on: <T = unknown>(command: string, callback: (payload: T) => void) => () => void
} {
  const group = COMMAND_GROUPS.find(item => item.domain === domain)
  if (!group) throw new Error(`未知的命令分组：${domain}`)
  const commands = group.commands
  const tauriCommand = group.command

  function assertCommand(command: string): void {
    if (!Object.values(commands).includes(command)) {
      throw new Error(`command not allowed: ${domain}/${command}`)
    }
  }

  function getApi(): CommandApi {
    if (!isTauriEnvironment()) {
      throw new Error(`网页预览不支持 ${label} 相关功能，请在 everydaytool 桌面端中使用`)
    }
    return {
      commands,
      invoke<T = unknown>(command: string, ...args: unknown[]): Promise<T> {
        assertCommand(command)
        return invokeDesktop<T>(tauriCommand, { command, args })
      },
      on<T = unknown>(command: string, callback: (payload: T) => void): () => void {
        assertCommand(command)
        return subscribeDesktopEvent(command, callback as (payload: unknown) => void)
      },
    }
  }

  function invoke<T = unknown>(command: string, ...args: unknown[]): Promise<T> {
    return getApi().invoke(command, ...args) as Promise<T>
  }

  function on<T = unknown>(command: string, callback: (payload: T) => void): () => void {
    return getApi().on(command, callback as (payload: unknown) => void)
  }

  return { getApi, commands: () => commands, invoke, on }
}
