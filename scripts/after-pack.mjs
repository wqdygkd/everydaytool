// electron-builder afterPack：把本机 tweb 前端（dist + public）内置进安装包。
//
// 为什么不用 extraResources：CI 上没有 tweb/（未跟踪的本地产物），
// extraResources 的 from 缺失会让打包直接失败；这里缺失时只 warn，安装包照常产出。
// 运行时 tools/tweb-cache/backend/services/site-service.ts 在打包态从 process.resourcesPath/tweb 取站点。
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export default async function afterPack(context) {
  const projectDir = context.packager?.projectDir ?? process.cwd()
  const sourceRoot = path.join(projectDir, 'tweb')
  if (!await exists(path.join(sourceRoot, 'dist', 'index.html'))) {
    console.warn('[after-pack] 未找到 tweb/dist/index.html，安装包不内置 tweb 站点（安装版将隐藏 tweb-cache）')
    return
  }

  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  const targetRoot = path.join(resourcesDir, 'tweb')

  for (const name of ['dist', 'public']) {
    const from = path.join(sourceRoot, name)
    if (!await exists(from)) continue
    const to = path.join(targetRoot, name)
    await rm(to, { recursive: true, force: true })
    await mkdir(path.dirname(to), { recursive: true })
    // sourcemap 只有开发调试用；内置进安装包会平白多出 100+ MB
    await cp(from, to, { recursive: true, filter: file => !file.endsWith('.map') })
  }
  console.log(`[after-pack] tweb 站点已内置：${targetRoot}`)
}
