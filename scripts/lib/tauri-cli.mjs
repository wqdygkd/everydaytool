// Tauri CLI 通用透传入口（`pnpm tauri <args>` 用）。
// Windows：先在同一 cmd 进程链里初始化 MSVC 环境（scripts/windows/_env.bat），再执行 CLI，
//          这样 cargo → cl.exe 继承到 INCLUDE/LIB；macOS / Linux：直接执行（系统工具链自带）。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
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
  const cliArgs = args.map(quoteForCmd).join(' ')
  const commandLine = `call "${envBat}" && node "${cliEntry}" ${cliArgs}`.trim()
  run('cmd.exe', ['/d', '/c', commandLine], { windowsVerbatimArguments: true })
} else {
  run(process.execPath, [cliEntry, ...args])
}
