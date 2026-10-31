#!/usr/bin/env node
// tweb 构建入口（tweb-cache 阶段 0）：Node 24 + corepack pnpm（packageManager 钉死 11.16）+ vite build + 产物校验。
//
// 为什么要单独一个脚本：
// - tweb 的 engines 是 `^22.18 || >=24.11`，而 everydaytool 默认 Node 22.15 不满足；
// - tweb 用 pnpm（pnpm-lock.yaml + packageManager pnpm@11.16.0），系统 pnpm 10 会被 packageManager 拒掉；
//   corepack 按 packageManager 自动取对版本，用 Node 安装目录里自带的 corepack.js 免去 PATH 折腾；
// - 构建失败要给出可执行的下一步，而不是一句 ELIFECYCLE。
//
// 用法：
//   node scripts/build-tweb.mjs --check        # 只检查环境/依赖/产物状态（含 dist 是否落后于 src）
//   node scripts/build-tweb.mjs                # pnpm install（缺依赖时，--frozen-lockfile）+ vite build
//   node scripts/build-tweb.mjs --skip-install
//   node scripts/build-tweb.mjs --force-install
//   EDT_TWEB_NODE_HOME=<dir> node scripts/build-tweb.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const twebDir = path.join(rootDir, 'tweb')
const distDir = path.join(twebDir, 'dist')
const pkgPath = path.join(twebDir, 'package.json')

const args = new Set(process.argv.slice(2))
const options = {
  check: args.has('--check'),
  skipInstall: args.has('--skip-install'),
  forceInstall: args.has('--force-install'),
}

function log(message) {
  console.log(`[tweb] ${message}`)
}

function fail(message) {
  console.error(`[tweb] ✗ ${message}`)
  process.exit(1)
}

function parseVersion(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** engines: `^22.18.0 || >=24.11.0` */
function satisfiesEngine(version) {
  if (!version) return false
  if (version.major === 22) return version.minor >= 18
  if (version.major > 24) return true
  if (version.major === 24) return version.minor >= 11
  return false
}

function describe(version) {
  return version ? `${version.major}.${version.minor}.${version.patch}` : 'unknown'
}

/** 在候选目录里找可用的 Node（fnm 的安装布局；26.x 也满足 >=24.11） */
function findNodeHomes() {
  const homes = []
  const push = (home, version) => {
    if (!home || !satisfiesEngine(version)) return
    const nodeBin = path.join(home, process.platform === 'win32' ? 'node.exe' : 'bin/node')
    const corepackJs = path.join(home, 'node_modules/corepack/dist/corepack.js')
    if (!existsSync(nodeBin)) return
    homes.push({ home, version, nodeBin, corepackJs: existsSync(corepackJs) ? corepackJs : null })
  }

  const envHome = process.env.EDT_TWEB_NODE_HOME
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
      push(path.join(versionRoot, entry, 'installation'), version)
    }
  }

  return homes.sort((a, b) => {
    // 优先 24.x（engines 第二区间里最接近 tweb CI 的），其次 22.18+ / 26.x
    if (a.version.major !== b.version.major) return a.version.major === 24 ? -1 : 1
    return (b.version.minor - a.version.minor) || (b.version.patch - a.version.patch)
  })
}

function resolveRuntime() {
  const current = parseVersion(process.versions.node)
  if (satisfiesEngine(current)) {
    return { node: process.execPath, version: current, corepackJs: findCorepackNextTo(process.execPath), source: 'current' }
  }
  const candidates = findNodeHomes()
  if (candidates.length > 0) {
    const best = candidates[0]
    return {
      node: best.nodeBin,
      version: best.version,
      corepackJs: best.corepackJs,
      source: best.home,
    }
  }
  return { node: process.execPath, version: current, corepackJs: findCorepackNextTo(process.execPath), source: 'current' }
}

