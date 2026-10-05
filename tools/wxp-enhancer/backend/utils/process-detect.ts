import { exec } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * 检测指定可执行文件的进程是否已在运行：
 * 单实例应用（如 WXP）在已有实例时再 spawn 只会激活旧窗口，新进程随即退出，
 * 会导致等待 CDP 超时，因此启动前先做防呆检测。
 */
export async function isExecutableRunning(executablePath: string): Promise<boolean> {
  const imageName = path.basename(executablePath.trim())
  if (!imageName) return false

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`tasklist /NH /FI "IMAGENAME eq ${imageName}"`, { windowsHide: true })
      return stdout.toLowerCase().includes(imageName.toLowerCase())
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync(`pgrep -f ${JSON.stringify(imageName)}`)
      return stdout.trim().length > 0
    }
    return false
  } catch {
    // pgrep 无匹配时以非零码退出；查询失败按未运行处理
    return false
  }
}
