// 把 Node sidecar（业务运行时）打成单文件 ESM bundle（dist-sidecar/main.mjs）。
// 无原生模块依赖：全部业务代码打进单文件即可。
// 该 bundle 与 chrome-process-query.ps1 同目录，业务代码里的 __dirname 资源引用因此成立。
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outDir = path.join(rootDir, 'dist-sidecar')

export async function buildSidecar(options = {}) {
  const { log = true } = options
  await mkdir(outDir, { recursive: true })

  await build({
    entryPoints: [path.join(rootDir, 'sidecar/main.ts')],
    outfile: path.join(outDir, 'main.mjs'),
    format: 'esm',
    platform: 'node',
    target: 'node22',
    bundle: true,
    sourcemap: false,
    legalComments: 'none',
    // 打包进 bundle 的 CJS 依赖（node-forge）内部有 dynamic require('crypto')；
    // ESM 产物需要显式提供 require，否则运行期抛 "Dynamic require ... is not supported"。
    banner: {
      js: 'import { createRequire as __edtCreateRequire } from \'node:module\'; const require = __edtCreateRequire(import.meta.url);',
    },
    logLevel: log ? 'info' : 'silent',
  })

  await copyFile(
    path.join(rootDir, 'tools/chrome-sandbox/server/chrome/chrome-process-query.ps1'),
    path.join(outDir, 'chrome-process-query.ps1'),
  )

  if (log) console.log('✓ Node sidecar 编译到 dist-sidecar/')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildSidecar()
}
