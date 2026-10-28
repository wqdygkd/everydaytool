import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'

/** 配置层：环境账号 JSON（含账号密码，属不可再生配置） */
export function getEnvBrowserDataDirectory(): string {
  return resolveLayerPath('config', 'env-browser')
}
