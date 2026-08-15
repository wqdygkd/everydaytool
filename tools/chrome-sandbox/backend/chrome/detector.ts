import fs from 'fs-extra';
import { getDefaultChromePaths } from '../utils/path-helper.js';
import { configStore } from '../store/config-store.js';

export async function detectChromePath(): Promise<string> {
  const configured = configStore.get<string>('chromePath');
  if (configured && await fs.pathExists(configured)) {
    return configured;
  }

  for (const candidate of getDefaultChromePaths()) {
    if (candidate && await fs.pathExists(candidate)) {
      configStore.update({ chromePath: candidate });
      return candidate;
    }
  }

  throw new Error('未找到 Chrome 浏览器，请在设置中手动指定路径');
}
