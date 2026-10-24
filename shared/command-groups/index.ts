// 前端命令分组：每组对应一个 Rust Tauri command。
import { APP_COMMANDS } from './app.ts'
import { SANDBOX_COMMANDS } from './chrome-sandbox.ts'
import { ENV_BROWSER_COMMANDS } from './env-browser.ts'
import { INTERCEPTOR_COMMANDS } from './interceptor.ts'
import { OFFLINE_PACK_COMMANDS } from './offline-pack.ts'
import { TREEASE_COMMANDS } from './treease.ts'
import { WXP_COMMANDS } from './wxp.ts'

export interface CommandGroup {
  domain: string
  /** Rust 侧注册的 Tauri command 名 */
  command: string
  commands: Record<string, string>
}

export const COMMAND_GROUPS: CommandGroup[] = [
  { domain: 'edtApp', command: 'app_command', commands: APP_COMMANDS },
  { domain: 'interceptor', command: 'interceptor_command', commands: INTERCEPTOR_COMMANDS },
  { domain: 'chromeSandbox', command: 'chrome_sandbox_command', commands: SANDBOX_COMMANDS },
  { domain: 'envBrowser', command: 'env_browser_command', commands: ENV_BROWSER_COMMANDS },
  { domain: 'treeaseEditor', command: 'treease_command', commands: TREEASE_COMMANDS },
  { domain: 'wxpEnhancer', command: 'wxp_command', commands: WXP_COMMANDS },
  { domain: 'offlinePack', command: 'offline_pack_command', commands: OFFLINE_PACK_COMMANDS },
]
