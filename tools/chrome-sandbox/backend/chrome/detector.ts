import { pathExists } from '../../../../backend/utils/file-ops.ts'
import { configStore } from '../store/config-store.ts'
import { getDefaultChromePaths } from '../utils/path-helper.ts'

export async function detectChromePath(): Promise<string> {
  const configured = configStore.get<string>('chromePath')
  if (configured && await pathExists(configured)) {
    return configured
  }

  for (const candidate of getDefaultChromePaths()) {
    if (candidate && await pathExists(candidate)) {
      configStore.update({ chromePath: candidate })
      return candidate
    }
  }

  throw new Error('未找到 Chrome 浏览器，请在设置中手动指定路径')
}
