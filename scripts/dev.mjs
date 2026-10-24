// 统一开发入口：`pnpm dev`。
// 按平台分派到原生脚本（各自负责平台环境初始化，不做跨平台 shell 兼容层）：
//   Windows → scripts/windows/dev.bat（vswhere + VsDevCmd 初始化 MSVC）
//   macOS   → scripts/macos/dev.sh  （Xcode CLT 检查）
//   Linux   → scripts/linux/dev.sh  （GTK / WebKitGTK 检查）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function preflight() {
  if (!existsSync(path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'))) {
    console.error('[dev] 依赖未安装：请先执行 pnpm install')
    process.exit(1)
  }
}

function launch(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
  })
  child.on('error', (error) => {
    console.error(`[dev] 启动失败：${error.message}`)
    process.exit(1)
  })
}

preflight()

const quoted = args.map(arg => (/[\s"&|<>^]/.test(arg) ? `"${arg}"` : arg)).join(' ')

switch (process.platform) {
  case 'win32': {
    const bat = path.join(root, 'scripts', 'windows', 'dev.bat')
    if (!existsSync(bat)) {
      console.error(`[dev] 缺少脚本：${bat}`)
      process.exit(1)
    }
    launch('cmd.exe', ['/d', '/c', `call "${bat}" ${quoted}`.trim()], { windowsVerbatimArguments: true })
    break
  }
  case 'darwin': {
    launch('sh', [path.join(root, 'scripts', 'macos', 'dev.sh'), ...args])
    break
  }
  case 'linux': {
    launch('sh', [path.join(root, 'scripts', 'linux', 'dev.sh'), ...args])
    break
  }
  default: {
    console.error(`[dev] 不支持的平台：${process.platform}（支持 win32 / darwin / linux）`)
    process.exit(1)
  }
}
