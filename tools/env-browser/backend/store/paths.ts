import path from 'node:path'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'

/** env-browser 工具的数据目录（环境账号 JSON 落在其下） */
export function getEnvBrowserDataDirectory(): string {
  return path.join(getDataDirectory(), 'env-browser')
}
