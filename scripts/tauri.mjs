// 唯一的 Tauri CLI 入口：`pnpm dev` / `pnpm build` / `pnpm tauri <args>` 都走这里。
//
// 平台差异只有一处：Windows 普通终端没有 MSVC 环境（INCLUDE / LIB / cl.exe），
// 必须先 call scripts/windows/_env.bat（vswhere → VsDevCmd）再执行 CLI；
// macOS / Linux 的系统工具链本来就在 PATH 里，直接调用即可。
//
// 平台相关的打包配置（如 Windows 只出 MSI）交给 Tauri 的配置合并：
// src-tauri/tauri.<platform>.conf.json，不要写进脚本。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const args = process.argv.slice(2)

if (!existsSync(cliEntry)) {
  console.error('[tauri] Tauri CLI 未安装，请先执行 pnpm install')
  process.exit(1)
}

/** cmd 参数转义：含空格/特殊字符时加引号 */
function quoteForCmd(value) {
  return /[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

function run(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
  })
  child.on('error', (error) => {
    console.error(`[tauri] 启动失败：${error.message}`)
    process.exit(1)
  })
}

if (process.platform === 'win32') {
  const envBat = path.join(root, 'scripts', 'windows', '_env.bat')
  if (!existsSync(envBat)) {
    console.error(`[tauri] 缺少 Windows 环境脚本：${envBat}`)
    process.exit(1)
  }
  const commandLine = `call "${envBat}" && node "${cliEntry}" ${args.map(quoteForCmd).join(' ')}`.trim()
  run('cmd.exe', ['/d', '/c', commandLine], { windowsVerbatimArguments: true })
} else {
  run(process.execPath, [cliEntry, ...args])
}