function findCorepackNextTo(nodeBin) {
  const candidates = [
    path.join(path.dirname(nodeBin), 'node_modules', 'corepack', 'dist', 'corepack.js'),
    path.join(path.dirname(nodeBin), '..', 'lib', 'node_modules', 'corepack', 'dist', 'corepack.js'),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

function run(title, command, commandArgs, env) {
  log(title)
  const result = spawnSync(command, commandArgs, {
    cwd: twebDir,
    stdio: 'inherit',
    env,
  })
  if (result.error) fail(`${title} 启动失败：${result.error.message}`)
  if (result.status !== 0) fail(`${title} 失败（退出码 ${result.status ?? 'unknown'}）`)
}

function runPnpm(runtime, title, pnpmArgs) {
  if (runtime.corepackJs) {
    const env = {
      ...process.env,
      PATH: `${path.dirname(runtime.node)}${path.delimiter}${process.env.PATH ?? ''}`,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    }
    run(title, runtime.node, [runtime.corepackJs, 'pnpm', ...pnpmArgs], env)
    return
  }
  // 兜底：PATH 里的 corepack / pnpm
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  log(`${title}（未找到自带 corepack.js，退回 PATH 里的 ${pnpm}）`)
  if (process.platform === 'win32') {
    // 直接 spawn `.cmd` 会以 EINVAL 失败；经 cmd.exe 转发，且不使用 shell:true 的字符串拼接。
    run(title, process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', pnpm, ...pnpmArgs], process.env)
    return
  }
  run(title, pnpm, pnpmArgs, process.env)
}

function newestMtime(dir) {
  let newest = 0
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const fullPath = path.join(current, entry.name)
      const stat = statSync(fullPath)
      if (stat.mtimeMs > newest) newest = stat.mtimeMs
      if (entry.isDirectory()) visit(fullPath)
    }
  }
  visit(dir)
  return newest
}

function dirSizeBytes(dir) {
  let total = 0
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(current, entry.name))
      else if (entry.isFile()) total += statSync(path.join(current, entry.name)).size
    }
  }
  visit(dir)
  return total
}

function main() {
  if (!existsSync(pkgPath)) {
    fail(`找不到 ${path.relative(rootDir, pkgPath)}：请先克隆 tweb 到仓库根（docs/tweb-cache-plan.md §0）`)
  }

  const runtime = resolveRuntime()
  const nodeOk = satisfiesEngine(runtime.version)
  log(`Node ${describe(parseVersion(process.versions.node))}（当前进程）/ 构建使用 ${describe(runtime.version)}（${runtime.source}）`)
  if (!nodeOk) {
    fail(
      '当前 Node 不满足 tweb 的 engines（^22.18 || >=24.11）。\n'
      + '  本机 fnm 已装 v24.15.0，脚本会自动找到它；也可手动指定：\n'
      + '    EDT_TWEB_NODE_HOME="%APPDATA%\\fnm\\node-versions\\v24.15.0\\installation" node scripts/build-tweb.mjs',
    )
  }

  const hasNodeModules = existsSync(path.join(twebDir, 'node_modules'))
  const distIndex = path.join(distDir, 'index.html')
  log(`依赖：${hasNodeModules ? '已安装' : '未安装'}；产物：${existsSync(distIndex) ? '存在' : '缺失'}`)

  if (options.check) {
    if (existsSync(distIndex)) {
      const stale = newestMtime(twebDir) > statSync(distIndex).mtimeMs
      log(`dist 大小 ${(dirSizeBytes(distDir) / 1024 / 1024).toFixed(1)} MB；src 较 dist ${stale ? '有更新（产物已过期，建议重建）' : '无更新（产物新鲜）'}`)
    }
    log('检查完成（--check 不执行安装/构建）')
    return
  }

  if (options.forceInstall || (!options.skipInstall && !hasNodeModules)) {
    runPnpm(runtime, 'pnpm install --frozen-lockfile', ['install', '--frozen-lockfile'])
  } else {
    log('跳过依赖安装（已有 node_modules；需要强制重装用 --force-install）')
  }

  runPnpm(runtime, 'vite build', ['exec', 'vite', 'build'])

  if (!existsSync(distIndex)) fail('构建结束但 dist/index.html 不存在：请检查 vite 输出目录与构建日志')
  log(`构建完成：dist ${(dirSizeBytes(distDir) / 1024 / 1024).toFixed(1)} MB`)
}

main()
