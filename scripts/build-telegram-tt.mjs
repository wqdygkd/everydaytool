#!/usr/bin/env node
// telegram-tt 构建入口（阶段 0）：Node 24/26 + npm ci + vite build + 产物校验。
//
// 为什么要单独一个脚本：
// - telegram-tt 的 engines 是 `^24.15 || ^26`，而 everydaytool 跑在 Node 22；
// - 依赖必须装在子模块内（telegram-tt/node_modules），不能污染仓库根；
// - 构建失败要给出可执行的下一步，而不是一句 ELIFECYCLE。
//
// 用法：
//   node scripts/build-telegram-tt.mjs --check      # 只检查环境与产物状态
//   node scripts/build-telegram-tt.mjs              # npm ci（缺依赖时）+ build:production
//   node scripts/build-telegram-tt.mjs --skip-install
//   node scripts/build-telegram-tt.mjs --force-install
//   EDT_TELEGRAM_TT_NODE_HOME=<dir> node scripts/build-telegram-tt.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const ttDir = path.join(rootDir, 'telegram-tt')
const distDir = path.join(ttDir, 'dist')
const pkgPath = path.join(ttDir, 'package.json')

const args = new Set(process.argv.slice(2))
const options = {
  check: args.has('--check'),
  skipInstall: args.has('--skip-install'),
  forceInstall: args.has('--force-install'),
}

function log(message) {
  console.log(`[telegram-tt] ${message}`)
}

function fail(message) {
  console.error(`[telegram-tt] ✗ ${message}`)
  process.exit(1)
}

function parseVersion(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** engines: `^24.15 || ^26`（26.x 任意 minor） */
function satisfiesEngine(version) {
  if (!version) return false
  if (version.major === 24) return version.minor >= 15
  if (version.major === 26) return true
  return false
}

function describe(version) {
  return version ? `${version.major}.${version.minor}.${version.patch}` : 'unknown'
}

/** 在候选目录里找可用的 Node 24/26（只认目录名里的版本，避免额外 spawn） */
function findNodeHomes() {
  const homes = []
  const push = (home, version) => {
    if (!home || !satisfiesEngine(version)) return
    const nodeBin = path.join(home, process.platform === 'win32' ? 'node.exe' : 'bin/node')
    const npmCli = path.join(home, 'node_modules/npm/bin/npm-cli.js')
    const npmCliPosix = path.join(home, 'lib/node_modules/npm/bin/npm-cli.js')
    if (!existsSync(nodeBin)) return
    homes.push({ home, version, npmCli: existsSync(npmCli) ? npmCli : npmCliPosix })
  }

  const envHome = process.env.EDT_TELEGRAM_TT_NODE_HOME
  if (envHome) {
    const match = /(?:^|[\\/])v?(\d+\.\d+\.\d+)(?:[\\/]|$)/.exec(envHome)
    push(path.resolve(envHome), parseVersion(match?.[1] ?? ''))
  }

  const versionRoots = []
  if (process.platform === 'win32') {
    if (process.env.APPDATA) versionRoots.push(path.join(process.env.APPDATA, 'fnm', 'node-versions'))
    if (process.env.LOCALAPPDATA) versionRoots.push(path.join(process.env.LOCALAPPDATA, 'fnm', 'node-versions'))
    if (process.env.NVM_HOME) versionRoots.push(process.env.NVM_HOME)
  } else {
    const home = process.env.HOME ?? ''
    versionRoots.push(path.join(home, '.local', 'share', 'fnm', 'node-versions'))
    versionRoots.push(path.join(home, '.nvm', 'versions', 'node'))
  }

  for (const versionRoot of versionRoots) {
    if (!existsSync(versionRoot)) continue
    let entries = []
    try {
      entries = readdirSync(versionRoot)
    } catch {
      continue
    }
    for (const entry of entries) {
      const version = parseVersion(entry.replace(/^v/, ''))
      if (!satisfiesEngine(version)) continue
      push(path.join(versionRoot, entry, 'installation'), version)
    }
  }

  return homes.sort((a, b) => {
    // 优先 24.15（engines 的第一个区间，最接近上游 CI），其次 26.x
    if (a.version.major !== b.version.major) return a.version.major === 24 ? -1 : 1
    return (b.version.minor - a.version.minor) || (b.version.patch - a.version.patch)
  })
}

function resolveRuntime() {
  const current = parseVersion(process.versions.node)
  if (satisfiesEngine(current)) {
    return { node: process.execPath, version: current, npmCli: resolveCurrentNpmCli(), source: 'current' }
  }
  const candidates = findNodeHomes()
  if (candidates.length > 0) {
    const best = candidates[0]
    return {
      node: path.join(best.home, process.platform === 'win32' ? 'node.exe' : 'bin/node'),
      version: best.version,
      npmCli: existsSync(best.npmCli) ? best.npmCli : null,
      source: best.home,
    }
  }
  return { node: process.execPath, version: current, npmCli: resolveCurrentNpmCli(), source: 'current' }
}

function resolveCurrentNpmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

function run(title, command, commandArgs, env) {
  log(title)
  const result = spawnSync(command, commandArgs, {
    cwd: ttDir,
    stdio: 'inherit',
    env,
  })
  if (result.error) fail(`${title} 启动失败：${result.error.message}`)
  if (result.status !== 0) fail(`${title} 失败（退出码 ${result.status ?? 'unknown'}）`)
}

function runNpm(runtime, title, npmArgs) {
  if (!runtime.npmCli) {
    fail('找不到 npm-cli.js：请确认 Node 安装完整，或用 EDT_TELEGRAM_TT_NODE_HOME 指向 Node 24 的安装目录')
  }
  const env = {
    ...process.env,
    PATH: `${path.dirname(runtime.node)}${path.delimiter}${process.env.PATH ?? ''}`,
  }
  run(title, runtime.node, [runtime.npmCli, ...npmArgs], env)
}

function dirSizeBytes(dir) {
  let total = 0
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (entry.isFile()) total += statSync(fullPath).size
    }
  }
  visit(dir)
  return total
}

