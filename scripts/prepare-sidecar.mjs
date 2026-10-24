// 构建 Node sidecar 并准备生产资源：
//   1) esbuild bundle（dist-sidecar/main.mjs）
//   2) 原生模块 better-sqlite3（连同 prebuilds）复制到 dist-sidecar/node_modules
//   3) Node 可执行文件复制到 src-tauri/binaries/node-<target-triple>[.exe]（Tauri externalBin）
// Tauri 打包时 resources 会带上 dist-sidecar 与两份浏览器扩展。
import { copyFile, cp, mkdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildSidecar } from './build-sidecar.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

function targetTriple() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  return `${arch}-unknown-linux-gnu`
}

await buildSidecar({ log: true })

// 1) better-sqlite3：原生模块不能进 bundle，运行时从 resources/sidecar/node_modules 解析
const sqliteEntry = require.resolve('better-sqlite3')
const sqliteDir = path.resolve(sqliteEntry, '..', '..')
const sqliteDest = path.join(rootDir, 'dist-sidecar/node_modules/better-sqlite3')
await rm(sqliteDest, { recursive: true, force: true })
await cp(sqliteDir, sqliteDest, { recursive: true, dereference: true })
console.log(`✓ better-sqlite3 → ${path.relative(rootDir, sqliteDest)}`)

// 2) Node 运行时（sidecar）：Tauri externalBin 需要带 target triple 后缀
const triple = targetTriple()
const binaryName = `node-${triple}${process.platform === 'win32' ? '.exe' : ''}`
const binaryDest = path.join(rootDir, 'src-tauri/binaries', binaryName)
await mkdir(path.dirname(binaryDest), { recursive: true })
await copyFile(process.execPath, binaryDest)
const size = (await stat(binaryDest)).size
console.log(`✓ Node 运行时 → src-tauri/binaries/${binaryName} (${(size / 1024 / 1024).toFixed(1)} MB)`)
