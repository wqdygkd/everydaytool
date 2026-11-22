// 把 pikpak-get 引擎的 NAS 入口打包成单个 service.mjs，供 Docker 镜像 `node service.mjs` 运行。
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const outfile = path.join(root, 'deploy/pikpak-get-nas/service.mjs')

await build({
  entryPoints: [path.join(root, 'tools/pikpak-get/backend/engine/service-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  // 引擎只用 node: 内置模块 + 全局 fetch，无外部依赖。
  external: [],
  sourcemap: false,
  logLevel: 'info',
})

console.log(`✓ pikpak-get 引擎已打包到 ${path.relative(root, outfile)}`)
process.exit(0)
