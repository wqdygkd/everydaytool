import { ElMessage } from 'element-plus';
import { selectDataDirectory } from '@renderer/shared/ipc/useIpc.js';

export function useDataDirectoryPicker() {
  async function browseDataDirectory(): Promise<string | null> {
    try {
      return await selectDataDirectory();
    } catch (error) {
      ElMessage.error((error as Error).message || '选择目录失败');
      return null;
    }
  }

  return { browseDataDirectory };
}
