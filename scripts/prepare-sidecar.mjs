// 构建 Node sidecar 并准备生产资源：
//   1) esbuild bundle（dist-sidecar/main.mjs，单文件、无原生模块）
//   2) Node 可执行文件复制到 src-tauri/binaries/node-<target-triple>[.exe]（Tauri externalBin）
// Tauri 打包时 resources 会带上 dist-sidecar 与两份浏览器扩展。
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildSidecar } from './build-sidecar.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function targetTriple() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  return `${arch}-unknown-linux-gnu`
}

await buildSidecar({ log: true })

// Node 运行时（sidecar）：Tauri externalBin 需要带 target triple 后缀
const triple = targetTriple()
const binaryName = `node-${triple}${process.platform === 'win32' ? '.exe' : ''}`
const binaryDest = path.join(rootDir, 'src-tauri/binaries', binaryName)
await mkdir(path.dirname(binaryDest), { recursive: true })
await copyFile(process.execPath, binaryDest)
const size = (await stat(binaryDest)).size
console.log(`✓ Node 运行时 → src-tauri/binaries/${binaryName} (${(size / 1024 / 1024).toFixed(1)} MB)`)
