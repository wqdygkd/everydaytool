// Tauri command API 边界类型。
export interface CommandApi {
  invoke: (command: string, ...args: unknown[]) => Promise<unknown>
  on: (command: string, callback: (payload: unknown) => void) => () => void
  commands: Record<string, string>
}
