// 统一环境检查：`pnpm doctor`（只读，不安装任何东西，不修改系统环境）。
//
// 状态语义：
//   OK              检查通过
//   MISSING         必需组件缺失（需要人工安装）
//   NOT INITIALIZED 组件存在但环境未初始化（例如 MSVC 装了但 INCLUDE/LIB 为空）
//   UNSUPPORTED     当前平台不支持该检查项
//   WARN            非必需项缺失，不影响构建
//
// 退出码：0 = 无 MISSING / NOT INITIALIZED；1 = 存在阻塞构建的问题。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statfsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.platform
const rows = []
let blocking = 0

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => (COLOR ? `\u001B[${code}m${text}\u001B[0m` : text)

function add(label, status, detail = '', { required = true } = {}) {
  const bad = status === 'MISSING' || status === 'NOT INITIALIZED'
  if (bad && required) blocking += 1
  const tag = {
    'OK': paint('32', 'OK             '),
    'MISSING': paint('31', 'MISSING        '),
    'NOT INITIALIZED': paint('31', 'NOT INITIALIZED'),
    'UNSUPPORTED': paint('90', 'UNSUPPORTED    '),
    'WARN': paint('33', 'WARN           '),
  }[status] ?? status
  rows.push({ label, tag, detail })
}

function render() {
  const width = Math.max(...rows.map(row => row.label.length), 10)
  for (const row of rows) {
    console.log(`${row.tag}  ${row.label.padEnd(width)}  ${row.detail}`)
  }
}

/** 执行命令并返回 stdout（失败返回 null） */
function capture(command, args, options = {}) {
  // Windows 上 pnpm 等是 .cmd shim，需要 shell:true 才能执行；.exe 必须 shell:false（路径含空格）
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: options.shell ?? false,
  })
  if (result.error || result.status !== 0) return null
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

function firstLine(text) {
  return (text ?? '').split(/\r?\n/)[0].trim()
}

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------
console.log(`\n== everydaytool doctor ==\n`)
add('platform', 'OK', `${platform} ${process.arch}`)

const nodeVersion = process.versions.node
const nodeMajor = Number(nodeVersion.split('.')[0])
add(
  'node',
  nodeMajor >= 22 ? 'OK' : 'MISSING',
  `${nodeVersion}${nodeMajor >= 22 ? '' : '（要求 >= 22，见 package.json engines）'}`,
)

const pnpmVersion = capture('pnpm', ['--version'], { shell: process.platform === 'win32' })
add('pnpm', pnpmVersion ? 'OK' : 'WARN', pnpmVersion ?? '未找到（pnpm install 前需要）')

const rustcVersion = capture('rustc', ['-vV'])
if (!rustcVersion) {
  add('rustc', 'MISSING', '未找到，请安装 Rust（https://rustup.rs）')
} else {
  const hostLine = rustcVersion.split(/\r?\n/).find(line => line.startsWith('host:'))
  add('rustc', 'OK', `${firstLine(rustcVersion)}（${hostLine ?? 'host 未知'}）`)
}

const cargoVersion = capture('cargo', ['-V'])
add('cargo', cargoVersion ? 'OK' : 'MISSING', cargoVersion ?? '未找到')

const cliPackage = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'package.json')
if (existsSync(cliPackage)) {
  try {
    const version = JSON.parse(readFileSync(cliPackage, 'utf8')).version
    add('tauri cli', 'OK', `${version}（node_modules）`)
  } catch {
    add('tauri cli', 'WARN', '已安装但版本读取失败')
  }
} else {
  add('tauri cli', 'MISSING', 'node_modules 缺少 @tauri-apps/cli，请执行 pnpm install')
}

if (existsSync(path.join(root, 'node_modules'))) {
  add('node_modules', 'OK', '已安装')
} else {
  add('node_modules', 'MISSING', '请执行 pnpm install')
}

// rustup 目标（仅提示，不阻塞）
const installedTargets = capture('rustup', ['target', 'list', '--installed'])
if (installedTargets) {
  const list = installedTargets.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const expected = {
    win32: 'x86_64-pc-windows-msvc',
    darwin: 'aarch64-apple-darwin',
    linux: 'x86_64-unknown-linux-gnu',
  }[platform]
  if (expected) {
    add(
      'rust target',
      list.includes(expected) ? 'OK' : 'WARN',
      list.includes(expected) ? expected : `${expected} 未安装（rustup target add ${expected}）`,
      { required: false },
    )
  }
}

// ---------------------------------------------------------------------------
// 平台专属
// ---------------------------------------------------------------------------
if (platform === 'win32') {
  checkWindows()
} else if (platform === 'darwin') {
  checkMacos()
} else if (platform === 'linux') {
  checkLinux()
} else {
  add('platform support', 'UNSUPPORTED', `未支持 ${platform}`)
}

