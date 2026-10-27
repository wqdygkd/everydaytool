// 开发态（未打包运行）的应用图标标识：Dock / 任务栏 / 窗口图标换成带 DEV 底边带的那份，
// 同机并存时和安装版一眼分开（仓库里没有打包图标资源，两边原本都是 Electron 默认图标）。
//
// 素材由 scripts/make-dev-icon.py 生成到 resources/dev/（只用于开发态，不参与打包：
// electron-builder 的 files / extraResources 都不含它）。将来出正式产品图标时按同样版式重出一份
// 带 DEV 标识的即可，或删掉本模块与 resources/dev/。
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { app, nativeImage } from 'electron'
import { APP_ROOT_DEV, isDevEnvironment } from '../backend/utils/data-root.ts'
import { logger } from '../backend/utils/logger.ts'

const DEV_ICON_DIR = path.join(APP_ROOT_DEV, 'resources', 'dev')

/** 未打包运行时返回素材绝对路径；安装版一律 undefined，资源缺失（非仓库副本运行）也不阻断启动 */
function resolveDevIconFile(filename: string): string | undefined {
  if (!isDevEnvironment) return undefined
  const file = path.join(DEV_ICON_DIR, filename)
  return existsSync(file) ? file : undefined
}

/** Windows / Linux 走 BrowserWindow 的 icon 选项（Windows 用 .ico，任务栏小尺寸才清晰） */
export function resolveDevWindowIconPath(): string | undefined {
  return resolveDevIconFile(process.platform === 'win32' ? 'icon-dev.ico' : 'icon-dev.png')
}

/** macOS 的 BrowserWindow.icon 不生效，Dock 图标要在 ready 之后单独设（进程级，一处即可） */
export function applyDevDockIcon(): void {
  if (process.platform !== 'darwin') return

  const file = resolveDevIconFile('icon-dev.png')
  if (!file) return

  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) {
    logger.warn('Failed to load development dock icon', { file })
    return
  }
  app.dock?.setIcon(image)
  logger.debug('Development dock icon applied', { file, size: image.getSize() })
}
