import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outDir = path.join(rootDir, 'dist-electron')

const backendEntryPoints = [
  'electron/main.ts',
  'electron/tool-registry.ts',
  // backend/** 平台级后端基建（logger / file-ops / data-root），松散产出到 dist-electron/backend/
  'backend/**/*.ts',
  // shared/** 里含后端运行时值导入（如 sleep、webview 分区常量），必须随编译产出到 dist-electron/shared/
  'shared/**/*.ts',
  'tools/chrome-sandbox/backend/**/*.ts',
  'tools/env-browser/backend/**/*.ts',
  'tools/treease-editor/backend/**/*.ts',
  'tools/wxp-enhancer/backend/**/*.ts',
]

const backendAssets = [
  'tools/chrome-sandbox/backend/chrome/chrome-process-query.ps1',
]

// 源码里相对导入统一写 .ts（编辑器可跳转、类型完整），产出改为纯 ESM 的 .js 目录
// （Node 只认运行时后缀）。esbuild 无 rewriteExtensions 选项，用插件在产物里做后缀改写。
const IMPORT_SPEC_RE = /(from\s+|import\s*\(\s*)('|")(\.{1,2}\/[^'"]*?)\.ts\2/g

const rewriteTsImportsToJs = {
  name: 'rewrite-ts-imports',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.ts$/ }, async ({ path: filePath }) => {
      const contents = await readFile(filePath, 'utf8')
      return {
        contents: contents.replace(IMPORT_SPEC_RE, (_m, head, quote, spec) => `${head}${quote}${spec}.js${quote}`),
        loader: 'ts',
      }
    })
  },
}

export async function buildElectron(options = {}) {
  const { log = true } = options

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  await build({
    entryPoints: backendEntryPoints,
    outdir: outDir,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    bundle: false,
    sourcemap: false,
    outbase: rootDir,
    plugins: [rewriteTsImportsToJs],
    logLevel: log ? 'info' : 'silent',
  })

  for (const asset of backendAssets) {
    const src = path.join(rootDir, asset)
    const dest = path.join(outDir, asset)
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFile(src, dest)
  }

  await build({
    entryPoints: [path.join(rootDir, 'electron/preload.ts')],
    outfile: path.join(outDir, 'electron/preload.cjs'),
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    bundle: true,
    sourcemap: false,
    external: ['electron'],
    logLevel: log ? 'info' : 'silent',
  })

  if (log) {
    console.log('✓ Electron 主进程编译到 dist-electron/')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildElectron()
}
