import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outDir = path.join(rootDir, 'dist-electron')

/**
 * 产物自检：`bundle: false` 时产物只改写 import 后缀、不内联依赖，入口一旦漏登记就会产出
 * 「import 了不存在的 .js」的产物——构建照样成功，直到运行期才以 ERR_MODULE_NOT_FOUND 崩在
 * 启动瞬间（electron/dev-icon.ts 就踩过）。这里在构建末尾把所有相对导入静态验证一遍。
 */
export async function assertModuleGraphResolves() {
  const missing = []
  const visit = async (dir) => {
    for (const dirent of await readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        await visit(fullPath)
        continue
      }
      if (!dirent.name.endsWith('.js')) continue
      const code = await readFile(fullPath, 'utf8')
      for (const match of code.matchAll(/(?:from\s+|import\s*\(\s*)"(\.[^"]+\.js)"/g)) {
        const target = path.resolve(path.dirname(fullPath), match[1])
        if (!existsSync(target)) {
          missing.push(`${path.relative(outDir, fullPath)} -> ${match[1]}`)
        }
      }
    }
  }
  await visit(outDir)
  if (missing.length > 0) {
    throw new Error(`产物里有无法解析的相对导入（入口漏登记？）：\n${missing.join('\n')}`)
  }
}

/** 递归收集某个工具后端目录下的全部 .ts（相对 rootDir，供 esbuild outbase 保持目录结构） */
async function collectToolBackendEntries(dir) {
  let entries = []
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return entries
  }
  for (const dirent of dirents) {
    if (dirent.name === 'node_modules') continue
    const fullPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      entries = entries.concat(await collectToolBackendEntries(fullPath))
    } else if (dirent.name.endsWith('.ts')) {
      entries.push(path.relative(rootDir, fullPath))
    }
  }
  return entries
}

// 工具后端入口按 tools/*/backend 动态发现：新增工具不需要在构建脚本里登记。
const toolIds = (await readdir(path.join(rootDir, 'tools'), { withFileTypes: true }))
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name)
const toolBackendEntries = (await Promise.all(
  toolIds.map(toolId => collectToolBackendEntries(path.join(rootDir, 'tools', toolId, 'backend'))),
)).flat()

// 主进程入口按 electron/*.ts 动态发现：`bundle: false` 下每个模块都必须自己出现在产物里
// （产物只改写 import 后缀、不内联依赖），漏登记的新模块会在运行期 ERR_MODULE_NOT_FOUND。
// preload 走下面的独立 cjs 打包，跳过。
const electronEntries = (await readdir(path.join(rootDir, 'electron'), { withFileTypes: true }))
  .filter(dirent => dirent.isFile() && dirent.name.endsWith('.ts') && dirent.name !== 'preload.ts')
  .map(dirent => `electron/${dirent.name}`)

const backendEntryPoints = [
  ...electronEntries,
  // backend/** 平台级后端基建（logger / file-ops / data-root），松散产出到 dist-electron/backend/
  'backend/**/*.ts',
  // shared/** 里含后端运行时值导入（如 sleep、webview 分区常量），必须随编译产出到 dist-electron/shared/
  'shared/**/*.ts',
  ...toolBackendEntries,
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

  await assertModuleGraphResolves()

  if (log) {
    console.log('✓ Electron 主进程编译到 dist-electron/')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildElectron()
}
