import type { SourceCatalog } from '../../../../shared/skill-manager.ts'
import { isAbsolute, relative } from 'node:path'

/**
 * 项目锁里的本地来源一律写成 `/` 分隔：
 * 同一份 skills-lock.json 要能被 Windows / macOS / Linux 的 CLI 读取。
 */
export function projectSourceOf(catalog: SourceCatalog, projectPath: string): string {
  if (catalog.sourceType !== 'local' || !isAbsolute(catalog.source)) return catalog.source
  const relativePath = relative(projectPath, catalog.source).split('\\').join('/')
  if (!relativePath || isAbsolute(relativePath)) return catalog.source
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}