function main() {
  if (!existsSync(pkgPath)) {
    fail(`找不到 ${path.relative(rootDir, pkgPath)}：请先按 docs/telegram-cache-telegram-tt-integration.md §1 注册 submodule`)
  }

  const runtime = resolveRuntime()
  const nodeOk = satisfiesEngine(runtime.version)
  log(`Node ${describe(parseVersion(process.versions.node))}（当前进程）/ 构建使用 ${describe(runtime.version)}（${runtime.source}）`)
  if (!nodeOk) {
    fail(
      '当前 Node 不满足 telegram-tt 的 engines（^24.15 || ^26）。\n'
      + '  本机 fnm 已装 v24.15.0，可这样运行：\n'
      + '    $node24 = "$env:APPDATA\\fnm\\node-versions\\v24.15.0\\installation"\n'
      + '    $env:Path = "$node24;$env:Path"\n'
      + '    node scripts/build-telegram-tt.mjs',
    )
  }

  const hasNodeModules = existsSync(path.join(ttDir, 'node_modules'))
  const distIndex = path.join(distDir, 'index.html')
  log(`依赖：${hasNodeModules ? '已安装' : '未安装'}；产物：${existsSync(distIndex) ? '存在' : '缺失'}`)

  if (options.check) {
    if (existsSync(distIndex)) log(`dist 大小 ${(dirSizeBytes(distDir) / 1024 / 1024).toFixed(1)} MB`)
    log('检查完成（--check 不执行安装/构建）')
    return
  }

  if (options.forceInstall || (!options.skipInstall && !hasNodeModules)) {
    runNpm(runtime, 'npm ci', ['ci'])
  } else {
    log('跳过依赖安装（已有 node_modules；需要强制重装用 --force-install）')
  }

  runNpm(runtime, 'npm run build:production', ['run', 'build:production'])

  if (!existsSync(distIndex)) fail('构建结束但 dist/index.html 不存在：请检查 vite 输出目录与构建日志')
  log(`构建完成：dist ${(dirSizeBytes(distDir) / 1024 / 1024).toFixed(1)} MB`)
}

main()
