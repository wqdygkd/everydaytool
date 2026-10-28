// interceptor 工具域路径（数据目录 / 证书目录 / 扩展目录解析）。
// 应用数据根目录来自平台基建 backend/utils/data-root.ts。
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { APP_ROOT_DEV, isDevEnvironment } from '../../../../backend/utils/data-root.ts'

/** 配置层：工具配置 / 规则 / 证书（证书私钥不可再生） */
export function getInterceptorDataDirectory(): string {
  return resolveLayerPath('config', 'interceptor')
}

export function getCertsDirectory(): string {
  return path.join(getInterceptorDataDirectory(), 'certs')
}

export function getCaKeyPath(): string {
  return path.join(getCertsDirectory(), 'ca.key')
}

export function getCaCertPath(): string {
  return path.join(getCertsDirectory(), 'ca.crt')
}

/** 根 CA 导出文件名（用户手动导入用；写用户选定位置，不落在数据目录） */
export const CA_EXPORT_FILE_NAME = 'edt-interceptor-ca.crt'

/**
 * 扩展源码目录：
 * - dev：仓库源码目录（load unpacked 直接指这里，改前端代码不用重装）；
 * - 打包：extraResources 附带 resources/extension-interceptor。
 */
export function getExtensionSourcePath(): string {
  return isDevEnvironment
    ? path.join(APP_ROOT_DEV, 'tools', 'interceptor', 'extension')
    : path.join(process.resourcesPath, 'extension-interceptor')
}

/**
 * 运行时扩展目录：打包态复制到数据目录下的稳定路径。
 * 原因：安装目录可被用户更改/升级，load unpacked 的路径一旦失效扩展就消失；
 * 数据目录跨版本稳定（扩展 ID 由 manifest.key 固定，不随路径变化）。
 */
/** 缓存层：运行时扩展（每次启动可从 resources 重新准备，删了无害） */
export function getRuntimeExtensionPath(): string {
  return resolveLayerPath('cache', 'interceptor', 'extension')
}

/** 早期版本把扩展放在 userData；首次准备时迁移 */
export function getLegacyRuntimeExtensionPath(): string {
  return path.join(app.getPath('userData'), 'interceptor-extension')
}