function checkWindows() {
  const envBat = path.join(root, 'scripts', 'windows', '_env.bat')
  if (!existsSync(envBat)) {
    add('windows env script', 'MISSING', `缺少 ${path.relative(root, envBat)}`)
    return
  }

  const vswhereCandidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
  ].filter(Boolean)
  const vswhere = vswhereCandidates.find(candidate => existsSync(candidate))
  if (!vswhere) {
    add('vs build tools', 'MISSING', '未找到 vswhere.exe：请安装 Build Tools（https://aka.ms/vs/17/release/vs_BuildTools.exe）')
    return
  }
  add('vswhere', 'OK', vswhere)

  const vsPath = capture(vswhere, [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'installationPath',
    '-nologo',
  ])
  if (!vsPath) {
    add('vs build tools', 'MISSING', '未找到带 C++ 工作负载的 Visual Studio（Desktop development with C++）')
    return
  }
  add('vs build tools', 'OK', firstLine(vsPath))

  // 通过 _env.bat 实际初始化一次，验证 INCLUDE / LIB / cl.exe / SDK（不能只看 where cl.exe）。
  // _env.bat 自己把结果转储到 EDT_ENV_DUMP，避免 cmd 重定向与后续追加冲突。
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'edt-doctor-'))
  const dumpFile = path.join(tmp, 'env.txt')
  const probe = spawnSync('cmd.exe', ['/d', '/c', `call "${envBat}"`], {
    windowsHide: true,
    stdio: 'ignore',
    // 不转义：Node 默认会把 " 变成 \"，cmd 无法识别
    windowsVerbatimArguments: true,
    env: { ...process.env, EDT_ENV_DUMP: dumpFile },
  })
  let text = ''
  try {
    text = readFileSync(dumpFile, 'utf8')
  } catch {
    text = ''
  }
  rmSync(tmp, { recursive: true, force: true })

  const grab = (key) => {
    const line = text.split(/\r?\n/).find(item => item.startsWith(`${key}=`))
    return line ? line.slice(key.length + 1).trim() : ''
  }
  const include = grab('INCLUDE')
  const lib = grab('LIB')
  const sdk = grab('WINDOWSSDKDIR')
  const targetDir = grab('CARGO_TARGET_DIR')
  const clPath = grab('CL')
  const initOk = probe.status === 0 && include.length > 0 && lib.length > 0

  if (!initOk) {
    add('msvc env', 'NOT INITIALIZED', 'VsDevCmd 初始化失败（运行 scripts/windows/_env.bat 查看具体错误）')
  } else {
    add('msvc env', 'OK', 'VsDevCmd 初始化成功（INCLUDE / LIB 已就绪）')
  }
  add('cl.exe', clPath ? 'OK' : 'NOT INITIALIZED', clPath || 'PATH 中未找到')
  add(
    'INCLUDE',
    include ? 'OK' : 'NOT INITIALIZED',
    include ? `${include.split(';').filter(Boolean).length} 个路径` : '为空（Windows SDK 头文件缺失）',
  )
  add(
    'LIB',
    lib ? 'OK' : 'NOT INITIALIZED',
    lib ? `${lib.split(';').filter(Boolean).length} 个路径` : '为空（Windows SDK 库缺失）',
  )
  add('windows sdk', sdk ? 'OK' : 'MISSING', sdk || '未检测到 Windows SDK（在 VS Installer 里安装）')

  // 构建目录与磁盘余量（默认仓库内 target，开发者可用 CARGO_TARGET_DIR 覆盖）
  const chosen = process.env.CARGO_TARGET_DIR || targetDir || path.join(root, 'target')
  let freeText = '未知'
  try {
    const stats = statfsSync(path.parse(chosen).root)
    const freeGb = (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3
    freeText = `${freeGb.toFixed(1)} GB 可用`
  } catch {}
  add('cargo target dir', 'OK', `${chosen}（${freeText}）`)
}

function checkMacos() {
  const cltPath = capture('xcode-select', ['-p'])
  add('xcode clt', cltPath ? 'OK' : 'MISSING', cltPath ?? '未安装：xcode-select --install')

  const sdkPath = capture('xcrun', ['--show-sdk-path'])
  add('apple sdk', sdkPath ? 'OK' : 'MISSING', sdkPath ?? 'xcrun --show-sdk-path 失败')

  const clang = capture('clang', ['--version'])
  add('clang', clang ? 'OK' : 'MISSING', clang ? firstLine(clang) : '未找到（随 Xcode CLT 安装）')
}

function checkLinux() {
  const cc = capture('cc', ['--version']) ?? capture('gcc', ['--version']) ?? capture('clang', ['--version'])
  add('c compiler', cc ? 'OK' : 'MISSING', cc ? firstLine(cc) : '未找到（apt install build-essential）')

  const pkgConfig = capture('pkg-config', ['--version'])
  add('pkg-config', pkgConfig ? 'OK' : 'MISSING', pkgConfig ?? '未找到（apt install pkg-config）')
  if (!pkgConfig) return

  const modules = [
    ['gtk+-3.0', 'libgtk-3-dev', true],
    ['webkit2gtk-4.1', 'libwebkit2gtk-4.1-dev', true],
    ['javascriptcoregtk-4.1', 'libwebkit2gtk-4.1-dev', true],
    ['libsoup-3.0', 'libsoup-3.0-dev', true],
    ['ayatana-appindicator3-0.1', 'libayatana-appindicator3-dev', false],
    ['openssl', 'libssl-dev', false],
  ]
  for (const [module, packageName, required] of modules) {
    const version = capture('pkg-config', ['--modversion', module])
    add(
      module,
      version ? 'OK' : required ? 'MISSING' : 'WARN',
      version ? `v${version}` : `未找到（apt install ${packageName}）`,
      { required },
    )
  }

  const xdotool = capture('xdotool', ['--version'])
  add('xdotool', xdotool ? 'OK' : 'WARN', xdotool ? firstLine(xdotool) : '未找到（apt install libxdo-dev）', { required: false })
}

// ---------------------------------------------------------------------------
// 结果
// ---------------------------------------------------------------------------
console.log('')
render()
console.log('')

if (blocking > 0) {
  console.log(paint('31', `发现 ${blocking} 个阻塞构建的问题，请按上面的提示修复后重试。`))
  process.exit(1)
}
console.log(paint('32', '环境检查通过。'))
