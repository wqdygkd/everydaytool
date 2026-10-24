// Node sidecar 的命令注册表：Rust 域命令转发到这里的 handler。
// 每个 command 绑定所属 domain，跨域调用会被拒绝。
export type CommandHandler = (...args: any[]) => unknown

interface RegisteredCommand {
  domain: string
  handler: CommandHandler
}

const commands = new Map<string, RegisteredCommand>()

export function registerCommand(domain: string, channel: string, handler: CommandHandler): void {
  if (commands.has(channel)) {
    throw new Error(`command already registered: ${channel}`)
  }
  commands.set(channel, { domain, handler })
}

export async function dispatchCommand(domain: string, channel: string, args: unknown[]): Promise<unknown> {
  const entry = commands.get(channel)
  if (!entry) throw new Error(`command not found: ${channel}`)
  if (entry.domain !== domain) {
    throw new Error(`command domain mismatch: ${domain}/${channel}`)
  }
  return await entry.handler(...args)
}
